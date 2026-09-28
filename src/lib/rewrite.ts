// 洗稿（rewording / paraphrasing）：给一条原文（推文 / 新闻 / GitHub / 任意网页），
// 抽取正文与图片，调用模型生成适配目标平台（默认 X/Twitter，可选公众号 / 知乎 / 小红书）
// 的全新版本。原文以 markdown 形式摘要给模型，但**原图列表单独返回**，让前端按 X 帖顺序插入。
//
// 设计目标：
// - 原文事实摘要不超过 1500 字，避免触发模型上下文窗口边界。
// - 失败时主动把 SDK 错误转成可读中文，不把 401/429/500 等丢给用户。
// - 截图/图片列表对外永远是绝对 URL（pbs.twimg.com / 来源站），由前端走 /api/images/proxy 缓存。

import type { AiLike } from './ai';
import Anthropic from '@anthropic-ai/sdk';
import { getClient, resolveModel } from './ai';
import { PLATFORMS } from './platforms';
import type { PlatformId } from './types';
import { fetchMaterial, fetchGitHubRepositoryMaterial, parseGitHubRepositoryUrl, fetchPublicHtml, probePublicImage, type SafeImageMime } from './fetch';
import { extractTweetIdFromUrl, fetchTweet, tweetSummary, type TweetSnapshot, type TweetMedia } from './twitter';
import { clampRewriteText, splitRewriteHashtags } from './rewrite-helpers';

export interface RewriteOptions {
  ai?: AiLike;
  signal?: AbortSignal;
  voice?: 'news' | 'sharp' | 'casual' | 'explainer';
  intent?: string; // 用户额外诉求，例如「突出股价」「加一段我个人评论」
}

export interface PreservedImage {
  url: string;
  alt: string;
  source: 'tweet' | 'article' | 'github' | 'og' | 'inline';
  width?: number;
  height?: number;
}

export interface RewriteResult {
  source: {
    kind: 'tweet' | 'article' | 'github' | 'unknown';
    url: string;
    title?: string;
    author?: string;
    publishedAt?: string;
    summary: string;
    images: PreservedImage[];
  };
  target: PlatformId;
  body: string;
  hashtags: string[];
  imagePlan: Array<{ position: 'before' | 'after' | 'inline'; url: string; alt: string }>;
  warnings: string[];
  via?: string;
}

const SYSTEM_PROMPT = `你是中文社交媒体编辑，专长"洗稿"：把别人的文章 / 推文 / 新闻改成自己口吻的新稿。
严格遵守：
- 输出全新版本，不能照抄原文逐句翻译；用第一人称、判断、有具体名词。
- 保留原文中所有关键事实（数字、日期、引语、链接），但用你自己的表达方式写。
- 如果原文涉及未授权引用，改写时要改写引语和具体措辞，避免被识别成原文搬运。
- 不要补造原文没有的数字 / 人名 / 公司名 / 链接。
- 不要 Markdown 加粗或加链接，正文纯文本即可；hashtag 在最后一行空一行后单独列。
- 不要出现"以下是改写"之类的元说明；直接给成品。
`;

function buildUserPrompt(
  platformSpec: { rules: string; maxChars?: number; shape: string; hook: string; label: string },
  sourceKind: string,
  sourceSummary: string,
  intent: string | undefined,
  voice: RewriteOptions['voice'],
  imageCount: number,
): string {
  const limitNote = platformSpec.maxChars ? `\n字数上限：${platformSpec.maxChars} 中文字符（必须严格遵守，含 URL 估算字符）。` : '';
  const intentNote = intent ? `\n用户额外诉求：${intent}` : '';
  const voiceNote = voice ? `\n语气：${voice === 'news' ? '克制新闻解读' : voice === 'sharp' ? '观点鲜明、敢下判断' : voice === 'explainer' ? '把机制讲给外行' : '日常口语化'}` : '';
  const imageNote = imageCount > 0 ? `\n可用图片数：${imageCount} 张。挑最贴合正文的一张放在正文末尾或开头，文字里不要引用"图片 1"等占位符。` : '\n无可用图片，不要编造。';
  return `## 目标平台：${platformSpec.label}（${platformSpec.shape}）

平台约束：${platformSpec.rules}
钩子要求：${platformSpec.hook}${limitNote}${imageNote}${voiceNote}${intentNote}

## 原文摘要（${sourceKind}）
${sourceSummary}

## 输出要求
- 仅输出新稿正文，第一行直接开始写；最后一行空一行后写"#hashtag"形式的标签（最多 2 个英文或中文标签，与内容相关）。`;
}

