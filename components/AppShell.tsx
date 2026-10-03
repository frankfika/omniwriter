'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Blocks, FileText, PenLine, Settings, Trash2 } from 'lucide-react';
import { useArticleStore } from '@/src/lib/store';
import { cn } from './ui/cn';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const hydrate = useArticleStore((s) => s.hydrate);
  const hydrated = useArticleStore((s) => s.hydrated);
  const corrupted = useArticleStore((s) => s.corrupted);
  const discardCorrupt = useArticleStore((s) => s.discardCorrupt);
  const articles = useArticleStore((s) => s.articles);
  const remove = useArticleStore((s) => s.remove);
  const flush = useArticleStore((s) => s.flush);
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null);
  const pendingDeleteRef = React.useRef<string | null>(null);
  pendingDeleteRef.current = pendingDelete;

  React.useEffect(() => {
    if (!pendingDelete) return;
    const timer = window.setTimeout(() => setPendingDelete(null), 3000);
    return () => window.clearTimeout(timer);
  }, [pendingDelete]);

  const requestDelete = React.useCallback((id: string, title: string) => {
    if (pendingDeleteRef.current === id) {
      remove(id);
      setPendingDelete(null);
      if (pathname === `/article/${id}`) router.push('/');
      return;
    }
    setPendingDelete(id);
  }, [pathname, remove, router]);

  React.useEffect(() => { hydrate(); }, [hydrate]);

  React.useEffect(() => {
    const persist = () => { flush(); };
    const persistWhenHidden = () => {
      if (document.visibilityState === 'hidden') persist();
    };
    const saveShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      persist();
    };
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', persistWhenHidden);
    window.addEventListener('keydown', saveShortcut);
    return () => {
      window.removeEventListener('pagehide', persist);
      document.removeEventListener('visibilitychange', persistWhenHidden);
      window.removeEventListener('keydown', saveShortcut);
    };
  }, [flush]);

  return (
    <div className="h-[100dvh] w-full flex flex-col app-workspace-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        跳到主内容
      </a>
      {corrupted && (
        <div role="alert" className="z-40 shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          <span>本地文章数据无法解析，为避免覆盖已暂停自动保存。</span>
          <Link href="/settings" className="font-medium underline underline-offset-2">去 设置 → 数据安全 恢复</Link>
          <button type="button" onClick={discardCorrupt} className="font-medium underline underline-offset-2">我已确认，丢弃损坏数据</button>
        </div>
      )}
      <div className="min-h-0 flex-1 grid grid-rows-1 grid-cols-1 xl:grid-cols-[260px_1fr] overflow-hidden">
      <aside className="hidden xl:flex flex-col border-r border-ink-line bg-white">
        <div className="px-4 h-14 flex items-center border-b border-ink-line/70">
          <span className="mr-2 size-6 rounded-lg bg-ink"/>
          <Link href="/" className="font-semibold tracking-tightish">OmniWriter</Link>
        </div>
        <div className="p-2 space-y-1">
          <Link
            href="/"
            className={cn(
              'flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium hover:bg-ink-panel',
              pathname === '/' && 'bg-ink-panel font-medium',
            )}
          >
            <PenLine size={14} className="text-ink-muted"/>
            创作台
          </Link>
          <Link
            href="/marketplace"
            className={cn(
              'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-ink-panel',
              pathname === '/marketplace' && 'bg-ink-panel font-medium',
            )}
          >
            <Blocks size={13} className="text-ink-muted"/>
            能力市场
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto px-1.5 pb-2">
          {hydrated && articles.length === 0 && (
            <div className="px-3 py-6 text-xs text-ink-muted">还没有文章。选一个 Agent 开始。</div>
          )}
          <ul className="flex flex-col gap-0.5">
            {articles.map((a) => {
              const active = pathname === `/article/${a.id}`;
              return (
                <li key={a.id} className="group relative">
                  <Link
                    href={`/article/${a.id}`}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-ink-panel',
                      active && 'bg-ink-panel font-medium',
                    )}
                  >
                    <FileText size={13} className="text-ink-muted shrink-0"/>
                    <span className="truncate">{a.title || '未命名'}</span>
                  </Link>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      requestDelete(a.id, a.title || '未命名');
                    }}
                    aria-label={pendingDelete === a.id ? `确认删除 ${a.title || '未命名'}（再次点击）` : `删除 ${a.title || '未命名'}`}
                    className={cn(
                      'absolute right-1 top-1/2 -translate-y-1/2 inline-flex min-h-10 min-w-10 items-center justify-center gap-1 rounded text-ink-muted hover:text-red-600 hover:bg-red-50 sm:h-8 sm:w-8 sm:min-h-0 sm:min-w-0',
                      pendingDelete === a.id && 'bg-red-50 text-red-600 ring-1 ring-red-200',
                      pendingDelete !== a.id && 'lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100',
                    )}
                    title={pendingDelete === a.id ? '再次点击以确认删除（3 秒内有效）' : '删除'}
                  >
                    <Trash2 size={13}/>
                    {pendingDelete === a.id && <span className="ml-0.5 text-xs font-medium">确认</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="p-2 border-t border-ink-line">
          <Link
            href="/settings"
            className={cn(
              'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-ink-panel',
              pathname === '/settings' && 'bg-ink-panel font-medium',
            )}
          >
            <Settings size={13} className="text-ink-muted"/>
            设置
          </Link>
        </div>
      </aside>

      <div className="flex flex-col min-w-0">
        {/* 移动端顶栏 */}
        <div className="xl:hidden flex items-center justify-between gap-3 px-4 h-12 border-b border-ink-line bg-white shrink-0">
          <Link href="/" className="inline-flex h-11 shrink-0 items-center gap-2 px-2 font-semibold tracking-tightish sm:h-8"><span className="size-5 rounded-md bg-ink"/>OmniWriter</Link>
          <div className="flex items-center gap-1 sm:gap-3 text-sm">
            <Link href="/" aria-label="创作台" title="创作台" className={cn('h-11 w-11 p-0 sm:h-8 sm:w-auto sm:px-2 inline-flex items-center justify-center gap-1 rounded-md hover:bg-ink-panel hover:text-ink', pathname === '/' ? 'bg-ink-panel text-ink font-medium' : 'text-ink-muted')}>
              <PenLine size={14}/><span className="hidden sm:inline">创作</span>
            </Link>
            <Link href="/marketplace" aria-label="能力市场" title="能力市场" className={cn('h-11 w-11 p-0 sm:h-8 sm:w-auto sm:px-2 inline-flex items-center justify-center gap-1 rounded-md hover:bg-ink-panel hover:text-ink', pathname === '/marketplace' ? 'bg-ink-panel text-ink font-medium' : 'text-ink-muted')}>
              <Blocks size={14}/><span className="hidden sm:inline">市场</span>
            </Link>
            <Link href="/settings" aria-label="设置" title="设置" className={cn('h-11 w-11 p-0 sm:h-8 sm:w-auto sm:px-2 inline-flex items-center justify-center gap-1 rounded-md hover:bg-ink-panel hover:text-ink', pathname === '/settings' ? 'bg-ink-panel text-ink font-medium' : 'text-ink-muted')}>
              <Settings size={14}/><span className="hidden sm:inline">设置</span>
            </Link>
          </div>
        </div>
        <main id="main" className="flex-1 min-h-0 overflow-hidden">{children}</main>
        </div>
      </div>
    </div>
  );
}
