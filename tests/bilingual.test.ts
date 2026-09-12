// bilingual 纯函数自检：split/join 往返幂等与边界。
import { describe, expect, it } from 'vitest';
import { joinBilingualContent, splitBilingualContent } from '../src/lib/bilingual';

describe('split/join 往返', () => {
  it('HTML 分隔符：往返后 zh/en 不变，再 join 幂等', () => {
    const joined = joinBilingualContent('中文正文', 'English body');
    expect(joined).toBe('中文正文<h2>English Version</h2>English body');
    const split = splitBilingualContent(joined);
    expect(split.hasEnglish).toBe(true);
    expect(split.zh).toBe('中文正文');
    expect(split.en).toBe('English body');
    expect(joinBilingualContent(split.zh, split.en, split.separator)).toBe(joined);
  });

  it('Markdown 分隔符：## English Version 也能切开并还原', () => {
    const joined = joinBilingualContent('中文正文', 'English body', '## English Version');
    expect(joined).toBe('中文正文\n\n## English Version\n\nEnglish body');
    const split = splitBilingualContent(joined);
    expect(split.hasEnglish).toBe(true);
    expect(split.zh).toBe('中文正文');
    expect(split.en).toBe('English body');
    // 二次 split 结果稳定
    expect(splitBilingualContent(joinBilingualContent(split.zh, split.en, '## English Version'))).toMatchObject({
      zh: '中文正文',
      en: 'English body',
      hasEnglish: true,
    });
  });
});

describe('边界', () => {
  it('缺 ## English Version 标记：整篇视为中文', () => {
    expect(splitBilingualContent('只有中文\n没有标记')).toEqual({
      zh: '只有中文\n没有标记',
      en: '',
      hasEnglish: false,
    });
  });

  it('标记两侧多余空白被修剪', () => {
    const split = splitBilingualContent('中文正文  \n\n\n<h2>English Version</h2>\n\n  English body');
    expect(split.zh).toBe('中文正文');
    expect(split.en).toBe('English body');
    expect(split.hasEnglish).toBe(true);
  });

  it('英文末尾的文档尾部空白原样保留（切 tab/编辑不重写另一语言）', () => {
    const split = splitBilingualContent('中文\n\n## English Version\n\nEnglish body  \n');
    expect(split.en).toBe('English body  \n');
  });

  it('join 空英文只返回中文，不追加分隔符', () => {
    expect(joinBilingualContent('中文正文', '')).toBe('中文正文');
    expect(joinBilingualContent('中文正文  \n', '   ')).toBe('中文正文');
  });
});
