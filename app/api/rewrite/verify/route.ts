// 对已生成的草稿做一次交叉验证。
// Body: { draft, platform, sourceSummary?, intent?, ai? }

import { NextRequest, NextResponse } from 'next/server';
import { crossValidateDraft } from '@/src/lib/cross-validate';
import type { AiLike } from '@/src/lib/ai';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: { draft?: string; platform?: string; sourceSummary?: string; intent?: string; ai?: AiLike };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }
  const draft = typeof body.draft === 'string' ? body.draft.trim() : '';
  const platform = typeof body.platform === 'string' ? body.platform.trim() : 'x';
  if (!draft) return NextResponse.json({ error: '草稿为空' }, { status: 400 });
  if (draft.length > 8_000) return NextResponse.json({ error: '草稿过长，请控制在 8000 字以内' }, { status: 413 });

  try {
    const verdict = await crossValidateDraft({
      draft,
      platform,
      sourceSummary: body.sourceSummary,
      intent: body.intent,
      signal: req.signal,
    });
    if (!verdict) return NextResponse.json({ error: '交叉验证未运行：AI 不可用' }, { status: 503 });
    return NextResponse.json({ verdict });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return NextResponse.json({ error: '交叉验证已取消' }, { status: 504 });
    }
    return NextResponse.json({ error: (error as Error).message || '交叉验证失败' }, { status: 500 });
  }
}