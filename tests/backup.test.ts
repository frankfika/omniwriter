// backup 模块自检：覆盖 createBackup / parseBackup / restoreCustomAgents / mergeArticles。
// 重点锁 round 4 codex 评审发现的「备份漏写 customAgents」P0：用户换设备后所有
// 自己孵化的写作流程全部丢失，其它数据恢复都没意义。
import { describe, expect, it, vi } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  createBackup,
  mergeArticles,
  parseBackup,
  restoreCustomAgents,
} from '../src/lib/backup';
import { listCustomAgents, saveCustomAgent } from '../src/lib/custom-agents';

// jsdom 不带 localStorage 的 getItem/setItem 时会抛错；这里给最小 stub。
function withStorage<T>(fn: () => T): T {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  vi.stubGlobal('window', { localStorage: stub });
  try { return fn(); } finally { vi.unstubAllGlobals(); }
}

describe('createBackup', () => {
  it('写齐 format / version / exportedAt / articles / config / customAgents', () => {
    withStorage(() => {
      const articles = [{ id: 'a1', title: 'T', content: '', contentEn: '', brief: { material: 'm', materialType: 'topic', angle: '', voice: 'editorial', length: 'medium', platforms: [], bilingual: false }, platformDrafts: {}, templateId: 'paper', createdAt: 100, updatedAt: 100 }];
      const cfg = { defaultPlatforms: ['wechat'], bilingual: false, voice: 'editorial', length: 'medium' };
      saveCustomAgent({ id: 'custom-x', emoji: '🧪', name: 'X', tagline: 't', description: '', group: 'craft', defaults: { materialType: 'topic', voice: 'relaxed', length: 'medium', platforms: [], angle: '' }, inputHint: '', directive: 'd', pluginIds: [], createdAt: 100 });
      const backup = createBackup(articles, cfg);
      expect(backup.format).toBe(BACKUP_FORMAT);
      expect(backup.version).toBe(BACKUP_VERSION);
      expect(backup.articles).toEqual(articles);
      expect(backup.config).toBe(cfg);
      expect(backup.customAgents?.length).toBe(1);
      expect(backup.customAgents?.[0].name).toBe('X');
    });
  });

  it('导出时不带 API Key——CreatorConfig 不应包含 apiKey/baseUrl', () => {
    withStorage(() => {
      const backup = createBackup([], { defaultPlatforms: [], bilingual: false, voice: 'editorial', length: 'medium' });
      const json = JSON.stringify(backup);
      expect(json).not.toContain('apiKey');
      expect(json).not.toContain('baseUrl');
      expect(json).not.toContain('ANTHROPIC');
    });
  });
});

