'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, PenLine } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { QuickComposer } from '@/components/QuickComposer';
import { RewriterLauncher } from '@/components/RewriterLauncher';
import { useArticleStore } from '@/src/lib/store';
import { useAiStatus } from '@/src/lib/use-ai-status';
import { loadConfig } from '@/src/lib/config';
import type { Brief } from '@/src/lib/types';

export default function HomePage() {
  const hydrate = useArticleStore((state) => state.hydrate);
  const articles = useArticleStore((state) => state.articles);
  const create = useArticleStore((state) => state.create);
  const { aiReady } = useAiStatus();
  const router = useRouter();

  React.useEffect(() => { hydrate(); }, [hydrate]);

  const onBlank = () => {
    const config = loadConfig();
    const article = create({
      material: '',
      materialType: 'topic',
      angle: '',
      voice: config.voice,
      length: 'medium',
      platforms: config.defaultPlatforms,
      bilingual: config.bilingual,
    } as Brief);
    router.push(`/article/${article.id}?write=1`);
  };

  return (
    <AppShell>
      <div className="h-full overflow-y-auto app-workspace-bg">
        <div className="mx-auto flex min-h-full max-w-5xl flex-col px-5 py-10 sm:px-8 sm:py-14">
          <section className="flex flex-1 flex-col justify-center py-8 sm:py-12">
            <div className="mb-7 text-center">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/90 bg-white/65 px-3 py-1.5 text-[11px] font-medium text-ink-muted shadow-sm backdrop-blur">
                <span className={`size-1.5 rounded-full ${aiReady ? 'bg-emerald-500' : aiReady === false ? 'bg-amber-500' : 'bg-ink-line'}`}/>
                {aiReady ? 'AI 已连接' : aiReady === false ? '需要连接 AI' : '正在检查 AI'}
                {aiReady === false && <Link href="/settings" className="inline-flex min-h-10 items-center rounded-lg px-2 font-semibold text-indigo-700 hover:bg-indigo-50 hover:underline underline-offset-2 sm:min-h-0 sm:py-1">去设置</Link>}
              </div>
              <h1 className="mx-auto max-w-3xl text-[34px] font-bold leading-[1.12] tracking-tightish text-slate-950 sm:text-[46px]">
                把素材放进来，<span className="block bg-gradient-to-r from-indigo-700 to-sky-500 bg-clip-text text-transparent">写成可发布的内容。</span>
              </h1>
              <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-ink-soft sm:text-base">这里就是唯一的创作入口。说清楚你要写什么，或直接放入资料；系统会自动选择合适能力。</p>
            </div>
            <QuickComposer/>
          </section>

          <section className="border-t border-white/80 pt-7">
            <RewriterLauncher/>
          </section>

          <section className="border-t border-white/80 pt-7">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-ink">最近内容</h2>
                <p className="mt-0.5 text-[11px] text-ink-muted">自动保存在当前浏览器</p>
              </div>
              <button type="button" onClick={onBlank} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-xs text-ink-muted transition-colors hover:bg-white/70 hover:text-ink sm:min-h-8">
                <PenLine size={13}/> 打开空白编辑器
              </button>
            </div>
            {articles.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-indigo-200 bg-white/45 px-5 py-8 text-center text-xs text-ink-muted">第一篇内容会出现在这里。</div>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {[...articles].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6).map((article) => (
                  <li key={article.id}>
                    <Link href={`/article/${article.id}`} className="flex items-center gap-3 rounded-xl border border-white/80 bg-white/55 px-3 py-3 transition-colors hover:border-indigo-200 hover:bg-white">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"><FileText size={14}/></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{article.title || '未命名'}</span>
                        <span className="mt-0.5 block text-[10px] text-ink-muted">{new Date(article.updatedAt).toLocaleString('zh-CN')}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
