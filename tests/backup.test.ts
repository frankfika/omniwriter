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
  reconcileAgentOverrides,
  restoreCustomAgents,
} from '../src/lib/backup';
import { listCustomAgents, saveCustomAgent } from '../src/lib/custom-agents';
import type { Article, CreatorConfig, Voice } from '../src/lib/types';
import type { CustomAgent } from '../src/lib/custom-agents';
import type { AgentGroup } from '../src/lib/agents';

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

function makeArticle(id: string, updatedAt: number = 1): Article {
  return {
    id, title: id, content: '',
    brief: { material: 'm', materialType: 'topic', angle: '', voice: 'editorial', length: 'medium', platforms: [], bilingual: false },
    platformDrafts: {}, templateId: 'paper', createdAt: 1, updatedAt,
  };
}

function makeCustomAgent(id: string, group: AgentGroup = 'craft', createdAt: number = 100): CustomAgent {
  return {
    id, emoji: '🧪', name: id, tagline: 't', description: '', group,
    defaults: { materialType: 'topic', voice: 'relaxed', length: 'medium', platforms: [], angle: '' },
    inputHint: '', directive: 'd', pluginIds: [], createdAt,
  };
}

const baseConfig: CreatorConfig = {
  defaultPlatforms: ['wechat'],
  bilingual: false,
  voice: 'editorial' as Voice,
  seriesTitle: '',
  wechatEyebrow: 'FRANK\'S AI NOTES',
  newsEyebrow: 'FRANK\'S AI NOTES',
  authorSignature: '',
  defaultTemplateId: 'graphite',
};

