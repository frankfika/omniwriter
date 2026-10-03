// editorial.validateMarkdown 自检：Markdown 与 HTML 两种输入的图片命名检查。
import { describe, expect, it } from 'vitest';
import { validateMarkdown } from '../src/lib/editorial';

const imageIssues = (md: string) => validateMarkdown(md).filter((i) => i.message.startsWith('图片'));

describe('validateMarkdown 图片命名检查', () => {
  it('Markdown 图片命名不规范时报 medium', () => {
    const issues = imageIssues('# 标题\n\n![图](photo.png)\n');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'medium', message: '图片 1 文件名应以 01_ 开头：photo.png' });
  });

  it('Markdown 图片按 NN_ 命名时不报', () => {
    expect(imageIssues('# 标题\n\n![图](01_scene.png)\n\n![图](02-detail.jpg)\n')).toEqual([]);
  });

  it('HTML <img> 同样参与命名检查（编辑器内容是 HTML）', () => {
    const issues = imageIssues('<h1>标题</h1><img src="photo.png"/>');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe('图片 1 文件名应以 01_ 开头：photo.png');
  });

  it('Markdown 与 HTML 图片混排时按文档位置编号', () => {
    const md = '# 标题\n\n![图](01_a.png)\n\n<p><img src="b.png"/></p>\n\n![图](02_c.png)\n';
    const issues = imageIssues(md);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe('图片 2 文件名应以 02_ 开头：b.png');
  });

  it('data:/blob: 内嵌图跳过（导出时自动重命名）', () => {
    const md = '# 标题\n\n<img src="data:image/png;base64,xxxx"/>\n\n![图](blob:https://app.example/id)\n\n![图](01_a.png)\n';
    expect(imageIssues(md)).toEqual([]);
  });
});

describe('validateMarkdown H1 检查', () => {
  it('缺 h1 / 多 h1 报 high', () => {
    expect(validateMarkdown('正文').some((i) => i.severity === 'high' && i.message === '缺少 h1 标题')).toBe(true);
    expect(validateMarkdown('# 一\n\n# 二').some((i) => i.message.includes('应仅保留一个'))).toBe(true);
  });

  it('English Version 标题不计入 h1', () => {
    expect(validateMarkdown('# English Version').some((i) => i.message === '缺少 h1 标题')).toBe(true);
    expect(validateMarkdown('# 标题\n\n<h1>English Version</h1>').some((i) => i.message.includes('应仅保留一个'))).toBe(false);
  });
});

describe('validateMarkdown AI 味词检查', () => {
  it('出现“综上所述”等套话时报 low', () => {
    expect(validateMarkdown('# t\n综上所述')).toContainEqual({
      severity: 'low',
      message: '出现常见 AI/营销标签词："综上所述"',
    });
  });
});
