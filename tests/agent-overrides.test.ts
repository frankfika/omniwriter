// Agent 定制（能力市场「配置」）纯逻辑自检：override 的 merge 语义与 mergeBrief 生效路径。
// 不碰 localStorage（node 环境没有 window），只测纯函数。
import { describe, expect, it } from 'vitest';
import { AGENTS, mergeBrief, resolveAgent } from '../src/lib/agents';
import { mergeAgentOverride } from '../src/lib/config';
import type { AgentOverride } from '../src/lib/types';

describe('mergeAgentOverride', () => {
  it('空基础上应用 patch：directive 与 defaults 都被写入', () => {
    const merged = mergeAgentOverride(undefined, {
      directive: '克制一点',
      defaults: { voice: 'editorial', bilingual: true },
    });
    expect(merged.directive).toBe('克制一点');
    expect(merged.defaults).toEqual({ voice: 'editorial', bilingual: true });
  });

  it('再次 patch 只覆盖给定字段，其余保留', () => {
    const base = mergeAgentOverride(undefined, {
      directive: '第一版',
      defaults: { voice: 'essay', length: 'long', platforms: ['x'] },
    });
    const merged = mergeAgentOverride(base, { defaults: { length: 'short' } });
    expect(merged.directive).toBe('第一版');
    expect(merged.defaults).toEqual({ voice: 'essay', length: 'short', platforms: ['x'] });
  });

  it('patch 显式给 directive 空串时覆盖旧值（用户清空了指令）', () => {
    const base = mergeAgentOverride(undefined, { directive: '旧指令' });
    expect(mergeAgentOverride(base, { directive: '' }).directive).toBe('');
  });
});

describe('override defaults 经 mergeBrief 生效', () => {
  it('override 的 voice/length/platforms/bilingual 覆盖 Agent 内置预设', () => {
    const agent = resolveAgent('news-fast')!;
    const override: AgentOverride = {
      directive: '只写三件事',
      defaults: { voice: 'essay', length: 'long', platforms: ['wechat'], bilingual: true },
    };
    const brief = mergeBrief(agent, undefined, { ...override.defaults, voice: override.defaults!.voice! });
    expect(brief.voice).toBe('essay');
    expect(brief.length).toBe('long');
    expect(brief.platforms).toEqual(['wechat']);
    expect(brief.bilingual).toBe(true);
    expect(brief.agentId).toBe('news-fast');
  });

  it('无 override 时保持内置预设不变（回归保护）', () => {
    const agent = resolveAgent('xiaohongshu')!;
    const brief = mergeBrief(agent, undefined, { voice: agent.defaults.voice ?? 'relaxed' });
    expect(brief.length).toBe('short');
    expect(brief.platforms).toEqual(['xiaohongshu']);
    expect(brief.voice).toBe('social');
  });

  it('所有内置 Agent 的 directive 非空（服务端回退链可用）', () => {
    for (const agent of AGENTS) {
      expect(agent.directive.trim().length).toBeGreaterThan(0);
    }
  });
});
