// ai.ts 防护逻辑自检：baseUrl SSRF 校验 + X 平台截断不切 URL。
// 运行：在主仓库根目录执行 node_modules/.bin/vitest run --root <本 worktree 路径>
import { describe, expect, it, vi } from 'vitest';

const { cannedDraft } = vi.hoisted(() => {
  // 200 字正文 + 60 字符 URL + 结尾余量：240 字截断点正好落在 URL 中间。
  const url = 'https://example.com/a/very/long/path/that/must/not/be/halved-1234567890';
  const body = '这是一个用于验证截断行为的中文段落，重复填充以达到指定长度。'.repeat(8).slice(0, 200);
  return { cannedDraft: `${body}${url} 后续还有更多正文内容，确保总长度明显超过两百四十字的软上限，从而触发截断逻辑。` };
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: async () => ({ content: [{ type: 'text', text: cannedDraft }] }) };
    constructor(public options: unknown) {}
  },
}));

import { adaptPlatform, getClient } from '../src/lib/ai';

describe('getClient baseUrl 校验', () => {
  const blocked = [
    'http://api.example.com',
    'https://127.0.0.1:8080',
    'https://10.0.0.2',
    'https://172.16.0.9',
    'https://192.168.1.5',
    'https://169.254.169.254',
    'https://[::1]',
    'https://localhost:3000',
    'https://gateway.internal',
    'not-a-url',
  ];
  it.each(blocked)('拒绝 %s', (baseUrl) => {
    expect(() => getClient({ apiKey: 'sk-test', baseUrl })).toThrowError(/AI 接口地址/);
  });
  it.each(['https://api.minimaxi.com/anthropic', 'https://api.anthropic.com', 'https://my-proxy.example.com/v1'])(
    '放行公网 https 地址 %s',
    (baseUrl) => expect(() => getClient({ apiKey: 'sk-test', baseUrl })).not.toThrow(),
  );
});

describe('X 平台 240 字截断', () => {
  const brief = {
    material: 'm', materialType: 'topic', angle: '', voice: 'relaxed',
    length: 'medium', platforms: ['x'], bilingual: false,
  } as const;
  it('截断不切在 URL 中间', async () => {
    const result = await adaptPlatform(brief as never, '母稿', 'x', { apiKey: 'sk-test' });
    expect(Array.from(result).length).toBeLessThanOrEqual(240);
    // URL 要么完整保留，要么整体退掉，不允许出现半个链接。
    if (result.includes('https://example.com')) {
      expect(result).toContain('https://example.com/a/very/long/path/that/must/not/be/halved-1234567890');
    }
    expect(result).not.toMatch(/https?:\/\/\S{0,40}$/);
  });
});
