'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, ChevronDown, Github, Link2, Loader2, Palette, SlidersHorizontal, Sparkles } from 'lucide-react';
import { AGENTS, mergeBrief } from '@/src/lib/agents';
import { WRITING_STYLES } from '@/src/lib/styles';
import { WECHAT_TEMPLATES } from '@/src/lib/templates';
import type { Voice } from '@/src/lib/types';
import { useArticleStore } from '@/src/lib/store';
import { composeFetchedMaterial, extractHttpUrls, fetchMaterialSources, isGitHubUrl } from '@/src/lib/material-input';
import { inferAgentId, inferPlatformsFromInstruction } from '@/src/lib/creator-intent';
import { loadConfig } from '@/src/lib/config';
import { cn } from './ui/cn';

const EXAMPLES = [
  '根据这个链接写一篇解读',
  '就「AI 编程会取代初级工程师吗」写一篇观点文',
  '把这段笔记整理成小红书：',
  '把我的 GitHub 项目发全平台',
  '只排版下面这段，不要改写',
];

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
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
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
    document.addEventListener('pointerdown', handleClick);
    return () => document.removeEventListener('pointerdown', handleClick);
  }, [agentMenuOpen, styleMenuOpen, templateMenuOpen]);

  const selectedAgent = selectedAgentId ? AGENTS.find((item) => item.id === selectedAgentId) : null;
  const effectiveVoice = selectedStyleId ?? selectedAgent?.defaults.voice ?? config.marketStyleId ?? null;
  const selectedStyle = effectiveVoice ? WRITING_STYLES.find((item) => item.id === effectiveVoice) : null;
  const selectedTemplate = selectedTemplateId
    ? WECHAT_TEMPLATES.find((item) => item.id === selectedTemplateId)
    : WECHAT_TEMPLATES.find((item) => item.id === config.defaultTemplateId);
  const hasAdvancedSelection = selectedAgentId !== null || selectedStyleId !== null || selectedTemplateId !== null;

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
      <div className="rounded-2xl border border-ink-line bg-white">
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
            'w-full resize-none rounded-t-2xl border-0 bg-transparent px-5 pt-5 text-base leading-relaxed text-ink placeholder:text-ink-muted/80 focus:outline-none sm:px-6 sm:pt-6',
            compact ? 'min-h-40' : 'min-h-52 sm:text-lg',
          )}
        />

        {(urls.length > 0 || error) && (
          <div className="px-5 pb-2 sm:px-6">
            {urls.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                <span className="inline-flex items-center gap-1 rounded-full bg-ink-panel px-2.5 py-1 text-ink-muted"><Link2 size={11}/> 已识别 {urls.length} 个链接</span>
                {githubCount > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-slate-700"><Github size={11}/> {githubCount} 个 GitHub 仓库</span>}
                {urls.length >= 8 && <span>一次最多读取前 8 个</span>}
              </div>
            )}
            {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
          </div>
        )}

        {advancedOpen && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-line/80 bg-white px-4 py-2.5 sm:px-5">
            <div ref={agentMenuRef} className="relative shrink-0">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={agentMenuOpen}
                aria-label={selectedAgent ? `写作能力：${selectedAgent.name}` : '写作能力（自动选择）'}
                onClick={() => { setAgentMenuOpen((open) => !open); setStyleMenuOpen(false); setTemplateMenuOpen(false); }}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-ink-line/70 bg-white px-2.5 sm:min-h-0 sm:py-1.5 text-xs font-medium text-ink transition-colors hover:bg-ink-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                {selectedAgent ? (
                  <><span>{selectedAgent.emoji}</span><span className="max-w-20 truncate sm:max-w-32">{selectedAgent.name}</span></>
                ) : (
                  <><Sparkles size={13} className="text-ink-muted"/><span>自动</span></>
                )}
                <ChevronDown size={12} className={cn('text-ink-muted transition-transform', agentMenuOpen && 'rotate-180')}/>
              </button>
              {agentMenuOpen && (
                <div role="menu" aria-label="选择写作能力" className="absolute bottom-full left-0 z-30 mb-2 max-h-[60vh] w-60 overflow-y-auto rounded-xl border border-ink-line bg-white p-1.5 shadow-sm">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => pickAgent(null)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
                      !selectedAgentId ? 'bg-ink-panel font-medium text-ink' : 'text-ink hover:bg-slate-50',
                    )}
                  >
                    <Sparkles size={14} className="shrink-0 text-ink-muted"/>
                    <div>
                      <p className="font-medium">自动</p>
                      <p className="text-xs text-ink-muted">AI 理解素材并匹配合适写法</p>
                    </div>
                  </button>
                  <div className="my-1 h-px bg-ink-line/50"/>
                  {AGENTS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      onClick={() => pickAgent(item.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
                        selectedAgentId === item.id ? 'bg-ink-panel font-medium text-ink' : 'text-ink hover:bg-slate-50',
                      )}
                    >
                      <span className="shrink-0 text-sm">{item.emoji}</span>
                      <div className="min-w-0">
                        <p className="font-medium">{item.name}</p>
                        <p className="truncate text-xs text-ink-muted">{item.tagline}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div ref={styleMenuRef} className="relative shrink-0">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={styleMenuOpen}
                aria-label={selectedStyle ? `写作风格：${selectedStyle.name}` : '写作风格'}
                onClick={() => { closeAllMenus(); setStyleMenuOpen(true); }}
                className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-ink-line/70 bg-white px-2 sm:min-h-0 sm:py-1.5 text-xs font-medium text-ink transition-colors hover:bg-ink-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                <span className="max-w-14 truncate sm:max-w-20">{selectedStyle ? selectedStyle.name : '风格'}</span>
                <ChevronDown size={11} className={cn('text-ink-muted transition-transform', styleMenuOpen && 'rotate-180')}/>
              </button>
              {styleMenuOpen && (
                <div role="menu" aria-label="选择写作风格" className="absolute bottom-full left-0 z-30 mb-2 max-h-[60vh] w-44 overflow-y-auto rounded-xl border border-ink-line bg-white p-1.5 shadow-sm">
                  {!selectedAgentId && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { setSelectedStyleId(null); setStyleMenuOpen(false); }}
                      className={cn(
                        'flex w-full items-center rounded-lg px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
                        !selectedStyleId ? 'bg-ink-panel font-medium text-ink' : 'text-ink hover:bg-slate-50',
                      )}
                    >
                      <span className="font-medium">跟随 Agent</span>
                    </button>
                  )}
                  {WRITING_STYLES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      onClick={() => { setSelectedStyleId(item.id); setStyleMenuOpen(false); }}
                      className={cn(
                        'flex w-full items-center rounded-lg px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
                        selectedStyleId === item.id ? 'bg-ink-panel font-medium text-ink' : 'text-ink hover:bg-slate-50',
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
                className="inline-flex items-center gap-1 rounded-lg border border-ink-line/70 bg-white px-2 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-ink-panel"
              >
                <Palette size={12} className="text-ink-muted"/>
                <span className="max-w-14 truncate">{selectedTemplate ? selectedTemplate.name : '模板'}</span>
                <ChevronDown size={11} className={cn('text-ink-muted transition-transform', templateMenuOpen && 'rotate-180')}/>
              </button>
              {templateMenuOpen && (
                <div className="absolute bottom-full left-0 z-30 mb-2 max-h-[60vh] w-44 overflow-y-auto rounded-xl border border-ink-line bg-white p-1.5 shadow-sm">
                  <button
                    type="button"
                    onClick={() => { setSelectedTemplateId(null); setTemplateMenuOpen(false); }}
                    className={cn(
                      'flex w-full items-center rounded-lg px-3 py-2 text-left text-xs transition-colors',
                      !selectedTemplateId ? 'bg-ink-panel font-medium text-ink' : 'text-ink hover:bg-slate-50',
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
                        selectedTemplateId === item.id ? 'bg-ink-panel font-medium text-ink' : 'text-ink hover:bg-slate-50',
                      )}
                    >
                      <span className="font-medium">{item.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 rounded-b-2xl border-t border-ink-line bg-white px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              aria-label="高级选项"
              aria-expanded={advancedOpen}
              onClick={() => { closeAllMenus(); setAdvancedOpen((open) => !open); }}
              className={cn(
                'inline-flex h-10 w-10 items-center justify-center rounded-lg border border-ink-line bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 sm:h-8 sm:w-8',
                advancedOpen ? 'bg-ink-panel text-ink' : 'text-ink-muted hover:bg-ink-panel hover:text-ink',
              )}
            >
              <span className="relative inline-flex">
                <SlidersHorizontal size={15}/>
                {hasAdvancedSelection && <span className="absolute -right-1.5 -top-1.5 size-1.5 rounded-full bg-ink"/>}
              </span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!input.trim() || submitting}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold text-white transition-colors hover:bg-ink-soft disabled:pointer-events-none disabled:opacity-40 sm:size-10 sm:px-0"
            aria-label={submitting ? '正在读取素材' : '开始创作'}
          >
            {submitting ? <Loader2 size={16} className="animate-spin"/> : <ArrowUp size={17}/>}<span className="sm:hidden">{submitting ? '正在读取素材' : '开始创作'}</span>
          </button>
        </div>
      </div>

      {!compact && (
        <div className="mt-4 flex max-w-full gap-2 overflow-x-auto pb-1">
          {EXAMPLES.map((example) => (
            <button key={example} type="button" onClick={() => setInput(example)} className="h-10 shrink-0 rounded-full border border-ink-line bg-white px-3 text-xs text-ink-muted transition-colors hover:border-ink hover:text-ink sm:h-9">
              {example}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
