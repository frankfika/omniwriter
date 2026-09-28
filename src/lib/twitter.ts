// Twitter/X 公开抓取：仅用无鉴权端点（CDN syndication + fxtwitter 镜像）。
// 浏览器 CORS 屏蔽这些端点，所以调用必须发生在服务端。
// - 主路径：cdn.syndication.twimg.com/tweet-result?id={id}&token={token}&lang=en
//   token 公式来自 Vercel 的 react-tweet：((id / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '')
// - 备胎：api.fxtwitter.com/{user}/status/{id}（社区维护，不一定能用）
//
// 纯解析逻辑放在 rewrite-helpers.ts，便于在 vitest 里离线测试。

import { fetchPublicBytes } from './fetch';
import {
  computeSyndicationToken,
  extractTweetIdFromUrl,
  parseFxTwitterTweetShape,
  parseSyndicationTweetShape,
  type ParsedMedia,
} from './rewrite-helpers';

export type TweetMedia = ParsedMedia;

export { computeSyndicationToken, extractTweetIdFromUrl };

export interface TweetSnapshot {
  id: string;
  text: string;
  authorName: string;
  authorHandle: string;
  createdAt: string;
  lang?: string;
  sourceUrl: string;
  media: TweetMedia[];
  hashtags: string[];
  mentions: string[];
  links: string[];
  via: 'syndication' | 'fxtwitter' | 'oembed';
}

export interface FetchTweetOptions {
  lang?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function fetchTweet(rawUrl: string, options: FetchTweetOptions = {}): Promise<TweetSnapshot | null> {
  const tweetId = extractTweetIdFromUrl(rawUrl);
  if (!tweetId) return null;
  const sourceUrl = `https://x.com/i/status/${tweetId}`;
  const lang = options.lang ?? 'en';
  const timeoutMs = options.timeoutMs ?? 12_000;

  const syndication = await fetchSyndication(tweetId, lang, options.signal, timeoutMs);
  if (syndication) return { ...syndication, id: tweetId, sourceUrl };

  const fx = await fetchFxTwitter(tweetId, options.signal, timeoutMs);
  if (fx) return { ...fx, id: tweetId, sourceUrl };

  return null;
}

async function fetchSyndication(tweetId: string, lang: string, signal?: AbortSignal, timeoutMs = 12_000): Promise<Omit<TweetSnapshot, 'id' | 'sourceUrl'> | null> {
  try {
    const url = new URL('https://cdn.syndication.twimg.com/tweet-result');
    url.searchParams.set('id', tweetId);
    url.searchParams.set('token', computeSyndicationToken(tweetId));
    url.searchParams.set('lang', lang);
    const resource = await fetchPublicBytes(url, {
      timeoutMs,
      maxBytes: 2_000_000,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; OmniWriter/1.0; +https://localhost)' },
      signal,
    });
    const json = JSON.parse(new TextDecoder().decode(resource.bytes)) as Record<string, unknown>;
    const parsed = parseSyndicationTweetShape(json);
    if (!parsed) return null;
    return { ...parsed, via: 'syndication' };
  } catch {
    return null;
  }
}

async function fetchFxTwitter(tweetId: string, signal?: AbortSignal, timeoutMs = 12_000): Promise<Omit<TweetSnapshot, 'id' | 'sourceUrl'> | null> {
  try {
    const url = `https://api.fxtwitter.com/i/status/${tweetId}`;
    const resource = await fetchPublicBytes(url, {
      timeoutMs,
      maxBytes: 2_000_000,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; OmniWriter/1.0; +https://localhost)' },
      signal,
    });
    const json = JSON.parse(new TextDecoder().decode(resource.bytes)) as Record<string, unknown>;
    const parsed = parseFxTwitterTweetShape(json);
    if (!parsed) return null;
    return { ...parsed, via: 'fxtwitter' };
  } catch {
    return null;
  }
}

export function tweetSummary(snapshot: TweetSnapshot): string {
  const head = snapshot.authorHandle ? `@${snapshot.authorHandle}` : snapshot.authorName;
  const created = snapshot.createdAt ? `（${snapshot.createdAt.slice(0, 10)}）` : '';
  const mediaCount = snapshot.media.length;
  const mediaNote = mediaCount ? `\n媒体：${mediaCount} 张${snapshot.media.some((m) => m.type === 'video') ? '（含视频）' : ''}` : '';
  const tagList = snapshot.hashtags.length ? `\n话题标签：${snapshot.hashtags.map((tag) => `#${tag}`).join(' ')}` : '';
  return `推文${created}${head ? ` · ${head}` : ''}\n${snapshot.text}${mediaNote}${tagList}`.trim();
}