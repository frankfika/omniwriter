import type { Article, CreatorConfig } from './types';
import type { CrossValidationVerdict } from './generation-events';
import { DEFAULT_CONFIG } from './config';
import type { CustomAgent } from './custom-agents';
import { listCustomAgents, saveCustomAgent } from './custom-agents';
import { AGENTS } from './agents';

export const BACKUP_FORMAT = 'omniwriter-backup' as const;
export const BACKUP_VERSION = 1 as const;

export interface OmniWriterBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  articles: Article[];
  config?: CreatorConfig;
  customAgents?: CustomAgent[];
}

export function createBackup(articles: Article[], config: CreatorConfig): OmniWriterBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    articles,
    config,
    // 用户自己孵化的 Agent 是备份最有价值的部分（其它备份可通过数据恢复得到的；Agent 全平台迁移）——
    // 之前漏掉它会让「换设备 / 重装浏览器」后失去所有自己训出来的写作流程。
    customAgents: listCustomAgents(),
  };
}

export function parseBackup(raw: string): OmniWriterBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('备份文件不是有效的 JSON');
  }

  // 兼容早期直接导出的文章数组，避免格式升级后旧备份失效。
  if (Array.isArray(parsed)) {
    const articles = validateArticles(parsed);
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      articles,
    };
  }

  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT || parsed.version !== BACKUP_VERSION) {
    throw new Error('不是受支持的 OmniWriter 备份文件');
  }
  const articles = validateArticles(parsed.articles);
  const config = isRecord(parsed.config)
    ? { ...DEFAULT_CONFIG, ...parsed.config } as CreatorConfig
    : undefined;
  const customAgents = validateCustomAgents(parsed.customAgents);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : new Date().toISOString(),
    articles,
    config,
    customAgents,
  };
}

// 备份恢复时把孵化出来的 Agent 写回 localStorage，与导入平台稿并行。
// 重复 id 会被 saveCustomAgent 内部去重（listCustomAgents().filter(id !== agent.id)）。
export function restoreCustomAgents(agents: CustomAgent[]): void {
  for (const agent of agents) saveCustomAgent(agent);
}

// 备份里的 agentOverrides 可能引用「已在 builtin 里被移除 / 自定义没恢复」的 Agent，
// 把它们原样写回去会出现「永远命中不到的 override」。一次性调平，避免用户困惑。
export function reconcileAgentOverrides(
  config: CreatorConfig,
  restoredCustomAgents: CustomAgent[],
): CreatorConfig {
  const overrides = config.agentOverrides;
  if (!overrides || Object.keys(overrides).length === 0) return config;
  const validIds = new Set<string>([
    ...AGENTS.map((agent) => agent.id),
    ...restoredCustomAgents.map((agent) => agent.id),
  ]);
  const filtered: Record<string, typeof overrides[string]> = {};
  for (const [id, patch] of Object.entries(overrides)) {
    if (validIds.has(id)) filtered[id] = patch;
  }
  return { ...config, agentOverrides: filtered };
}

export function mergeArticles(current: Article[], incoming: Article[]): Article[] {
  const byId = new Map(current.map((article) => [article.id, article]));
  for (const article of incoming) {
    const existing = byId.get(article.id);
    if (!existing || article.updatedAt >= existing.updatedAt) byId.set(article.id, article);
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function validateArticles(value: unknown): Article[] {
  if (!Array.isArray(value)) throw new Error('备份中缺少文章列表');
  if (!value.every(isArticle)) throw new Error('备份中包含无法识别的文章数据');
  // 清洗 verdict：保留形状合法的；形状非法或缺字段时静默删字段，不阻塞整篇恢复。
  // 必发事故：page.tsx 的标题行直接 `.map(verdict.issues)` / `.map(verdict.suggestions)`，
  // 备份里 issues 不是数组时直接白屏。清洗掉畸形 verdict 比拒绝整篇更友好——
  // 用户丢一个旧 AI 核查摘要总比丢整篇文章好。
  return value.map(sanitizeArticleVerdict);
}

function sanitizeArticleVerdict(article: Article): Article {
  const verdict = (article as { verdict?: unknown }).verdict;
  if (!isRecord(verdict)) {
    if (verdict !== undefined) delete article.verdict;
    return article;
  }
  const cleaned = cleanVerdict(verdict);
  if (!cleaned) {
    delete article.verdict;
    return article;
  }
  article.verdict = cleaned;
  return article;
}

function cleanVerdict(value: Record<string, unknown>): CrossValidationVerdict | null {
  if (typeof value.passed !== 'boolean') return null;
  if (typeof value.score !== 'number' || !Number.isFinite(value.score)) return null;
  if (!Array.isArray(value.issues) || !Array.isArray(value.suggestions)) return null;
  return {
    model: typeof value.model === 'string' ? value.model : 'unknown',
    passed: value.passed,
    score: value.score,
    issues: value.issues.filter((item): item is string => typeof item === 'string'),
    suggestions: value.suggestions.filter((item): item is string => typeof item === 'string'),
    ...(typeof value.fallback === 'string' ? { fallback: value.fallback } : {}),
  };
}

function validateCustomAgents(value: unknown): CustomAgent[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('备份中 customAgents 字段格式错误');
  return value.filter(isCustomAgent);
}

function isCustomAgent(value: unknown): value is CustomAgent {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.name === 'string'
    && typeof value.directive === 'string'
    && typeof value.createdAt === 'number'
    && Number.isFinite(value.createdAt);
}

function isArticle(value: unknown): value is Article {
  if (!isRecord(value) || !isRecord(value.brief) || !isRecord(value.platformDrafts)) return false;
  return typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.title === 'string'
    && typeof value.content === 'string'
    && typeof value.createdAt === 'number'
    && Number.isFinite(value.createdAt)
    && typeof value.updatedAt === 'number'
    && Number.isFinite(value.updatedAt)
    && typeof value.brief.material === 'string'
    && typeof value.brief.materialType === 'string'
    && Array.isArray(value.brief.platforms);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