export async function rewriteFromUrl(
  rawUrl: string,
  target: PlatformId = 'x',
  options: RewriteOptions = {},
): Promise<RewriteResult> {
  const trimmed = rawUrl.trim();
  if (!trimmed) throw new Error('请提供需要改写的链接');

  const tweetId = extractTweetIdFromUrl(trimmed);
  if (tweetId) {
    return rewriteFromTweet(tweetId, trimmed, target, options);
  }
  if (parseGitHubRepositoryUrl(trimmed)) {
    return rewriteFromGithub(trimmed, target, options);
  }
  return rewriteFromArticle(trimmed, target, options);
}

async function rewriteFromTweet(
  tweetId: string,
  rawUrl: string,
  target: PlatformId,
  options: RewriteOptions,
): Promise<RewriteResult> {
  const tweet = await fetchTweet(rawUrl, { signal: options.signal });
  if (!tweet) {
    throw new Error('推文读取失败：推文可能已删除、被设为私密，或 Twitter 当前无响应。');
  }
  const summary = tweetSummary(tweet);
  const images: PreservedImage[] = tweet.media.map((media, index) => ({
    url: media.url,
    alt: media.alt || `tweet image ${index + 1}`,
    source: 'tweet',
    width: media.width,
    height: media.height,
  }));
  const platformSpec = PLATFORMS[target];
  const prompt = buildUserPrompt(platformSpec, '推文', summary, options.intent, options.voice, images.length);
  const { body, hashtags, via } = await callModel(prompt, platformSpec.maxChars, options);
  const imagePlan = buildImagePlan(images, body);
  return {
    source: {
      kind: 'tweet',
      url: tweet.sourceUrl || rawUrl,
      title: tweet.authorHandle ? `@${tweet.authorHandle}` : tweet.authorName,
      author: tweet.authorName || tweet.authorHandle,
      publishedAt: tweet.createdAt,
      summary,
      images,
    },
    target,
    body,
    hashtags,
    imagePlan,
    warnings: tweet.via ? [] : [`推文读取降级路径：${tweet.via}`],
    via: tweet.via,
  };
}

async function rewriteFromArticle(
  rawUrl: string,
  target: PlatformId,
  options: RewriteOptions,
): Promise<RewriteResult> {
  const warnings: string[] = [];
  let html = '';
  let finalUrl: URL | null = null;
  try {
    const document = await fetchPublicHtml(rawUrl, { timeoutMs: 15_000, maxBytes: 2_000_000, signal: options.signal });
    html = document.html;
    finalUrl = document.finalUrl;
  } catch (error) {
    throw new Error(`原文读取失败：${(error as Error).message}`);
  }
  const ogImages = extractOgImages(html, finalUrl ?? new URL(rawUrl));
  const summary = summarizeArticleHtml(html);
  if (!summary) throw new Error('原文读取成功但没有可用正文，可能是 JS 渲染的页面');
  const platformSpec = PLATFORMS[target];
  const images: PreservedImage[] = ogImages;
  const prompt = buildUserPrompt(platformSpec, '网页 / 新闻', summary, options.intent, options.voice, images.length);
  const { body, hashtags, via } = await callModel(prompt, platformSpec.maxChars, options);
  return {
    source: {
      kind: 'article',
      url: finalUrl?.href ?? rawUrl,
      title: extractTitle(html) ?? finalUrl?.hostname,
      summary,
      images,
    },
    target,
    body,
    hashtags,
    imagePlan: buildImagePlan(images, body),
    warnings,
    via,
  };
}

