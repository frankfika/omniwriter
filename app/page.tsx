'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { QuickComposer } from '@/components/QuickComposer';
import { RewriterLauncher } from '@/components/RewriterLauncher';
import { useArticleStore } from '@/src/lib/store';
import { useAiStatus } from '@/src/lib/use-ai-status';

function relativeTime(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

export default function HomePage() {
  const hydrate = useArticleStore((state) => state.hydrate);
  const articles = useArticleStore((state) => state.articles);
  const { aiReady } = useAiStatus();

  React.useEffect(() => { hydrate(); }, [hydrate]);

  return (
    <AppShell>
      <div className="h-full overflow-y-auto app-workspace-bg">
        <div className="mx-auto flex min-h-full max-w-5xl flex-col px-5 py-10 sm:px-8 sm:py-14">
          <section className="flex flex-1 flex-col justify-center py-8 sm:py-12">
            <div className="mb-7 text-center">
              {aiReady === false && (
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-ink-line bg-white px-3 py-1.5 text-xs font-medium text-ink-muted shadow-sm">
                  <span className="size-1.5 rounded-full bg-amber-500"/>
                  需要连接 AI
                  <Link href="/settings" className="inline-flex min-h-10 items-center rounded-lg px-2 font-semibold text-ink underline-offset-2 hover:underline sm:min-h-0 sm:py-1">去设置</Link>
                </div>
              )}
              <h1 className="mx-auto max-w-3xl text-2xl font-semibold leading-[1.2] tracking-tightish text-ink sm:text-3xl">
                把素材放进来，写成可发布的内容。
              </h1>
            </div>
            <QuickComposer/>
          </section>

          <details className="group mt-6">
            <summary className="inline-flex cursor-pointer list-none select-none items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
              改写一段已有文案
              <ChevronDown size={14} className="transition-transform group-open:rotate-180"/>
            </summary>
            <div className="pt-4">
              <RewriterLauncher/>
            </div>
          </details>

          {articles.length > 0 && (
            <section className="border-t border-ink-line pt-7 xl:hidden">
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-ink">最近内容</h2>
                <p className="mt-0.5 text-xs text-ink-muted">自动保存在当前浏览器</p>
              </div>
              <ul>
                {[...articles].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5).map((article) => (
                  <li key={article.id}>
                    <Link href={`/article/${article.id}`} className="flex items-baseline justify-between gap-3 rounded-lg py-2 text-sm text-ink transition-colors hover:text-ink-soft">
                      <span className="min-w-0 truncate">{article.title || '未命名'}</span>
                      <span className="shrink-0 text-xs text-ink-muted">{relativeTime(article.updatedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </AppShell>
  );
}
