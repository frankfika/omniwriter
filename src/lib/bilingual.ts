export type ContentLanguage = 'zh' | 'en';

export interface BilingualContent {
  zh: string;
  en: string;
  hasEnglish: boolean;
  separator?: string;
}

// MiniMax may return either Markdown or Tiptap HTML. Keep the original separator
// so switching tabs and editing one language never rewrites the other language.
export function splitBilingualContent(content: string): BilingualContent {
  const htmlMarker = /<h([1-3])\b[^>]*>\s*(?:<[^>]+>\s*)*English\s+Version\s*(?:<[^>]+>\s*)*<\/h\1>/i;
  const markdownMarker = /^\s*#{1,3}\s+English\s+Version\s*$/im;
  const match = htmlMarker.exec(content) ?? markdownMarker.exec(content);

  if (!match || match.index === undefined) {
    return { zh: content, en: '', hasEnglish: false };
  }

  return {
    zh: content.slice(0, match.index).trimEnd(),
    en: content.slice(match.index + match[0].length).trimStart(),
    hasEnglish: true,
    separator: match[0],
  };
}

export function joinBilingualContent(
  zh: string,
  en: string,
  separator = '<h2>English Version</h2>',
): string {
  const chinese = zh.trimEnd();
  const english = en.trimStart();
  if (!english) return chinese;

  const spacing = separator.trimStart().startsWith('<') ? '' : '\n\n';
  return `${chinese}${spacing}${separator}${spacing}${english}`;
}

export function extractContentTitle(content: string): string | null {
  // 先取 HTML 形态的 <h1>，再退到 Markdown 的 # 标题。两种都要跳过围栏代码块、
  // HTML <pre> / Tiptap 代码节点——否则「```ts\n# not a title\n```」会被误当成标题。
  // 空标题（用户敲了 # 又删掉文字）必须返回 null，而不是 ''——否则上游 `?? '' ??`
  // 链断掉，标题输入框会显示空、但 ValidationStrip / header 又用 fallback 字符串，
  // 出现「输入框空但显示带标题」的不一致。
  // Markdown 用 [ \t]+ 而不是 \s+：避免 \s 把行尾的 \n 吃进去让 $ 跨过正文，从而误把正文当标题。
  const htmlMatch = matchHeadingOutsideCode(content, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (htmlMatch) {
    const text = decodeBasicEntities(htmlMatch[1].replace(/<[^>]+>/g, '').trim());
    return text.length > 0 ? text : null;
  }
  const markdownMatch = matchHeadingOutsideCode(content, /^#[ \t]+(.*)$/m);
  if (markdownMatch) {
    const text = markdownMatch[1].trim();
    return text.length > 0 ? text : null;
  }
  return null;
}

// 在 Markdown 代码围栏和 HTML <pre> 之外匹配 heading，避免把代码示例里的 # 当成标题。
function matchHeadingOutsideCode(content: string, pattern: RegExp): RegExpMatchArray | null {
  if (!pattern.global) pattern = new RegExp(pattern.source, pattern.flags + 'g');
  const codeFenceRanges: Array<[number, number]> = collectCodeFenceRanges(content);
  const preRanges: Array<[number, number]> = [];
  const preRegex = /<pre\b[\s\S]*?<\/pre>/gi;
  let preMatch: RegExpExecArray | null;
  while ((preMatch = preRegex.exec(content)) !== null) {
    preRanges.push([preMatch.index, preMatch.index + preMatch[0].length]);
  }
  const insideFence = (start: number, end: number) =>
    codeFenceRanges.some(([s, e]) => start >= s && end <= e) ||
    preRanges.some(([s, e]) => start >= s && end <= e);
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(content)) !== null) {
    if (!insideFence(m.index, m.index + m[0].length)) return m;
  }
  return null;
}

// 收集代码围栏区间：先按闭区间匹配，再追加每个「未闭合」的 ``` / ~~~ 起点至文档末尾。
// 服务端偶尔截断响应会让 AI 输出一段没闭合的代码块，这种伪标题也要被排除。
function collectCodeFenceRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const closedRegex = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
  let match: RegExpExecArray | null;
  while ((match = closedRegex.exec(content)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  // 找出所有 fence 起止符（开 / 闭），剩下的开符没找到对应闭符 → 视为「未闭合」。
  const markers: Array<{ pos: number; char: string; isClose: boolean }> = [];
  const markerRegex = /(^|\n)(```|~~~)/g;
  while ((match = markerRegex.exec(content)) !== null) {
    const fenceChar = match[2];
    const before = content.slice(0, match.index);
    const sameCount = (before.match(new RegExp('(^|\\n)' + fenceChar, 'g')) || []).length;
    markers.push({ pos: match.index + match[1].length, char: fenceChar, isClose: sameCount % 2 === 1 });
  }
  // 配对：stack 顶部与新 marker 必须同字符才闭合
  const stack: Array<{ pos: number; char: string }> = [];
  for (const m of markers) {
    const top = stack[stack.length - 1];
    if (m.isClose && top && top.char === m.char) {
      stack.pop();
      // 已在 closedRegex 里匹配，不重复登记
    } else {
      stack.push({ pos: m.pos, char: m.char });
    }
  }
  // 剩下的就是「未闭合的开符」，从它到文末视为围栏。
  for (const open of stack) {
    ranges.push([open.pos, content.length]);
  }
  return ranges;
}

export function replaceContentTitle(content: string, title: string): string {
  // 复用 extractContentTitle 的「跳过围栏 / pre」语义，避免误替换 <pre> 里的 <h1>。
  const htmlMatch = matchHeadingOutsideCode(content, /<h1(\b[^>]*)>[\s\S]*?<\/h1>/i);
  if (htmlMatch && htmlMatch.index !== undefined) {
    const attrs = htmlMatch[1];
    const start = htmlMatch.index;
    // 替换：取 <h1 attrs> 后的「attrs」，把整个 <h1 ...>...</h1> 替换掉
    const openTagMatch = htmlMatch[0].match(/^<h1(\b[^>]*)>[\s\S]*?<\/h1>$/i);
    const capturedAttrs = openTagMatch?.[1] ?? attrs;
    const openTag = `<h1${capturedAttrs}>`;
    const innerStart = start + openTag.length;
    const innerEnd = start + htmlMatch[0].lastIndexOf('</h1>');
    return content.slice(0, innerStart) + escapeHtml(title) + content.slice(innerEnd);
  }

  const markdownMatch = matchHeadingOutsideCode(content, /^#[ \t]+.*$/m);
  // Markdown 分支也要 escape——LLM 给的标题或用户输入里若含 <script> 等字符，
  // 经下一轮 markdownToInlineHtml 会变成真实标签。代价是 `# &` 这种合法字符会被写为 `# &amp;`，
  // 渲染端仍然按 HTML 实体还原，行为不变。
  if (markdownMatch) return content.replace(markdownMatch[0], `# ${escapeHtml(title)}`);
  if (!title.trim()) return content;

  return `<h1>${escapeHtml(title)}</h1>${content}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]!));
}

function decodeBasicEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