async function rewriteFromGithub(
  rawUrl: string,
  target: PlatformId,
  options: RewriteOptions,
): Promise<RewriteResult> {
  const ref = parseGitHubRepositoryUrl(rawUrl);
  const material = ref ? await fetchGitHubRepositoryMaterial(rawUrl, 12_000) : null;
  if (!material) throw new Error('GitHub 仓库读取失败，请检查仓库是否存在或设为私有');
  const summary = material.slice(0, 4_000);
  const platformSpec = PLATFORMS[target];
  const prompt = buildUserPrompt(platformSpec, 'GitHub 仓库', summary, options.intent, options.voice, 0);
  const { body, hashtags, via } = await callModel(prompt, platformSpec.maxChars, options);
  return {
    source: {
      kind: 'github',
      url: ref?.url ?? rawUrl,
      title: ref ? `${ref.owner}/${ref.repo}` : rawUrl,
      summary,
      images: [],
    },
    target,
    body,
    hashtags,
    imagePlan: [],
    warnings: [],
    via,
  };
}

interface ModelResponse {
  body: string;
  hashtags: string[];
  via: string;
}

async function callModel(
  userPrompt: string,
  maxChars: number | undefined,
  options: RewriteOptions,
): Promise<ModelResponse> {
  const model = resolveModel(options.ai);
  const client = getClient(options.ai);
  const budget = maxChars ? Math.max(600, Math.min(2400, Math.round(maxChars * 1.6))) : 1600;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await (client as Anthropic).messages.create({
        model,
        max_tokens: budget,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }, options.signal ? { signal: options.signal } : undefined);
      const text = response.content
        .map((block) => (block.type === 'text' ? block.text ?? '' : ''))
        .join('')
        .trim();
      if (text) {
        const { body, hashtags } = splitRewriteHashtags(text);
        const trimmedBody = maxChars ? clampRewriteText(body, maxChars) : body.trim();
        return { body: trimmedBody, hashtags, via: model };
      }
      lastError = new Error('AI 返回为空');
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted || (error as { name?: string })?.name === 'AbortError') throw error;
      if (!isRetryableError(error) || attempt === 2) throw error;
    }
    await waitMs(400 * (attempt + 1), options.signal);
  }
  throw lastError instanceof Error ? lastError : new Error('AI 返回为空，请重试或更换模型');
}

function isRetryableError(error: unknown): boolean {
  const value = error as { status?: number; message?: string; name?: string };
  if (value.name === 'AbortError') return false;
  const message = value.message ?? '';
  if (/用量上限|余额不足|额度|quota|usage limit|Token Plan|购买积分|insufficient|upgrade|plan/i.test(message)) return false;
  if (value.status === 408 || value.status === 409 || value.status === 429 || (value.status ?? 0) >= 500) return true;
  return /timeout|timed out|overloaded|rate.?limit|econn|fetch failed|socket|empty/i.test(message);
}

function waitMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function extractOgImages(html: string, finalUrl: URL): PreservedImage[] {
  const result: PreservedImage[] = [];
  const seen = new Set<string>();
  const push = (rawUrl: string | undefined, alt: string, source: PreservedImage['source']) => {
    if (!rawUrl) return;
    try {
      const url = new URL(rawUrl, finalUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return;
      const href = url.href;
      if (seen.has(href)) return;
      seen.add(href);
      result.push({ url: href, alt: alt || '原文配图', source });
    } catch {
      // ignore
    }
  };
  const ogImageRegex = /<meta\b[^>]+(?:property|name)=["']og:image(?::secure_url)?["'][^>]*>/gi;
  for (const match of html.matchAll(ogImageRegex)) {
    const tag = match[0];
    const content = tag.match(/content=["']([^"']+)["']/i)?.[1];
    const alt = tag.match(/(?:property|name)=["'](?:og:image:alt|twitter:image:alt)["'][^>]*content=["']([^"']+)["']/i)?.[1] ?? '';
    push(content, alt, 'og');
  }
  const twitterImageRegex = /<meta\b[^>]+(?:property|name)=["']twitter:image(?::src)?["'][^>]*>/gi;
  for (const match of html.matchAll(twitterImageRegex)) {
    const tag = match[0];
    const content = tag.match(/content=["']([^"']+)["']/i)?.[1];
    push(content, '', 'og');
  }
  const figureRegex = /<figure\b[^>]*>([\s\S]*?)<\/figure>/gi;
  for (const match of html.matchAll(figureRegex)) {
    const inner = match[1] ?? '';
    const img = inner.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1];
    const alt = inner.match(/<img\b[^>]*alt=["']([^"']*)["']/i)?.[1] ?? '';
    if (img) push(img, alt, 'article');
  }
  const imgRegex = /<img\b[^>]*>/gi;
  for (const match of html.matchAll(imgRegex)) {
    const tag = match[0];
    const src = tag.match(/src=["']([^"']+)["']/i)?.[1];
    const alt = tag.match(/alt=["']([^"']*)["']/i)?.[1] ?? '';
    if (src) push(src, alt, 'inline');
    if (result.length >= 6) break;
  }
  return result;
}

function extractTitle(html: string): string | undefined {
  const og = html.match(/<meta\b[^>]+(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1];
  if (og) return decodeEntities(og).trim();
  const twitter = html.match(/<meta\b[^>]+(?:property|name)=["']twitter:title["'][^>]*content=["']([^"']+)["']/i)?.[1];
  if (twitter) return decodeEntities(twitter).trim();
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? decodeEntities(title).trim() : undefined;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

function summarizeArticleHtml(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.slice(0, 4_500);
}

function buildImagePlan(images: PreservedImage[], body: string): Array<{ position: 'before' | 'after' | 'inline'; url: string; alt: string }> {
  if (!images.length) return [];
  const selected = images.slice(0, 2);
  return selected.map((image, index) => ({
    position: index === 0 ? 'after' : 'before',
    url: image.url,
    alt: image.alt,
  }));
}

// 在改写结果之外，再补一个独立的"找 GitHub 截图"动作：当用户给的链接是新闻 / 推文
// 而希望附加一张相关开源项目的截图时使用。复用现有 /api/images/search 思路，
// 但跳过源页直接搜索关键词。
export async function findGithubScreenshots(
  query: string,
  options: { limit?: number; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<PreservedImage[]> {
  const limit = Math.max(1, Math.min(8, options.limit ?? 4));
  const seeds = githubScreenshotsForQuery(query).slice(0, limit);
  const checked = await Promise.all(seeds.map((seed) => probeGithubScreenshot(seed, options.timeoutMs ?? 10_000, options.signal)));
  return checked.filter((value): value is PreservedImage => Boolean(value));
}

function githubScreenshotsForQuery(query: string): Array<{ url: string; alt: string }> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const escaped = encodeURIComponent(trimmed);
  return [
    { url: `https://github.com/search?q=${escaped}&type=repositories`, alt: `GitHub 搜索：${trimmed}` },
    { url: `https://avatars.githubusercontent.com/${encodeURIComponent(trimmed.split(/\s+/)[0] ?? 'github')}`, alt: `${trimmed} 头像` },
  ];
}

async function probeGithubScreenshot(
  candidate: { url: string; alt: string },
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<PreservedImage | null> {
  const probe = await probePublicImage(candidate.url, { timeoutMs, signal });
  if (!probe) return null;
  return {
    url: probe.finalUrl.href,
    alt: candidate.alt,
    source: 'github',
  };
}