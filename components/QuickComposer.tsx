'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, ChevronDown, Github, Link2, Loader2, Palette, Sparkles } from 'lucide-react';
import { AGENTS, mergeBrief } from '@/src/lib/agents';
import { WRITING_STYLES } from '@/src/lib/styles';
import { WECHAT_TEMPLATES } from '@/src/lib/templates';
import type { Voice } from '@/src/lib/types';
import { useArticleStore } from '@/src/lib/store';
import { composeFetchedMaterial, extractHttpUrls, fetchMaterialSources, isGitHubUrl } from '@/src/lib/material-input';
import { inferAgentId, inferPlatformsFromInstruction } from '@/src/lib/creator-intent';
import { loadConfig } from '@/src/lib/config';
import { cn } from './ui/cn';

const EXAMPLES = ['根据这个链接写一篇克制的新闻解读', '把我的 GitHub 项目发到全平台', '只排版下面这篇原稿，不要改写'];

export function QuickComposer({ compact = false, onComplete }: { compact?: boolean; onComplete?: () => void }) {
  const router = useRouter();
  const create = useArticleStore((state) => state.create);
  const config = React.useMemo(() => loadConfig(), []);
  const [input, setInput] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null);
  const [selectedStyleId, setSelectedStyleId] = React.useState<Voice | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | null>(null);
  const [agentMenuOpen, setAgentMenuOpen] = React.useState(false);
  const [styleMenuOpen, setStyleMenuOpen] = React.useState(false);
  const [templateMenuOpen, setTemplateMenuOpen] = React.useState(false);
  const agentMenuRef = React.useRef<HTMLDivElement>(null);
  const styleMenuRef = React.useRef<HTMLDivElement>(null);
  const templateMenuRef = React.useRef<HTMLDivElement>(null);
  const urls = React.useMemo(() => extractHttpUrls(input), [input]);
  const githubCount = urls.filter(isGitHubUrl).length;

  React.useEffect(() => {
    const menus = [
      { open: agentMenuOpen, ref: agentMenuRef, close: () => setAgentMenuOpen(false) },
      { open: styleMenuOpen, ref: styleMenuRef, close: () => setStyleMenuOpen(false) },
      { open: templateMenuOpen, ref: templateMenuRef, close: () => setTemplateMenuOpen(false) },
    ];
    const active = menus.filter((menu) => menu.open);
    if (!active.length) return;
    const handleClick = (event: MouseEvent) => {
      for (const menu of active) {
        if (!menu.ref.current?.contains(event.target as Node)) menu.close();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [agentMenuOpen, styleMenuOpen, templateMenuOpen]);

  const selectedAgent = selectedAgentId ? AGENTS.find((item) => item.id === selectedAgentId) : null;
  const effectiveVoice = selectedStyleId ?? selectedAgent?.defaults.voice ?? config.marketStyleId ?? null;
  const selectedStyle = effectiveVoice ? WRITING_STYLES.find((item) => item.id === effectiveVoice) : null;
  const selectedTemplate = selectedTemplateId
    ? WECHAT_TEMPLATES.find((item) => item.id === selectedTemplateId)
    : WECHAT_TEMPLATES.find((item) => item.id === config.defaultTemplateId);

  const pickAgent = (id: string | null) => {
    setSelectedAgentId(id);
    const agent = id ? AGENTS.find((item) => item.id === id) : null;
    if (agent?.defaults.voice) setSelectedStyleId(agent.defaults.voice);
    setAgentMenuOpen(false);
  };

  const closeAllMenus = () => {
    setAgentMenuOpen(false);
    setStyleMenuOpen(false);
    setTemplateMenuOpen(false);
  };

  const submit = async () => {
    if (!input.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const sources = urls.length ? await fetchMaterialSources(urls) : [];
      const failedUrls = sources.filter((source) => !source.text).map((source) => source.url);
      // 用户给了链接但全部读取失败：不能拿着「未读取正文」占位符让 AI 瞎写，直接中止
      if (urls.length > 0 && sources.length > 0 && failedUrls.length === sources.length) {
        throw new Error('所有链接都读取失败，请检查链接是否需要登录或已失效，然后重试');
      }
      const agentId = selectedAgentId ?? inferAgentId(input, urls);
      const agent = AGENTS.find((item) => item.id === agentId) ?? AGENTS[0];
      const requestedPlatforms = inferPlatformsFromInstruction(input);
      const brief = mergeBrief(agent, undefined, {
        material: composeFetchedMaterial(input, urls, sources),
        ...(requestedPlatforms.length > 0 ? { platforms: requestedPlatforms } : {}),
        bilingual: /中英|双语|英文版|English/i.test(input),
        ...(effectiveVoice ? { voice: effectiveVoice } : {}),
        templateId: selectedTemplate?.id,
      });
      const article = create(brief);
      useArticleStore.getState().update(article.id, {
        conversation: [
          { id: crypto.randomUUID(), role: 'user', content: input.trim(), createdAt: Date.now() },
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `我会按「${agent.name}」处理${brief.platforms.length ? `，并准备 ${brief.platforms.length} 个平台版本` : ''}。生成后可以继续直接告诉我怎么改。${failedUrls.length ? `\n\n注意：以下链接读取失败，相关内容未纳入素材：\n${failedUrls.join('\n')}` : ''}`,
            createdAt: Date.now(),
          },
        ],
      });
      onComplete?.();
      router.push(`/article/${article.id}?step=brief&generate=1`);
    } catch (reason) {
      setError((reason as Error).message || '暂时无法开始，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={cn('w-full', !compact && 'mx-auto max-w-3xl')}>
      <div className={cn(
        'overflow-hidden border border-white/90 bg-white/90 shadow-[0_24px_80px_rgba(79,70,229,0.13)] backdrop-blur-xl',
        compact ? 'rounded-2xl' : 'rounded-3xl',
      )}>
        <textarea
          aria-label="创作素材"
          value={input}
          onChange={(event) => { setInput(event.target.value); setError(null); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            }
          }}
          rows={compact ? 3 : 5}
          autoFocus={compact}
          placeholder={'像和编辑说话一样告诉我：素材是什么、想表达什么、准备发到哪里。\n也可以直接粘贴正文、多个网页或 GitHub 链接…'}
          className={cn(
            'w-full resize-none border-0 bg-transparent px-5 pt-5 text-base leading-relaxed text-ink placeholder:text-ink-muted/80 focus:outline-none sm:px-6 sm:pt-6',
            compact ? 'min-h-40' : 'min-h-52 sm:text-lg',
          )}
        />

        {(urls.length > 0 || error) && (
          <div className="px-5 pb-2 sm:px-6">
            {urls.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700"><Link2 size={11}/> 已识别 {urls.length} 个链接</span>
                {githubCount > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-slate-700"><Github size={11}/> {githubCount} 个 GitHub 仓库</span>}
                {urls.length >= 8 && <span>一次最多读取前 8 个</span>}
              </div>
            )}
            {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-ink-line/80 bg-white/70 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-1.5">
            <div ref={agentMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => { setAgentMenuOpen((open) => !open); setStyleMenuOpen(false); setTemplateMenuOpen(false); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-ink-line/70 bg-white px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:border-indigo-300 hover:bg-indigo-50/50"
              >
                {selectedAgent ? (
                  <><span>{selectedAgent.emoji}</span><span className="max-w-20 truncate sm:max-w-32">{selectedAgent.name}</span></>
                ) : (
                  <><Sparkles size={13} className="text-indigo-600"/><span>自动</span></>
                )}
                <ChevronDown size={12} className={cn('text-ink-muted transition-transform', agentMenuOpen && 'rotate-180')}/>
              </button>
              {agentMenuOpen && (
                <div className="absolute bottom-full left-0 z-30 mb-2 w-60 rounded-xl border border-white/80 bg-white/95 p-1.5 shadow-[0_16px_48px_rgba(79,70,229,0.15)] backdrop-blur-xl">
                  <button
                    type="button"
                    onClick={() => pickAgent(null)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors',
                      !selectedAgentId ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-ink hover:bg-slate-50',
                    )}
                  >
                    <Sparkles size={14} className="shrink-0 text-indigo-600"/>
                    <div>
                      <p className="font-medium">自动</p>
                      <p className="text-[10px] text-ink-muted">AI 理解素材并匹配合适写法</p>
                    </div>
                  </button>
                  <div className="my-1 h-px bg-ink-line/50"/>
                  {AGENTS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => pickAgent(item.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors',
                        selectedAgentId === item.id ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-ink hover:bg-slate-50',
                      )}
                    >
                      <span className="shrink-0 text-sm">{item.emoji}</span>
                      <div className="min-w-0">
                        <p className="font-medium">{item.name}</p>
                        <p className="truncate text-[10px] text-ink-muted">{item.tagline}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div ref={styleMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => { closeAllMenus(); setStyleMenuOpen(true); }}
                className="inline-flex items-center gap-1 rounded-lg border border-ink-line/70 bg-white px-2 py-1.5 text-xs font-medium text-ink transition-colors hover:border-indigo-300 hover:bg-indigo-50/50"
              >
                <span className="max-w-14 truncate sm:max-w-20">{selectedStyle ? selectedStyle.name : '风格'}</span>
                <ChevronDown size={11} className={cn('text-ink-muted transition-transform', styleMenuOpen && 'rotate-180')}/>
              </button>
              {styleMenuOpen && (
                <div className="absolute bottom-full left-0 z-30 mb-2 w-44 rounded-xl border border-white/80 bg-white/95 p-1.5 shadow-[0_16px_48px_rgba(79,70,229,0.15)] backdrop-blur-xl">
                  {!selectedAgentId && (
                    <button
                      type="button"
                      onClick={() => { setSelectedStyleId(null); setStyleMenuOpen(false); }}
                      className={cn(
                        'flex w-full items-center rounded-lg px-3 py-2 text-left text-xs transition-colors',
                        !selectedStyleId ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-ink hover:bg-slate-50',
                      )}
                    >
                      <span className="font-medium">跟随 Agent</span>
                    </button>
                  )}
                  {WRITING_STYLES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => { setSelectedStyleId(item.id); setStyleMenuOpen(false); }}
                      className={cn(
                        'flex w-full items-center rounded-lg px-3 py-2 text-left text-xs transition-colors',
                        selectedStyleId === item.id ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-ink hover:bg-slate-50',
                      )}
                    >
                      <span className="font-medium">{item.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div ref={templateMenuRef} className="relative hidden shrink-0 sm:block">
              <button
                type="button"
                onClick={() => { closeAllMenus(); setTemplateMenuOpen(true); }}
                className="inline-flex items-center gap-1 rounded-lg border border-ink-line/70 bg-white px-2 py-1.5 text-xs font-medium text-ink transition-colors hover:border-indigo-300 hover:bg-indigo-50/50"
              >
                <Palette size={12} className="text-ink-muted"/>
                <span className="max-w-14 truncate">{selectedTemplate ? selectedTemplate.name : '模板'}</span>
                <ChevronDown size={11} className={cn('text-ink-muted transition-transform', templateMenuOpen && 'rotate-180')}/>
              </button>
              {templateMenuOpen && (
                <div className="absolute bottom-full left-0 z-30 mb-2 w-44 rounded-xl border border-white/80 bg-white/95 p-1.5 shadow-[0_16px_48px_rgba(79,70,229,0.15)] backdrop-blur-xl">
                  <button
                    type="button"
                    onClick={() => { setSelectedTemplateId(null); setTemplateMenuOpen(false); }}
                    className={cn(
                      'flex w-full items-center rounded-lg px-3 py-2 text-left text-xs transition-colors',
                      !selectedTemplateId ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-ink hover:bg-slate-50',
                    )}
                  >
                    <span className="font-medium">跟随全局默认</span>
                  </button>
                  {WECHAT_TEMPLATES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => { setSelectedTemplateId(item.id); setTemplateMenuOpen(false); }}
                      className={cn(
                        'flex w-full items-center rounded-lg px-3 py-2 text-left text-xs transition-colors',
                        selectedTemplateId === item.id ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-ink hover:bg-slate-50',
                      )}
                    >
                      <span className="font-medium">{item.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!input.trim() || submitting}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-slate-900 to-indigo-700 px-4 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:pointer-events-none disabled:opacity-40 sm:size-10 sm:px-0"
            aria-label="开始创作"
          >
            {submitting ? <Loader2 size={16} className="animate-spin"/> : <ArrowUp size={17}/>}<span className="sm:hidden">{submitting ? '正在读取素材' : '开始创作'}</span>
          </button>
        </div>
      </div>

      {!compact && (
        <div className="mt-4 flex flex-col items-center gap-3">
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
            {EXAMPLES.map((example) => (
              <button key={example} type="button" onClick={() => setInput(example)} className="h-10 shrink-0 rounded-full border border-white/90 bg-white/60 px-3 text-[11px] text-ink-muted hover:border-indigo-200 hover:bg-white hover:text-indigo-700 sm:h-9">
                {example}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[11px] text-ink-muted">
            <span className="inline-flex items-center gap-1.5"><Link2 size={12}/> 最多读取 8 个链接</span>
            <span className="inline-flex items-center gap-1.5"><Github size={12}/> 自动读取 GitHub README</span>
          </div>
        </div>
      )}
    </div>
  );
}
