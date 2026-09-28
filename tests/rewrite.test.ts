import { describe, expect, it } from 'vitest';
import {
  computeSyndicationToken,
  extractTweetIdFromUrl,
  parseSyndicationTweetShape,
  parseFxTwitterTweetShape,
  splitRewriteHashtags,
  clampRewriteText,
} from '@/src/lib/rewrite-helpers';

describe('rewrite helpers', () => {
  it('extracts tweet id from canonical x.com URLs', () => {
    expect(extractTweetIdFromUrl('https://x.com/elonmusk/status/1234567890123456789')).toBe('1234567890123456789');
    expect(extractTweetIdFromUrl('https://twitter.com/foo/status/12345678901')).toBe('12345678901');
    expect(extractTweetIdFromUrl('https://x.com/i/status/9000000000')).toBe('9000000000');
    expect(extractTweetIdFromUrl('https://example.com')).toBeNull();
    expect(extractTweetIdFromUrl('https://x.com/foo/status/42')).toBeNull();
  });

  it('computes a deterministic syndication token', () => {
    const id = '1764844739393282364';
    const first = computeSyndicationToken(id);
    const second = computeSyndicationToken(id);
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(4);
  });

  it('parses syndication payload into a tweet shape', () => {
    const payload = {
      text: 'Hello world https://t.co/abcd',
      lang: 'en',
      created_at: '2026-09-28T00:00:00.000Z',
      favorite_count: 5,
      user: { name: 'Alice', screen_name: 'alice' },
      entities: {
        hashtags: [{ text: 'AI' }],
        user_mentions: [{ screen_name: 'bob' }],
        urls: [{ expanded_url: 'https://example.com/post' }],
        media: [{ media_url_https: 'https://pbs.twimg.com/media/abc.jpg', type: 'photo', alt_text: 'cat' }],
      },
    };
    const result = parseSyndicationTweetShape(payload);
    expect(result?.text).toContain('Hello world');
    expect(result?.authorHandle).toBe('alice');
    expect(result?.hashtags).toContain('AI');
    expect(result?.mentions).toContain('bob');
    expect(result?.links).toContain('https://example.com/post');
    expect(result?.media).toHaveLength(1);
    expect(result?.media[0]?.type).toBe('photo');
  });

  it('parses fxtwitter payload with photos array', () => {
    const payload = {
      tweet: {
        text: 'fx hello',
        author: { name: 'Bob', screen_name: 'bob' },
        created_at: '2026-09-28T00:00:00.000Z',
        lang: 'en',
        media: {
          photos: [
            { url: 'https://pbs.twimg.com/media/x.jpg', alt: 'pic', width: 1200, height: 800 },
          ],
        },
      },
    };
    const result = parseFxTwitterTweetShape(payload);
    expect(result?.text).toBe('fx hello');
    expect(result?.authorHandle).toBe('bob');
    expect(result?.media).toHaveLength(1);
    expect(result?.media[0]?.url).toBe('https://pbs.twimg.com/media/x.jpg');
  });

  it('returns null for tombstoned tweet', () => {
    expect(parseSyndicationTweetShape({ __typename: 'TweetTombstone' })).toBeNull();
    expect(parseSyndicationTweetShape({ tombstone: true })).toBeNull();
  });

  it('separates hashtags from body for X/Twitter rewrites', () => {
    const { body, hashtags } = splitRewriteHashtags('正文一段。\n\n#AI #中文');
    expect(body).toContain('正文一段');
    expect(hashtags).toEqual(['#AI', '#中文']);
  });

  it('clamps rewrite body to platform max chars while preserving punctuation', () => {
    const text = '一'.repeat(250);
    const clamped = clampRewriteText(text, 200);
    expect(Array.from(clamped).length).toBeLessThanOrEqual(200);
  });
});