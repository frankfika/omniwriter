// 自定义 Agent（能力市场「孵化」）纯逻辑自检：解析容错与合并排序。
// 不碰 localStorage（node 环境没有 window），只测纯函数。
import { describe, expect, it } from 'vitest';
import { AGENTS, mergeBrief } from '../src/lib/agents';
import { mergeCustomAgents, parseCustomAgents, type CustomAgent } from '../src/lib/custom-agents';

const sample: CustomAgent = {
  id: 'custom-1',
  emoji: '🧬',
  name: '我的 Agent',
  tagline: '口号',
  description: '描述',
  group: 'craft',
  defaults: { materialType: 'topic', voice: 'relaxed', length: 'medium', platforms: [], angle: '' },
  inputHint: '贴素材…',
  directive: '克制一点',
  pluginIds: [],
  createdAt: 1,
};

describe('parseCustomAgents', () => {
  it('空值返回空数组', () => {
    expect(parseCustomAgents(null)).toEqual([]);
    expect(parseCustomAgents('')).toEqual([]);
  });

  it('损坏 JSON 返回空数组而不抛错', () => {
    expect(parseCustomAgents('{oops')).toEqual([]);
  });

  it('非数组或非对象条目被丢弃', () => {
    expect(parseCustomAgents('"just a string"')).toEqual([]);
    expect(parseCustomAgents(JSON.stringify([null, 1, {}, sample]))).toEqual([sample]);
  });

  it('缺关键字段（id/name/directive）的条目被丢弃', () => {
    const noDirective = { ...sample, directive: undefined };
    expect(parseCustomAgents(JSON.stringify([noDirective]))).toEqual([]);
  });

  it('合法数据完整往返', () => {
    expect(parseCustomAgents(JSON.stringify([sample]))).toEqual([sample]);
  });
});

describe('mergeCustomAgents', () => {
  it('自定义排在内置前面', () => {
    const merged = mergeCustomAgents(AGENTS, [sample]);
    expect(merged[0]).toBe(sample);
    expect(merged).toHaveLength(AGENTS.length + 1);
  });

  it('空自定义列表返回内置原样', () => {
    expect(mergeCustomAgents(AGENTS, [])).toEqual(AGENTS);
  });
});

describe('自定义 Agent 走 mergeBrief 建稿', () => {
  it('结构同 WriterAgent，可直接生成带 agentId 的 Brief', () => {
    const brief = mergeBrief(sample);
    expect(brief.agentId).toBe('custom-1');
    expect(brief.voice).toBe('relaxed');
    expect(brief.platforms).toEqual([]);
  });
});
