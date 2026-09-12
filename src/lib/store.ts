import { create } from 'zustand';
import type { Article, Brief, PlatformId } from './types';
import { loadConfig } from './config';
import { mergeArticles } from './backup';

const STORAGE_KEY = 'omniwriter:articles:v1';
const LEGACY_STORAGE_KEYS = ['pencil:articles:v1'];
const SAVE_DEBOUNCE_MS = 400;

// 损坏数据保护：若 localStorage 里的文章 JSON 无法解析，保留原始字符串，
// 并暂停自动覆盖——避免下一次防抖落盘把用户全部稿件静默清空。
let corruptRaw: string | null = null;

function migrateStorage() {
  if (typeof window === 'undefined') return;
  if (window.localStorage.getItem(STORAGE_KEY) !== null) return;
  for (const legacy of LEGACY_STORAGE_KEYS) {
    const value = window.localStorage.getItem(legacy);
    if (value !== null) {
      window.localStorage.setItem(STORAGE_KEY, value);
      window.localStorage.removeItem(legacy);
      break;
    }
  }
}

function loadAll(): Article[] {
  if (typeof window === 'undefined') return [];
  migrateStorage();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Article[]) : [];
  } catch {
    corruptRaw = raw;
    console.warn('[OmniWriter] 本地文章数据损坏，已暂停自动保存以防覆盖，请到 设置 → 数据安全 恢复或导出备份。');
    return [];
  }
}

// 配额（QuotaExceededError）等写入失败不抛未捕获异常：内容仍保留在内存里，
// 控制台给出提示，避免整篇文章丢失 / 编辑器崩溃。
function saveAll(articles: Article[]): boolean {
  if (typeof window === 'undefined') return true;
  if (corruptRaw !== null) {
    // 用户尚未确认丢弃损坏数据前，绝不覆盖原始串。
    console.warn('[OmniWriter] 本地数据损坏，跳过覆盖写以保留原始数据。');
    return false;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(articles));
    return true;
  } catch (e) {
    console.warn('[OmniWriter] 本地保存失败（可能超出 localStorage 配额）：', e);
    return false;
  }
}

// 内容类更新（击键）做防抖批量落盘，结构性操作（新建/删除）立即落盘
let pending: Article[] | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingResult: ((ok: boolean) => void) | null = null;

function queueSave(articles: Article[], onResult: (ok: boolean) => void) {
  pending = articles;
  pendingResult = onResult;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (pending) {
      const ok = saveAll(pending);
      pending = null;
      pendingResult?.(ok);
      pendingResult = null;
    }
  }, SAVE_DEBOUNCE_MS);
}

// A structural write must supersede any older debounced keystroke snapshot.
// Otherwise an old timer can resurrect a deleted article or drop a newly-created one.
function cancelPendingSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  pending = null;
  pendingResult = null;
}

function flushPendingSave(): boolean {
  if (!pending) return true;
  if (saveTimer) clearTimeout(saveTimer);
  const articles = pending;
  const onResult = pendingResult;
  saveTimer = null;
  pending = null;
  pendingResult = null;
  const ok = saveAll(articles);
  onResult?.(ok);
  return ok;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

interface Store {
  articles: Article[];
  hydrated: boolean;
  corrupted: boolean;
  saveState: 'saved' | 'saving' | 'error';
  hydrate: () => void;
  flush: () => boolean;
  discardCorrupt: () => void;
  create: (brief: Brief) => Article;
  get: (id: string) => Article | undefined;
  update: (id: string, patch: Partial<Article>) => void;
  setContent: (id: string, content: string) => void;
  setDraft: (id: string, platform: PlatformId, draft: string) => void;
  remove: (id: string) => void;
  restore: (articles: Article[]) => { total: number; saved: boolean };
}

export const useArticleStore = create<Store>((set, get) => ({
  articles: [],
  hydrated: false,
  corrupted: false,
  saveState: 'saved',
  hydrate: () => {
    if (get().hydrated) return;
    const articles = loadAll();
    set({ articles, hydrated: true, corrupted: corruptRaw !== null });
  },
  // 用户明确选择丢弃损坏数据后再恢复正常写盘。
  discardCorrupt: () => {
    corruptRaw = null;
    const ok = saveAll(get().articles);
    set({ corrupted: false, saveState: ok ? 'saved' : 'error' });
  },
  flush: () => flushPendingSave(),
  create: (brief) => {
    const article: Article = {
      id: uid(),
      title: '未命名文章',
      brief,
      content: '',
      platformDrafts: {},
      templateId: brief.templateId ?? loadConfig().defaultTemplateId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const articles = [article, ...get().articles];
    cancelPendingSave();
    const saved = saveAll(articles);
    set({ articles, saveState: saved ? 'saved' : 'error' });
    return article;
  },
  get: (id) => get().articles.find((a) => a.id === id),
  update: (id, patch) => {
    const articles = get().articles.map((a) =>
      a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a,
    );
    set({ articles, saveState: 'saving' });
    queueSave(articles, (saved) => set({ saveState: saved ? 'saved' : 'error' }));
  },
  setContent: (id, content) => {
    get().update(id, { content });
  },
  setDraft: (id, platform, draft) => {
    const article = get().get(id);
    if (!article) return;
    const platformDrafts = { ...article.platformDrafts, [platform]: draft };
    get().update(id, { platformDrafts });
  },
  remove: (id) => {
    const articles = get().articles.filter((a) => a.id !== id);
    cancelPendingSave();
    const saved = saveAll(articles);
    set({ articles, saveState: saved ? 'saved' : 'error' });
  },
  restore: (incoming) => {
    flushPendingSave();
    cancelPendingSave();
    // 从备份恢复是一次显式恢复动作：如果之前数据损坏，恢复后清掉损坏保护。
    corruptRaw = null;
    const articles = mergeArticles(get().articles, incoming);
    const saved = saveAll(articles);
    set({ articles, corrupted: false, saveState: saved ? 'saved' : 'error' });
    return { total: articles.length, saved };
  },
}));
