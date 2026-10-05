// WP-C: generateMasterStream 大纲阶段自检。沿用 ai-guardrails 的 vi.mock('@anthropic-ai/sdk') 写法。
// 关注三件事：short 不调 create、medium 先 create 再 stream 且正文 prompt 含大纲、大纲失败静默降级。
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const cannedDraft = '# 测试标题\n\n正文段落一。\n\n正文段落二。';
  const cannedOutline = '# 测试标题\n\n## 第一节\n- 要点 A\n\n## 第二节\n- 要点 B';
  const createMock = vi.fn();
  let lastStreamUserPrompt = '';
  let streamInvocations = 0;
  // 模拟 SDK 的 stream 流式事件：注册 'text' 监听 → finalMessage 触发一次完整 delta。
  // 真实 SDK 在流式过程中会分多次发 text 事件；测试关心的是「onText 至少被触发一次且拿到全文」，
  // 所以一发整段已足够覆盖契约。
  const streamMock = (params: { messages: Array<{ content: string }> }, _opts?: unknown) => {
    streamInvocations += 1;
    lastStreamUserPrompt = params.messages[0]?.content ?? '';
    const handlers = new Map<string, Array<(delta: string, snapshot: string) => void>>();
    return {
      on: (event: string, handler: (delta: string, snapshot: string) => void) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
      finalMessage: async () => {
        const textHandlers = handlers.get('text') ?? [];
        textHandlers.forEach((h) => h(cannedDraft, cannedDraft));
        return { content: [{ type: 'text', text: cannedDraft }] };
      },
    };
  };
  return {
    cannedDraft,
    cannedOutline,
    createMock,
    streamMock,
    getLastStreamUserPrompt: () => lastStreamUserPrompt,
    getStreamInvocations: () => streamInvocations,
    resetStreamInvocations: () => { streamInvocations = 0; lastStreamUserPrompt = ''; },
  };
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      // create 既被大纲调用，也可能被 ensureBilingualMaster 调用——具体调几次、参数是什么，由测试断言去卡。
      create: (...args: unknown[]) => mocks.createMock(...args),
      stream: mocks.streamMock,
    };
    constructor(public options: unknown) {}
  },
}));

import { generateMasterStream } from '../src/lib/ai';

function baseBrief(length: 'short' | 'medium' | 'long') {
  return {
    material: 'm',
    materialType: 'topic' as const,
    angle: '角度',
    voice: 'relaxed' as const,
    length,
    platforms: ['wechat'] as const,
    bilingual: false,
  };
}

describe('WP-C: generateMasterStream 大纲阶段', () => {
  it('short 篇幅不生成大纲，直接走正文流式', async () => {
    mocks.createMock.mockReset();
    mocks.resetStreamInvocations();
    // short 不应触发 create——给一个若被调用就 throw 的实现，方便失败时立刻看出来。
    mocks.createMock.mockRejectedValue(new Error('short 阶段不应调 create'));

    const textChunks: string[] = [];
    let outlineCalls = 0;
    const result = await generateMasterStream(
      baseBrief('short') as never,
      'm',
      undefined,
      { apiKey: 'sk-test' },
      {
        onText: (delta) => textChunks.push(delta),
        onOutline: () => { outlineCalls += 1; },
      },
    );

    // 1) 大纲 create 一次都不该调。
    expect(mocks.createMock).not.toHaveBeenCalled();
    // 2) 正文 stream 调了一次。
    expect(mocks.getStreamInvocations()).toBe(1);
    // 3) onText 契约不变：onText 至少触发一次，合并起来等于模型返回值。
    expect(textChunks.join('')).toBe(mocks.cannedDraft);
    expect(result).toBe(mocks.cannedDraft);
    // 4) short 也调用 onOutline（参数是空串），统一契约便于 UI 端无须判 length。
    expect(outlineCalls).toBe(1);
  });

  it('medium 篇幅先生成大纲再流式正文，且正文 prompt 含大纲', async () => {
    mocks.createMock.mockReset();
    mocks.resetStreamInvocations();
    // 第一次 create 是大纲；brief.bilingual=false，ensureBilingualMaster 不会再调 create。
    mocks.createMock.mockResolvedValueOnce({ content: [{ type: 'text', text: mocks.cannedOutline }] });

    const outlineSeen: string[] = [];
    await generateMasterStream(
      baseBrief('medium') as never,
      'm',
      undefined,
      { apiKey: 'sk-test' },
      { onOutline: (outline) => outlineSeen.push(outline) },
    );

    // 1) 大纲阶段确实调了 messages.create，且 max_tokens=600。
    expect(mocks.createMock).toHaveBeenCalledTimes(1);
    const outlineArgs = mocks.createMock.mock.calls[0][0];
    expect(outlineArgs.max_tokens).toBe(600);
    // 2) 大纲系统提示里不应该有「风格执行细则」（精简 prompt），把 600 token 留给实际大纲。
    expect(outlineArgs.system).not.toContain('风格执行细则');
    expect(outlineArgs.system).toMatch(/Markdown 大纲/);
    // 3) 大纲请求的 user content 应带「中（800–2000 字）」长度档位和素材/创作指令段。
    const outlineUser = outlineArgs.messages[0].content as string;
    expect(outlineUser).toContain('中（800–2000 字）');
    expect(outlineUser).toContain('## 素材');
    expect(outlineUser).toContain('## 创作指令');

    // 4) onOutline 拿到了非空大纲。
    expect(outlineSeen).toEqual([mocks.cannedOutline]);

    // 5) 正文流式调用的 user prompt 必须包含大纲文本，且嵌在「## 写作大纲（严格按此结构展开）」标题下。
    const streamPrompt = mocks.getLastStreamUserPrompt();
    expect(streamPrompt).toContain('## 写作大纲（严格按此结构展开）');
    expect(streamPrompt).toContain(mocks.cannedOutline);
    // 大纲段必须位于「## 风格执行细则」之前——先结构后语调。
    expect(streamPrompt.indexOf('## 写作大纲（严格按此结构展开）'))
      .toBeLessThan(streamPrompt.indexOf('## 风格执行细则'));

    // 6) 大纲之后才调 stream（顺序契约）。
    expect(mocks.getStreamInvocations()).toBe(1);
  });

  it('大纲生成失败时静默降级，正文照常流式', async () => {
    mocks.createMock.mockReset();
    mocks.resetStreamInvocations();
    mocks.createMock.mockRejectedValueOnce(new Error('mock 网络超时'));

    const outlineSeen: string[] = [];
    const result = await generateMasterStream(
      baseBrief('medium') as never,
      'm',
      undefined,
      { apiKey: 'sk-test' },
      {
        onOutline: (outline) => outlineSeen.push(outline),
        onText: () => { /* 仅触发流式 */ },
      },
    );

    // 1) 大纲 create 调了 1 次但被吞掉；onOutline 收到的是空字符串。
    expect(mocks.createMock).toHaveBeenCalledTimes(1);
    expect(outlineSeen).toEqual(['']);
    // 2) 正文流式照样完成——这是降级契约，函数绝不能因为大纲失败抛错。
    expect(mocks.getStreamInvocations()).toBe(1);
    expect(result).toBe(mocks.cannedDraft);
    // 3) 降级路径下正文 prompt 不应再带「## 写作大纲」段。
    expect(mocks.getLastStreamUserPrompt()).not.toContain('## 写作大纲（严格按此结构展开）');
  });
});
