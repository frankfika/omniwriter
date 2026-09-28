'use client';

// 客户端薄封装：把"洗稿"全流程（fetch + 解析 + 图片收集 + cross-validation）打包成
// 一个调用，并暴露一个 React 友好的可取消 Promise。失败时回传具体原因；
// 所有错误都保留后端原话，方便 UI 直接展示。

import type { PlatformId } from './types';
import type { RewriteResult } from './rewrite';

export interface RewriteClientResponse {
  result: RewriteResult;
  verdict?: {
    model: string;
    passed: boolean;
    score: number;
    issues: string[];
    suggestions: string[];
    fallback?: string;
  } | null;
}

export interface RewriteClientOptions {
  url: string;
  target?: PlatformId;
  voice?: 'news' | 'sharp' | 'casual' | 'explainer';
  intent?: string;
  ai?: { apiKey?: string; baseUrl?: string; model?: string };
  signal?: AbortSignal;
}

export async function rewriteUrl(options: RewriteClientOptions): Promise<RewriteClientResponse> {
  const response = await fetch('/api/rewrite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: options.url,
      target: options.target ?? 'x',
      voice: options.voice,
      intent: options.intent,
      ai: options.ai,
    }),
    signal: options.signal,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || `HTTP ${response.status}`);
  }
  return json as RewriteClientResponse;
}

export async function findGithubScreenshots(query: string, limit = 4): Promise<Array<{ url: string; alt: string; source: string }>> {
  const response = await fetch('/api/rewrite/github-screenshots', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, limit }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return (json.images ?? []) as Array<{ url: string; alt: string; source: string }>;
}

export async function verifyRewriteDraft(input: {
  draft: string;
  platform: string;
  sourceSummary?: string;
  intent?: string;
  ai?: { apiKey?: string; baseUrl?: string; model?: string };
}): Promise<RewriteClientResponse['verdict']> {
  const response = await fetch('/api/rewrite/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return json.verdict ?? null;
}

export interface TwitterComposePayload {
  text: string;
  images: Array<{ url: string; alt: string }>;
  hashtags: string[];
  tweetIntentUrl: string;
}

export function buildTwitterComposeText(body: string, hashtags: string[]): string {
  const tagSuffix = hashtags.length ? `\n\n${hashtags.join(' ')}` : '';
  return `${body.trim()}${tagSuffix}`;
}

export function buildTwitterIntentUrl(text: string): string {
  const intent = new URL('https://twitter.com/intent/tweet');
  intent.searchParams.set('text', text);
  return intent.toString();
}