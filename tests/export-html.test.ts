// export-html 纯函数自检：实体解码顺序、无 alt 图片保留、figure 归因往返、代码围栏不被内联样式污染。
import { describe, expect, it } from 'vitest';
import { applyInlineStyles, decodeHtml, htmlToMarkdown, markdownToInlineHtml } from '../src/lib/export-html';

describe('decodeHtml 实体解码顺序', () => {
  it('&amp;lt; 解码为 &lt; 而不是 <（&amp; 必须最后解码）', () => {
    expect(decodeHtml('&amp;lt;')).toBe('&lt;');
    expect(decodeHtml('&amp;amp;')).toBe('&amp;');
  });

  it('普通实体正常解码', () => {
    expect(decodeHtml('&lt;tag&gt; &quot;q&quot; &#39;s&#39; &amp; end')).toBe('<tag> "q" \'s\' & end');
    expect(decodeHtml('&nbsp;')).toBe(' ');
  });
});

describe('htmlToMarkdown 图片', () => {
  it('无 alt 的 <img> 不丢失，降级为 ![](src)', () => {
    expect(htmlToMarkdown('<p><img src="a.png"/></p>')).toContain('![](a.png)');
  });

  it('属性任意顺序、单引号也能解析', () => {
    expect(htmlToMarkdown("<img alt='现场' src=\"b.png\" data-x=\"1\" />")).toContain('![现场](b.png)');
    expect(htmlToMarkdown('<img src="c.png" alt="图注" />')).toContain('![图注](c.png)');
  });
});

describe('figure 归因往返（htmlToMarkdown → markdownToInlineHtml）', () => {
  const figure = '<figure><img src="https://img.example/p.png" alt="现场照片"'
    + ' data-source-url="https://source.example/post" data-source-label="来源网"'
    + ' data-image-license="CC BY 4.0" data-creator="张三"/>'
    + '<figcaption>图 1｜现场照片</figcaption></figure>';

  it('htmlToMarkdown 输出归因注释 + markdown 图片', () => {
    const md = htmlToMarkdown(figure);
    expect(md).toContain('<!-- omni:image');
    expect(md).toContain('![现场照片](https://img.example/p.png)');
  });

  it('往返后 data-* 属性与图注全部恢复', () => {
    const html = markdownToInlineHtml(htmlToMarkdown(figure));
    expect(html).toContain('data-source-url="https://source.example/post"');
    expect(html).toContain('data-source-label="来源网"');
    expect(html).toContain('data-image-license="CC BY 4.0"');
    expect(html).toContain('data-creator="张三"');
    expect(html).toContain('<figcaption>图 1｜现场照片</figcaption>');
  });

  it('二次往返稳定（幂等）', () => {
    const md1 = htmlToMarkdown(figure);
    const md2 = htmlToMarkdown(markdownToInlineHtml(md1));
    expect(md2).toBe(md1);
  });

  it('图注含 > 时注释不被提前终结，往返后还原', () => {
    const fig = '<figure><img src="a.png" alt="x" data-source-url="https://s.example"/>'
      + '<figcaption>1 &gt; 2</figcaption></figure>';
    const html = markdownToInlineHtml(htmlToMarkdown(fig));
    expect(html).toContain('<figcaption>1 &gt; 2</figcaption>');
    expect(html).toContain('data-source-url="https://s.example"');
  });

  it('图注与 alt 相同且无归因时不产生注释', () => {
    const md = htmlToMarkdown('<figure><img src="a.png" alt="图"/><figcaption>图</figcaption></figure>');
    expect(md).not.toContain('omni:image');
    expect(md).toContain('![图](a.png)');
  });
});

describe('mdToHtml 代码围栏', () => {
  const md = '```html\n<p>not a paragraph</p> **bold**\n```\n\n正文段落';

  it('围栏内容转义，不生成真实标签', () => {
    const semantic = markdownToInlineHtml(md);
    expect(semantic).toContain('<pre><code>');
    expect(semantic).toContain('&lt;p&gt;not a paragraph&lt;/p&gt;');
    expect(semantic).not.toContain('<p>not a paragraph</p>');
  });

  it('内联样式不污染围栏内的转义文本', () => {
    const styled = applyInlineStyles(markdownToInlineHtml(md));
    expect(styled).toContain('&lt;p&gt;not a paragraph&lt;/p&gt;');
    expect(styled).not.toContain('<p>not a paragraph</p>');
    // 围栏内的 ** 不被加粗
    expect(styled).not.toContain('<strong>bold</strong>');
  });
});
