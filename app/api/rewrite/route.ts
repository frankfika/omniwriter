// 洗稿：POST /api/rewrite
// Body: { url: string, target?: PlatformId, voice?, intent?, ai? }
// Response: RewriteResult（含原文摘要、原图清单、平台改写稿、hashtag、图片插入位置）

import { NextRequest, NextResponse } from 'next/server';
import { rewriteFromUrl, type RewriteOptions } from '@/src/lib/rewrite';
import { crossValidateDraft } from '@/src/lib/cross-validate';
import type { AiLike } from '@/src/lib/ai';
import { PLATFORM_ORDER } from '@/src/lib/platforms';
import type { PlatformId } from '@/src/lib/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: { url?: string; target?: string; voice?: RewriteOptions['voice']; intent?: string; ai?: AiLike };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) return NextResponse.json({ error: '请提供需要洗稿的链接' }, { status: 400 });
  if (!/^https?:\/\//i.test(url)) return NextResponse.json({ error: '只支持 http/https 链接' }, { status: 400 });

  const target = (PLATFORM_ORDER.includes(body.target as PlatformId) ? body.target : 'x') as PlatformId;
  const voice = body.voice;
  const intent = typeof body.intent === 'string' ? body.intent.trim().slice(0, 400) : undefined;

  try {
    const result = await rewriteFromUrl(url, target, {
      ai: body.ai,
      signal: req.signal,
      voice,
      intent,
    });
    let verdict = null;
    try {
      verdict = await crossValidateDraft({
        draft: result.body,
        platform: target,
        sourceSummary: result.source.summary,
        signal: req.signal,
      });
    } catch {
      // 交叉验证失败不阻断主结果
    }
    return NextResponse.json({ result, verdict }, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return NextResponse.json({ error: '洗稿已取消' }, { status: 504 });
    }
    return NextResponse.json({ error: (error as Error).message || '洗稿失败' }, { status: 500 });
  }
}