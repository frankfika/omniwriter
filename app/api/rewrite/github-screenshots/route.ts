// 找 GitHub 截图：POST /api/rewrite/github-screenshots
// Body: { query: string, limit?: number }
// Response: { images: PreservedImage[] }

import { NextRequest, NextResponse } from 'next/server';
import { findGithubScreenshots } from '@/src/lib/rewrite';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: { query?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
  }
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 240) : '';
  if (!query) return NextResponse.json({ error: '请提供搜索词' }, { status: 400 });
  try {
    const images = await findGithubScreenshots(query, { limit: body.limit, signal: req.signal });
    return NextResponse.json({ images }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return NextResponse.json({ error: '搜索已取消' }, { status: 504 });
    }
    return NextResponse.json({ error: (error as Error).message || '搜索失败' }, { status: 500 });
  }
}