describe('createBackup', () => {
  it('写齐 format / version / exportedAt / articles / config / customAgents', () => {
    withStorage(() => {
      saveCustomAgent(makeCustomAgent('custom-x'));
      const backup = createBackup([makeArticle('a1')], baseConfig);
      expect(backup.format).toBe(BACKUP_FORMAT);
      expect(backup.version).toBe(BACKUP_VERSION);
      expect(backup.articles.length).toBe(1);
      expect(backup.config).toBe(baseConfig);
      expect(backup.customAgents?.length).toBe(1);
      expect(backup.customAgents?.[0].name).toBe('custom-x');
    });
  });

  it('导出时不带 API Key——CreatorConfig 不应包含 apiKey/baseUrl', () => {
    withStorage(() => {
      const backup = createBackup([], baseConfig);
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
      articles: [makeArticle('a1')],
      config: { voice: 'editorial' },
      customAgents: [makeCustomAgent('custom-y')],
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
        { id: 'good-1', name: 'Good', directive: 'd', createdAt: 1, emoji: '', tagline: '', description: '', group: 'craft', defaults: {}, inputHint: '', pluginIds: [] },
        { /* 缺 id */ name: 'Bad', directive: 'd', createdAt: 1, emoji: '', tagline: '', description: '', group: 'craft', defaults: {}, inputHint: '', pluginIds: [] },
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
    const parsed = parseBackup(JSON.stringify([makeArticle('a1')]));
    expect(parsed.articles.length).toBe(1);
  });

  it('verdict 形状合法：完整保留 passed / score / issues / suggestions', () => {
    const article = makeArticle('a1');
    article.verdict = {
      model: 'claude-cross-check',
      passed: true,
      score: 92,
      issues: ['原文缺少第二段过渡', '结论段缺少链接'],
      suggestions: ['补一段桥接', '加上原始来源'],
    };
    const json = JSON.stringify({
      format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: '',
      articles: [article],
    });
    const parsed = parseBackup(json);
    expect(parsed.articles.length).toBe(1);
    expect(parsed.articles[0].verdict?.passed).toBe(true);
    expect(parsed.articles[0].verdict?.score).toBe(92);
    expect(parsed.articles[0].verdict?.issues).toEqual(['原文缺少第二段过渡', '结论段缺少链接']);
    expect(parsed.articles[0].verdict?.suggestions).toEqual(['补一段桥接', '加上原始来源']);
    expect(parsed.articles[0].verdict?.model).toBe('claude-cross-check');
  });

  it('verdict 形状非法（passed 非 bool / issues 非数组）：导入成功但 verdict 为 undefined', () => {
    // 三种典型畸形：(a) passed 不是 boolean；(b) issues 不是数组；
    // (c) suggestions 不是数组。每种情况都静默丢弃 verdict，不阻塞整篇恢复。
    const malformedA = makeArticle('bad-1');
    (malformedA as unknown as Record<string, unknown>).verdict = { passed: 'not-bool', score: 80, issues: [], suggestions: [] };
    const malformedB = makeArticle('bad-2');
    (malformedB as unknown as Record<string, unknown>).verdict = { passed: true, score: 80, issues: 'not-array', suggestions: [] };
    const malformedC = makeArticle('bad-3');
    (malformedC as unknown as Record<string, unknown>).verdict = { passed: true, score: 80, issues: [], suggestions: 42 };
    const json = JSON.stringify({
      format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: '',
      articles: [malformedA, malformedB, malformedC],
    });
    const parsed = parseBackup(json);
    expect(parsed.articles.length).toBe(3);
    for (const article of parsed.articles) {
      expect(article.verdict).toBeUndefined();
    }
  });

  it('非法 JSON：抛错', () => {
    expect(() => parseBackup('{ not json')).toThrow(/有效的 JSON/);
  });
});

describe('mergeArticles', () => {
  it('同 id：保留 updatedAt 较大的那份', () => {
    const result = mergeArticles([makeArticle('a', 100)], [makeArticle('a', 200)]);
    expect(result.length).toBe(1);
    expect(result[0]?.updatedAt).toBe(200);
  });

  it('不同 id：两篇都保留，按 updatedAt 倒序', () => {
    const result = mergeArticles([makeArticle('a', 100)], [makeArticle('b', 200)]);
    expect(result.map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('空输入：返回 current 副本（不修改引用）', () => {
    const original = [makeArticle('a', 1)];
    const result = mergeArticles(original, []);
    expect(result).toEqual(original);
    expect(result).not.toBe(original);
  });
});

describe('restoreCustomAgents', () => {
  it('把备份里的 customAgents 写回 localStorage；不存在的被忽略', () => {
    withStorage(() => {
      restoreCustomAgents([makeCustomAgent('custom-r1', 'craft'), makeCustomAgent('custom-r2', 'opinion')]);
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

describe('reconcileAgentOverrides', () => {
  it('保留指向 builtin Agent 的 override', () => {
    const result = reconcileAgentOverrides(
      { ...baseConfig, agentOverrides: { opinion: { directive: 'd' } } },
      [],
    );
    expect(result.agentOverrides?.opinion).toEqual({ directive: 'd' });
  });

  it('保留指向已恢复 customAgent 的 override', () => {
    const result = reconcileAgentOverrides(
      { ...baseConfig, agentOverrides: { 'custom-x': { directive: 'd' } } },
      [makeCustomAgent('custom-x')],
    );
    expect(result.agentOverrides?.['custom-x']).toEqual({ directive: 'd' });
  });

  it('丢弃指向未恢复 customAgent 的 override（防止永远命中不到的死 override）', () => {
    const result = reconcileAgentOverrides(
      { ...baseConfig, agentOverrides: { 'custom-missing': { directive: 'd' }, opinion: { directive: 'k' } } },
      [],
    );
    expect(result.agentOverrides?.['custom-missing']).toBeUndefined();
    expect(result.agentOverrides?.opinion).toEqual({ directive: 'k' });
  });

  it('无 overrides 时返回原 config（不动其它字段）', () => {
    const result = reconcileAgentOverrides(baseConfig, []);
    expect(result).toEqual(baseConfig);
  });
});