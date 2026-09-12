// 导出工具（客户端安全）：Markdown → 公众号兼容 HTML、行内样式注入、富文本复制、HTML → Markdown。
// 不依赖 Node-only 包（无 JSZip）。ZIP 打包走 src/lib/export-zip.ts（服务端）。
import { resolveWechatTemplate } from './templates';

// 公众号编辑器会剥离 <style>，所以复制/导出时每个元素必须自带 style 属性。
export interface BuildOptions {
  title: string;
  eyebrow?: string;
  author?: string;
  mdBody: string; // Markdown 或已渲染 HTML
  images?: Record<string, string>; // 文件名 → dataURL（写入 ZIP 的 images/）
  imageSrcMap?: Record<string, string>; // 原 src → 新 src（用于把内嵌图改写为 images/ 路径）
  templateId?: string;
}

// ---- 基础转义 ----
function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/'/g, '&#39;');
}
function escapeText(s: string) {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function decodeHtml(s: string) {
  // &amp; 必须最后解码，否则 &amp;lt;（用户正文里的字面 &lt;）会被二次解码成 <
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// 解析标签属性（容忍属性任意顺序、单/双引号；属性值做实体解码）
function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const body = tag.replace(/^<\/?[\w-]+/, ''); // 去掉 <img 前缀，避免把标签名当属性
  for (const m of body.matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attrs[m[1].toLowerCase()] = decodeHtml(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

// 图片归因（来源/许可/作者/图注）序列化为 markdown 侧的 HTML 注释，
// 使 AI 改稿往返（htmlToMarkdown → markdownToInlineHtml）后仍能恢复到 figure 属性上。
function imageMetaComment(attrs: Record<string, string>, caption: string): string {
  const meta: Record<string, string> = {};
  if (attrs['data-source-url']) meta.sourceUrl = attrs['data-source-url'];
  if (attrs['data-source-label']) meta.sourceLabel = attrs['data-source-label'];
  if (attrs['data-image-license']) meta.license = attrs['data-image-license'];
  if (attrs['data-creator']) meta.creator = attrs['data-creator'];
  if (caption) meta.caption = caption;
  if (Object.keys(meta).length === 0) return '';
  // `>` 会提前终结注释（-->），统一转义为 JSON 的 >，JSON.parse 时还原
  return `<!-- omni:image ${JSON.stringify(meta).replace(/>/g, '\\u003e')} -->\n`;
}

// 输入是否已经是 HTML（Tiptap 输出等）→ 直接走直通分支，避免二次 markdown 化
function looksLikeHtml(s: string): boolean {
  const trimmed = s.trim();
  const hasMarkdownBlocks = /(^|\n)\s{0,3}(?:#{1,6}\s|>\s?|[-*+]\s+|\d+\.\s+|```)/m.test(trimmed);
  // 编辑器产生的整段 HTML 需要直通；Markdown 中夹入的 <img> 等原生标签仍应继续解析标题和列表。
  return !hasMarkdownBlocks
    && /^<(h[1-6]|p|div|blockquote|img|figure|ul|ol|li|pre|code|br|strong|em|a|hr)[\s>]/i.test(trimmed);
}

// 只转义标签外的文本节点（保留已有实体，避免 &amp; → &amp;amp;）
function escapeTextNodes(html: string): string {
  let out = '';
  let inTag = false;
  let inRaw = 0; // >0 表示在 <pre>/<code> 内（内容已转义，跳过）
  let i = 0;
  const n = html.length;
  while (i < n) {
    const c = html[i];
    if (inTag) {
      out += c;
      i++;
      if (c === '>') inTag = false;
      continue;
    }
    if (c === '<') {
      const m = html.slice(i).match(/^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/);
      const tag = m?.[2]?.toLowerCase();
      if (tag === 'pre' || tag === 'code') inRaw += m?.[1] ? -1 : 1;
      out += c;
      i++;
      inTag = true;
      continue;
    }
    if (inRaw > 0) {
      out += c;
      i++;
      continue;
    }
    if (c === '&' && /^&[a-zA-Z0-9#]{1,8};/.test(html.slice(i))) {
      out += c;
      i++;
      continue;
    }
    if (c === '&') out += '&amp;';
    else if (c === '<') out += '&lt;';
    else if (c === '>') out += '&gt;';
    else out += c;
    i++;
  }
  return out;
}

// 给已知标签注入行内样式（合并已有 style 属性，已有属性优先保留）
export function applyInlineStyles(html: string, templateId?: string): string {
  const template = resolveWechatTemplate(templateId);
  let styled = html.replace(/<(h[1-6]|p|blockquote|figure|figcaption|img|a|ul|ol|li|strong|em|pre|code|hr)\b([^>]*)>/gi, (full, tag, rest) => {
    const style = template.styles.elements[tag.toLowerCase() as keyof typeof template.styles.elements];
    if (!style) return full;
    const restStr = (rest ?? '').trim();
    const selfClose = /\/$/.test(restStr);
    const attrs = selfClose ? restStr.slice(0, -1).trim() : restStr;
    const styleMatch = attrs.match(/\bstyle="([^"]*)"/i);
    let attrsOut: string;
    if (styleMatch) {
      const merged = `${styleMatch[1].replace(/;?\s*$/, ';')}${style}`;
      attrsOut = attrs.replace(styleMatch[0], `style="${merged}"`);
    } else if (attrs) {
      attrsOut = `${attrs} style="${style}"`;
    } else {
      attrsOut = `style="${style}"`;
    }
    return `<${tag} ${attrsOut}${selfClose ? '/' : ''}>`;
  });
  styled = styled.replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/gi, (block) =>
    block.replace(/<p\b[^>]*>/gi, (tag) => appendInlineStyle(tag, template.styles.quoteParagraph)),
  );
  styled = styled.replace(/<p\b[^>]*>(\s*<em\b[^>]*>[\s\S]*?<\/em>\s*)<\/p>/gi, (paragraph, inner) =>
    `${appendInlineStyle(paragraph.slice(0, paragraph.indexOf('>') + 1), template.styles.captionParagraph)}${inner}</p>`,
  );
  return styled;
}

function appendInlineStyle(openingTag: string, style: string): string {
  const match = openingTag.match(/\bstyle="([^"]*)"/i);
  if (match) return openingTag.replace(match[0], `style="${match[1].replace(/;?\s*$/, ';')}${style}"`);
  return openingTag.replace(/>$/, ` style="${style}">`);
}

// Markdown → 语义 HTML（不做行内样式；输入已是 HTML 时直通，保证幂等）
export function markdownToInlineHtml(md: string): string {
  if (!md) return '';
  if (looksLikeHtml(md)) return escapeTextNodes(md);
  return escapeTextNodes(mdToHtml(md));
}

function mdToHtml(md: string): string {
  let html = md;
  const codeSpans: string[] = [];
  const preBlocks: string[] = [];

  // 代码块：先保护，避免被后续正则破坏
  html = html.replace(/```([\w+-]*)\s*\n?([\s\S]*?)(?:```|$)/g, (_m, _lang, code) => {
    const inner = escapeHtml(code.replace(/\s+$/, ''));
    preBlocks.push(`<pre><code>${inner}</code></pre>`);
    return `\u0000PRE${preBlocks.length - 1}\u0000`;
  });
  // 行内代码：占位保护
  html = html.replace(/`([^`]+)`/g, (_m, c) => {
    codeSpans.push(escapeHtml(c));
    return `\u0000CODE${codeSpans.length - 1}\u0000`;
  });

  // 图片（可选前置 <!-- omni:image {...} --> 归因注释，见 imageMetaComment）
  html = html.replace(/(?:<!--\s*omni:image\s+([\s\S]*?)\s*-->\s*)?!\[([^\]]*)\]\(([^)]+)\)/g, (_m, metaJson, alt, src) => {
    let extra = '';
    let caption = alt;
    if (metaJson) {
      try {
        const meta = JSON.parse(metaJson) as Record<string, unknown>;
        const attr = (key: string, name: string) => {
          const v = meta[key];
          if (typeof v === 'string' && v) extra += ` ${name}="${escapeAttr(v)}"`;
        };
        attr('sourceUrl', 'data-source-url');
        attr('sourceLabel', 'data-source-label');
        attr('license', 'data-image-license');
        attr('creator', 'data-creator');
        // 有图注时保留原 figcaption 文本，不用 alt 覆盖
        if (typeof meta.caption === 'string' && meta.caption) caption = meta.caption;
      } catch { /* 元数据损坏时按普通图片处理 */ }
    }
    return `<figure><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${extra}/><figcaption>${escapeText(caption)}</figcaption></figure>`;
  });
  // 链接（href 转义，防属性注入）
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) =>
    `<a href="${escapeAttr(href)}">${escapeText(text)}</a>`);
  // 多行引用（合并连续引用行为一个 blockquote）
  html = html.replace(/(^|\n)(>)[^\n]*(?:\n(>)[^\n]*)*/g, (block: string) => {
    const clean = block.replace(/^\n+|\n+$/g, '');
    const lines = clean.split('\n').map((l: string) => l.replace(/^\s*>\s?/, ''));
    return `<blockquote>${lines.map((l: string) => `<p>${l}</p>`).join('')}</blockquote>`;
  });
  // 标题
  html = html.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');
  // 无序列表
  html = html.replace(/(^|\n)(- .+(?:\n- .+)*)/g, (_m: string, p: string, block: string) => {
    const items = block.split('\n').map((l: string) => l.replace(/^- /, '').trim());
    return `${p}<ul>${items.map((i: string) => `<li>${i}</li>`).join('')}</ul>`;
  });
  // 有序列表
  html = html.replace(/(^|\n)(\d+\. .+(?:\n\d+\. .+)*)/g, (_m: string, p: string, block: string) => {
    const items = block.split('\n').map((l: string) => l.replace(/^\d+\. /, '').trim());
    return `${p}<ol>${items.map((i: string) => `<li>${i}</li>`).join('')}</ol>`;
  });
  // 分割线
  html = html.replace(/^---+$/gm, '<hr/>');
  // 加粗 / 斜体（占位符含 \u0000，不会被匹配）
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // 恢复行内代码与代码块（代码块在段落包裹之前恢复，避免被包进 <p>）
  html = html.replace(/\u0000CODE(\d+)\u0000/g, (_m, i) => `<code>${codeSpans[+i]}</code>`);
  html = html.replace(/\u0000PRE(\d+)\u0000/g, (_m, i) => preBlocks[+i]);
  // 段落（段落内混入块级元素时拆出，如紧贴段落的引用）
  const blocks = html.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  html = blocks
    .map((b: string) => {
      if (/^<(h\d|figure|blockquote|ul|ol|hr|pre)/.test(b)) return b;
      const parts = b.split(/(?=<(?:blockquote|ul|ol|pre|figure|h[1-6]|hr)\b)/);
      return parts
        .filter((part: string) => part.trim().length > 0)
        .map((part: string) => (/^<(h\d|figure|blockquote|ul|ol|hr|pre)/.test(part) ? part : `<p>${part.trim().replace(/\n/g, '<br/>')}</p>`))
        .join('');
    })
    .join('\n');
  return html;
}

// 公众号正文（含行内样式 + 可选 Eyebrow / 署名）——预览与复制共用同一份
export function wechatBody(mdOrHtml: string, opts: { eyebrow?: string; author?: string; title?: string; templateId?: string } = {}): string {
  const template = resolveWechatTemplate(opts.templateId);
  let semantic = markdownToInlineHtml(mdOrHtml || '');
  if (!/<h1\b[^>]*>/i.test(semantic) && opts.title?.trim()) {
    semantic = `<h1>${escapeText(opts.title.trim())}</h1>${semantic}`;
  }
  let body = applyInlineStyles(semantic, template.id);
  if (opts.eyebrow) {
    const badge = `<span style="${template.styles.eyebrow}">${escapeText(opts.eyebrow.toUpperCase())}</span><br/>`;
    body = /<h1\b[^>]*>/i.test(body)
      ? body.replace(/<h1\b[^>]*>/i, (tag) => `${tag}${badge}`)
      : `${badge}${body}`;
  }
  const authorHtml = opts.author
    ? `<div style="${template.styles.author}">${escapeText(opts.author)}</div>`
    : '';
  return `<section id="wechat-content" data-template="${escapeAttr(template.id)}" style="${template.styles.wrapper}">${body}${authorHtml}</section>`;
}

// 把 HTML 里的图片 src 按映射改写（导出时把内嵌 blob/dataURL 指向 images/ 下的文件）
export function rewriteImageSrcs(html: string, map: Record<string, string>): string {
  let out = html;
  for (const [oldSrc, newSrc] of Object.entries(map)) {
    out = out.split(`src="${oldSrc}"`).join(`src="${newSrc}"`);
  }
  return out;
}

export function buildWechatHtml(opts: BuildOptions): string {
  const template = resolveWechatTemplate(opts.templateId);
  let body = wechatBody(opts.mdBody, { eyebrow: opts.eyebrow, author: opts.author, title: opts.title, templateId: template.id });
  if (opts.imageSrcMap) body = rewriteImageSrcs(body, opts.imageSrcMap);
  const copyImageData = opts.images ?? {};
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeText(opts.title)}</title>
<style>${template.styles.css}
body{padding:0 0 60px;}
.__pcl_toolbar{position:sticky;top:0;z-index:20;box-sizing:border-box;max-width:760px;margin:0 auto;padding:12px 16px;background:#fff;border-bottom:1px solid #e5e5e7;text-align:center;}
.__pcl_toolbar button{padding:9px 20px;border:0;border-radius:7px;background:#0a0a0a;color:#fff;font-size:13px;font-weight:600;cursor:pointer;outline:none;box-shadow:none;}
.__pcl_tip{color:#86868b;font-size:12px;}
.__pcl_shell{box-sizing:border-box;max-width:760px;margin:0 auto;background:#fff;}
</style>
</head>
<body>
<div class="__pcl_toolbar"><button id="__pcl_copy">复制公众号正文</button><span class="__pcl_tip">　样式与图片会一起复制，可直接粘贴到公众号。</span></div>
<main class="__pcl_shell"><div id="__pcl_body">${body}</div></main>
<script>${buildToolbarScript(copyImageData)}</script>
</body>
</html>`;
}

function buildToolbarScript(copyImageData: Record<string, string>) {
  return `
(function(){
  var COPY_IMAGE_DATA=${JSON.stringify(copyImageData)};
  var btn=document.getElementById('__pcl_copy');
  function buildCopyContent(){
    var content=document.getElementById('wechat-content');
    var clone=content.cloneNode(true);
    var originals=content.querySelectorAll('img');
    clone.querySelectorAll('img').forEach(function(img,index){
      var source=originals[index]&&originals[index].getAttribute('src');
      if(source) img.setAttribute('src',COPY_IMAGE_DATA[source]||(originals[index]&&originals[index].src)||source);
    });
    return {content:content,clone:clone};
  }
  function legacyRichCopy(clone){
    var staging=document.createElement('div');
    staging.setAttribute('contenteditable','true');
    staging.style.position='fixed';staging.style.left='-10000px';
    staging.appendChild(clone);document.body.appendChild(staging);
    var range=document.createRange();range.selectNodeContents(staging);
    var selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
    var ok=document.execCommand('copy');selection.removeAllRanges();staging.remove();
    if(!ok) throw new Error('copy failed');
  }
  if(!btn)return;
  btn.addEventListener('click',async function(){
    try{
      btn.textContent='正在处理图片…';
      var built=buildCopyContent();
      if(window.isSecureContext&&navigator.clipboard&&window.ClipboardItem&&navigator.clipboard.write){
        try{
          await navigator.clipboard.write([new ClipboardItem({
            'text/html':new Blob([built.clone.outerHTML],{type:'text/html'}),
            'text/plain':new Blob([built.content.innerText],{type:'text/plain'})
          })]);
        }catch(modernError){legacyRichCopy(built.clone);}
      }else{legacyRichCopy(built.clone);}
      btn.textContent='已复制，去公众号粘贴';
      setTimeout(function(){btn.textContent='复制公众号正文';},2200);
    }catch(error){
      btn.textContent='复制失败，请重试';
      setTimeout(function(){btn.textContent='复制公众号正文';},2200);
    }
  });
})();
`.trim();
}

// HTML（或 Markdown）→ 纯文本：复制到纯文本场景用
export function mdToPlainText(md: string): string {
  return md
    .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/g, (_m, c) => `\n${decodeHtml(c)}\n`)
    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*`]/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// HTML → Markdown：导出 article.md 用（对应用内的受控 HTML 子集）
export function htmlToMarkdown(html: string): string {
  const decode = (t: string) => decodeHtml(t.replace(/<[^>]+>/g, '')).trim();
  let s = html;
  // 代码块
  s = s.replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_m, c) => `\n\`\`\`\n${decodeHtml(c).replace(/\n+$/, '')}\n\`\`\`\n\n`);
  // 图片（figure 包裹优先；裸 <img> 兜底。属性任意顺序、alt 可选——无 alt 降级为 ![](src)，不许丢图）
  s = s.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, (_m, fig) => {
    const imgTag = fig.match(/<img\b[^>]*\/?>/i);
    if (!imgTag) return `${decode(fig)}\n\n`;
    const attrs = parseAttrs(imgTag[0]);
    if (!attrs.src) return `${decode(fig)}\n\n`;
    const captionTag = fig.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
    const caption = captionTag ? decode(captionTag[1]) : '';
    // 图注与 alt 相同（mdToHtml 默认行为可还原）时不写注释，保持 markdown 干净
    return `${imageMetaComment(attrs, caption === (attrs.alt ?? '') ? '' : caption)}![${attrs.alt ?? ''}](${attrs.src})\n\n`;
  });
  s = s.replace(/<img\b[^>]*\/?>/gi, (tag) => {
    const attrs = parseAttrs(tag);
    return attrs.src ? `![${attrs.alt ?? ''}](${attrs.src})` : '';
  });
  // 标题
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m, t) => `# ${decode(t)}\n\n`);
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, t) => `## ${decode(t)}\n\n`);
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m, t) => `### ${decode(t)}\n\n`);
  // 引用
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, b) => {
    const lines = b.replace(/<\/p><p[^>]*>/gi, '\n').replace(/<[^>]+>/g, '').split('\n').map((l: string) => l.trim()).filter(Boolean).map((l: string) => `> ${l}`);
    return `\n${lines.join('\n')}\n\n`;
  });
  // 列表
  s = s.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m, b) => {
    const items = [...b.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => `- ${decode(m[1])}`);
    return `\n${items.join('\n')}\n\n`;
  });
  s = s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, b) => {
    const items = [...b.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m, i) => `${i + 1}. ${decode(m[1])}`);
    return `\n${items.join('\n')}\n\n`;
  });
  s = s.replace(/<hr[^>]*\/?>/gi, '\n---\n\n');
  // 链接 / 行内样式
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, t) => `[${decode(t)}](${href})`);
  s = s.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, (_m, t) => `**${decode(t)}**`);
  s = s.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, (_m, t) => `*${decode(t)}*`);
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, t) => `\`${decode(t)}\``);
  // 段落与换行
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, t) => `${decode(t)}\n\n`);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, (_m, t) => `${decode(t)}\n\n`);
  s = s.replace(/<[^>]+>/g, (tag) => (tag.startsWith('<!--') ? tag : '')); // 保留 omni:image 归因注释
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s ? `${s}\n` : '';
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

export async function copyRichToClipboard(html: string, text: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
      return true;
    }
  } catch {
    /* fallthrough */
  }
  try {
    if (typeof document !== 'undefined') {
      const staging = document.createElement('div');
      staging.setAttribute('contenteditable', 'true');
      staging.style.position = 'fixed';
      staging.style.left = '-10000px';
      staging.innerHTML = html;
      document.body.appendChild(staging);
      const range = document.createRange();
      range.selectNodeContents(staging);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const ok = document.execCommand('copy');
      selection?.removeAllRanges();
      staging.remove();
      if (ok) return true;
    }
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
