// 纯函数提取：把 twitter.ts / rewrite.ts 里可测试的解析与裁剪逻辑集中到这里，
// 让 vitest 可以脱离 Anthropic SDK 直接验证。

const TOKEN_BASE = 1e15;

export function extractTweetIdFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl.trim());
    const host = url.hostname.toLowerCase();
    if (!['twitter.com', 'x.com', 'www.twitter.com', 'www.x.com', 'm.twitter.com', 'mobile.twitter.com'].includes(host)) {
      return null;
    }
    const match = url.pathname.match(/\/status(?:es)?\/(\d+)/i);
    if (!match || !match[1]) return null;
    if (!/^\d{5,25}$/.test(match[1])) return null;
    return match[1];
  } catch {
    return null;
  }
}

export function computeSyndicationToken(tweetId: string): string {
  const numeric = Number(tweetId);
  if (!Number.isFinite(numeric)) return '0';
  const raw = (numeric / TOKEN_BASE) * Math.PI;
  return raw.toString(36).replace(/(0+|\.)/g, '');
}

export interface ParsedMedia {
  url: string;
  alt: string;
  type: 'photo' | 'video' | 'animated_gif';
  width?: number;
  height?: number;
}

export interface ParsedTweet {
  text: string;
  authorName: string;
  authorHandle: string;
  createdAt: string;
  lang?: string;
  media: ParsedMedia[];
  hashtags: string[];
  mentions: string[];
  links: string[];
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function collectStrings(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  value.forEach((entry) => {
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const text = readString(record[field]);
      if (text) out.push(text);
    }
  });
  return out;
}

function collectExpandedUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  value.forEach((entry) => {
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const url = readString(record.expanded_url) ?? readString(record.url);
      if (url) out.push(url);
    }
  });
  return out;
}

export function parseSyndicationTweetShape(json: Record<string, unknown>): ParsedTweet | null {
  if (!json || json.__typename === 'TweetTombstone' || json.tombstone) return null;
  const text = readString(json.text) ?? readString(json.full_text);
  if (!text) return null;
  const lang = readString(json.lang);
  const createdAt = readString(json.created_at) ?? '';
  const user = (json.user && typeof json.user === 'object' ? json.user : json.core && typeof json.core === 'object' ? (json.core as Record<string, unknown>).user_results : null) as Record<string, unknown> | null;
  const authorName = readString(user?.name) ?? readString(json.user_name) ?? '';
  const authorHandle = readString(user?.screen_name) ?? readString(json.user_screen_name) ?? '';
  const entities = (json.entities && typeof json.entities === 'object' ? json.entities : {}) as Record<string, unknown>;
  const media: ParsedMedia[] = [];
  const entityMedia = entities.media;
  if (Array.isArray(entityMedia)) {
    entityMedia.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const record = item as Record<string, unknown>;
      const url = readString(record.media_url_https) ?? readString(record.media_url);
      if (!url) return;
      const typeRaw = readString(record.type)?.toLowerCase();
      const type: ParsedMedia['type'] = typeRaw === 'video' ? 'video' : typeRaw === 'animated_gif' ? 'animated_gif' : 'photo';
      const sizes = (record.sizes && typeof record.sizes === 'object' ? record.sizes : {}) as Record<string, Record<string, number>>;
      const large = sizes.large ?? sizes.medium ?? sizes.small;
      media.push({
        url,
        alt: readString(record.alt_text) || `tweet image ${index + 1}`,
        width: readNumber(large?.w),
        height: readNumber(large?.h),
        type,
      });
    });
  }
  return {
    text,
    authorName,
    authorHandle,
    createdAt,
    lang: lang ?? undefined,
    media,
    hashtags: collectStrings(entities.hashtags, 'text'),
    mentions: collectStrings(entities.user_mentions, 'screen_name'),
    links: collectExpandedUrls(entities.urls),
  };
}

export function parseFxTwitterTweetShape(json: Record<string, unknown>): ParsedTweet | null {
  if (!json) return null;
  const tweet = (json.tweet && typeof json.tweet === 'object' ? json.tweet : null) as Record<string, unknown> | null;
  if (!tweet) return null;
  const text = readString(tweet.text) ?? '';
  if (!text) return null;
  const author = (tweet.author && typeof tweet.author === 'object' ? tweet.author : {}) as Record<string, unknown>;
  const mediaRecord = tweet.media && typeof tweet.media === 'object' ? (tweet.media as Record<string, unknown>) : null;
  const photos = Array.isArray(mediaRecord?.photos) ? mediaRecord.photos : null;
  const media: ParsedMedia[] = [];
  if (Array.isArray(photos)) {
    photos.forEach((photo, index) => {
      if (!photo || typeof photo !== 'object') return;
      const item = photo as Record<string, unknown>;
      const url = readString(item.url);
      if (!url) return;
      media.push({
        url,
        alt: readString(item.alt) || `tweet image ${index + 1}`,
        width: readNumber(item.width),
        height: readNumber(item.height),
        type: 'photo',
      });
    });
  }
  return {
    text,
    authorName: readString(author.name) ?? '',
    authorHandle: readString(author.screen_name) ?? '',
    createdAt: readString(tweet.created_at) ?? '',
    lang: readString(tweet.lang) ?? undefined,
    media,
    hashtags: [],
    mentions: [],
    links: [],
  };
}

export function splitRewriteHashtags(text: string): { body: string; hashtags: string[] } {
  const lines = text.split(/\n+/);
  const tags: string[] = [];
  const bodyLines: string[] = [];
  let startedTagSection = false;
  for (const line of lines) {
    if (!startedTagSection && /^(#\S+\s*)+$/.test(line.trim())) {
      startedTagSection = true;
      const matches = line.match(/#\S+/g) ?? [];
      matches.forEach((tag) => tags.push(tag));
      continue;
    }
    if (!startedTagSection && /^\s*#\S+(\s+#\S+)+\s*$/.test(line)) {
      startedTagSection = true;
      const matches = line.match(/#\S+/g) ?? [];
      matches.forEach((tag) => tags.push(tag));
      continue;
    }
    if (startedTagSection) {
      const matches = line.match(/#\S+/g);
      if (matches) matches.forEach((tag) => tags.push(tag));
      else tags.push(line.trim());
      continue;
    }
    bodyLines.push(line);
  }
  return { body: bodyLines.join('\n').trim(), hashtags: Array.from(new Set(tags)).slice(0, 4) };
}

export function clampRewriteText(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  const sliced = chars.slice(0, maxChars).join('');
  const lastBreak = Math.max(sliced.lastIndexOf('。'), sliced.lastIndexOf('！'), sliced.lastIndexOf('？'), sliced.lastIndexOf('\n'));
  if (lastBreak > Math.floor(maxChars * 0.6)) return sliced.slice(0, lastBreak + 1).trimEnd();
  return sliced.trimEnd();
}