describe('parseBackup', () => {
  it('合法 v1：articles + customAgents 都保留', () => {
    const json = JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: '2026-09-29T00:00:00.000Z',
      articles: [{ id: 'a1', title: 'T', content: '', contentEn: '', brief: { material: 'm', materialType: 'topic', angle: '', voice: 'editorial', length: 'medium', platforms: [], bilingual: false }, platformDrafts: {}, templateId: 'paper', createdAt: 100, updatedAt: 100 }],
      config: { voice: 'editorial' },
      customAgents: [{ id: 'custom-y', emoji: '🧬', name: 'Y', tagline: 't', description: '', group: 'craft', defaults: { materialType: 'topic', voice: 'relaxed', length: 'medium', platforms: [], angle: '' }, inputHint: '', directive: 'd', pluginIds: [], createdAt: 100 }],
    });
    const parsed = parseBackup(json);
    expect(parsed.articles.length).toBe(1);
    expect(parsed.customAgents?.length).toBe(1);
    expect(parsed.customAgents?.[0].id).toBe('custom-y');
  });

  it('合法 v1 但无 customAgents 字段（旧备份）：不抛错，返回空数组', () => {
    const json = JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: '2026-09-29T00:00:00.000Z',
      articles: [],
    });
    const parsed = parseBackup(json);
    expect(parsed.customAgents).toEqual([]);
  });

  it('customAgents 字段存在但不是数组：抛错，避免半截恢复', () => {
    const json = JSON.stringify({
      format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: '',
      articles: [], customAgents: 'not an array',
    });
    expect(() => parseBackup(json)).toThrow(/customAgents/);
  });

  it('customAgents 数组里含非法条目：静默跳过，不阻塞其他恢复', () => {
    const json = JSON.stringify({
      format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: '',
      articles: [],
      customAgents: [
        { id: 'good-1', name: 'Good', directive: 'd', createdAt: 1 },
        { /* 缺 id */ name: 'Bad', directive: 'd', createdAt: 1 },
        'a string entry',
        null,
      ],
    });
    const parsed = parseBackup(json);
    expect(parsed.customAgents?.length).toBe(1);
    expect(parsed.customAgents?.[0].id).toBe('good-1');
  });

  it('format / version 不匹配：抛错而不是静默吞掉', () => {
    const json = JSON.stringify({ format: 'wrong', version: 0, articles: [], exportedAt: '' });
    expect(() => parseBackup(json)).toThrow(/不是受支持的/);
  });

  it('顶层是数组（早期直接导出 articles）：兼容当作 v1 处理', () => {
    const arr = [{ id: 'a1', title: 'T', content: '', contentEn: '', brief: { material: 'm', materialType: 'topic', angle: '', voice: 'editorial', length: 'medium', platforms: [], bilingual: false }, platformDrafts: {}, templateId: 'paper', createdAt: 1, updatedAt: 1 }];
    const parsed = parseBackup(JSON.stringify(arr));
    expect(parsed.articles).toEqual(arr);
  });

  it('非法 JSON：抛错', () => {
    expect(() => parseBackup('{ not json')).toThrow(/有效的 JSON/);
  });
});

describe('mergeArticles', () => {
  const make = (id: string, updatedAt: number) => ({
    id, title: id, content: '', contentEn: '',
    brief: { material: 'm', materialType: 'topic', angle: '', voice: 'editorial', length: 'medium', platforms: [], bilingual: false },
    platformDrafts: {}, templateId: 'paper', createdAt: 1, updatedAt,
  });

  it('同 id：保留 updatedAt 较大的那份', () => {
    const result = mergeArticles([make('a', 100)], [make('a', 200)]);
    expect(result.length).toBe(1);
    expect(result[0]?.updatedAt).toBe(200);
  });

  it('不同 id：两篇都保留，按 updatedAt 倒序', () => {
    const result = mergeArticles([make('a', 100)], [make('b', 200)]);
    expect(result.map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('空输入：返回 current 副本（不修改引用）', () => {
    const original = [make('a', 1)];
    const result = mergeArticles(original, []);
    expect(result).toEqual(original);
    expect(result).not.toBe(original);
  });
});

describe('restoreCustomAgents', () => {
  it('把备份里的 customAgents 写回 localStorage；不存在的被忽略', () => {
    withStorage(() => {
      const backup = [
        { id: 'custom-r1', emoji: '🧪', name: 'R1', tagline: 't', description: '', group: 'craft', defaults: { materialType: 'topic', voice: 'relaxed', length: 'medium', platforms: [], angle: '' }, inputHint: '', directive: 'd', pluginIds: [], createdAt: 100 },
        { id: 'custom-r2', emoji: '🧬', name: 'R2', tagline: 't', description: '', group: 'opinion', defaults: { materialType: 'topic', voice: 'relaxed', length: 'medium', platforms: [], angle: '' }, inputHint: '', directive: 'd', pluginIds: [], createdAt: 100 },
      ];
      restoreCustomAgents(backup);
      const stored = listCustomAgents();
      expect(stored.map((a) => a.id).sort()).toEqual(['custom-r1', 'custom-r2']);
    });
  });

  it('空数组：什么都不做、不抛错', () => {
    withStorage(() => {
      expect(() => restoreCustomAgents([])).not.toThrow();
      expect(listCustomAgents()).toEqual([]);
    });
  });
});