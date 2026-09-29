'use client';

import * as React from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  ImageIcon,
  Loader2,
  Search,
  ShieldCheck,
  Twitter,
  Wand2,
} from 'lucide-react';
import {
  buildTwitterComposeText,
  buildTwitterIntentUrl,
  findGithubScreenshots,
  rewriteUrl,
  verifyRewriteDraft,
  type RewriteClientResponse,
} from '@/src/lib/rewrite-client';
import { loadAiConfig } from '@/src/lib/ai-config';
import type { PlatformId } from '@/src/lib/types';
import { useAiStatus } from '@/src/lib/use-ai-status';
import { cn } from './ui/cn';

const TARGETS: Array<{ id: PlatformId; label: string; helper: string; emoji: string }> = [
  { id: 'x', label: 'X / Twitter', helper: '≤240 字 + 原图 + 一键发推', emoji: '𝕏' },
  { id: 'wechat', label: '公众号', helper: '完整长文 + 图注', emoji: '📰' },
  { id: 'xiaohongshu', label: '小红书', helper: '口语化笔记 + 标签', emoji: '✨' },
  { id: 'zhihu', label: '知乎', helper: '回答式长文', emoji: '💭' },
];

const VOICES: Array<{ id: 'news' | 'sharp' | 'casual' | 'explainer'; label: string; helper: string }> = [
  { id: 'news', label: '克制新闻', helper: '事实+判断，不夸张' },
  { id: 'sharp', label: '观点鲜明', helper: '敢下判断，长短句交替' },
  { id: 'explainer', label: '讲机制', helper: '把读者带进门' },
  { id: 'casual', label: '日常口语', helper: '像跟朋友说话' },
];

export function RewriterLauncher({ compact = false }: { compact?: boolean }) {
  const [url, setUrl] = React.useState('');
  const [target, setTarget] = React.useState<PlatformId>('x');
  const [voice, setVoice] = React.useState<'news' | 'sharp' | 'casual' | 'explainer'>('sharp');
  const [intent, setIntent] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [response, setResponse] = React.useState<RewriteClientResponse | null>(null);
  const [verifying, setVerifying] = React.useState(false);
  const [githubImages, setGithubImages] = React.useState<Array<{ url: string; alt: string; source: string }>>([]);
  const [githubSearching, setGithubSearching] = React.useState(false);
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle');
  const { aiReady } = useAiStatus();
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  const submit = async () => {
    if (!url.trim() || loading) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setResponse(null);
    setGithubImages([]);
    setCopyState('idle');
    try {
      const ai = loadAiConfig();
      const data = await rewriteUrl({
        url: url.trim(),
        target,
        voice,
        intent: intent.trim() || undefined,
        ai: ai.apiKey.trim() ? ai : undefined,
        signal: controller.signal,
      });
      setResponse(data);
    } catch (reason) {
      if ((reason as Error).name === 'AbortError') return;
      setError((reason as Error).message || '洗稿失败');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!response?.result.body || verifying) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setVerifying(true);
    setError(null);
    try {
      const ai = loadAiConfig();
      const verdict = await verifyRewriteDraft({
        draft: response.result.body,
        platform: response.result.target,
        sourceSummary: response.result.source.summary,
        intent: intent.trim() || undefined,
        ai: ai.apiKey.trim() ? ai : undefined,
      });
      setResponse((prev) => prev ? { result: prev.result, verdict } : prev);
    } catch (reason) {
      if ((reason as Error).name === 'AbortError') return;
      setError((reason as Error).message || '交叉验证失败');
    } finally {
      setVerifying(false);
    }
  };

  const handleGithubSearch = async () => {
    if (!url.trim() || githubSearching) return;
    setGithubSearching(true);
    setError(null);
    try {
      const query = response?.result.source.title || url.trim();
      const images = await findGithubScreenshots(query, 6);
      setGithubImages(images);
      if (!images.length) setError('没找到匹配的 GitHub 截图；试试换个关键词');
    } catch (reason) {
      setError((reason as Error).message || '搜索失败');
    } finally {
      setGithubSearching(false);
    }
  };

  const handleCopy = async () => {
    if (!response?.result.body) return;
    const text = buildTwitterComposeText(response.result.body, response.result.hashtags);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1_800);
    } catch {
      setCopyState('failed');
      setTimeout(() => setCopyState('idle'), 1_800);
    }
  };

  const composeText = response ? buildTwitterComposeText(response.result.body, response.result.hashtags) : '';
  const twitterIntent = response ? buildTwitterIntentUrl(composeText) : '';

  return (
    <div className={cn('w-full', !compact && 'mx-auto max-w-5xl')}>
      <div className={cn(
        'rounded-3xl border border-white/90 bg-white/90 shadow-[0_24px_80px_rgba(79,70,229,0.13)] backdrop-blur-xl',
        compact ? 'p-5' : 'p-6 sm:p-8',
      )}>
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 sm:text-xl">洗稿 · 把别人的内容变成可发布的版本</h2>
            <p className="mt-1 text-xs text-ink-muted sm:text-sm">
              贴一个推特 / 新闻 / GitHub 链接 → 自动抽取原文与媒体 → 改写成适配目标平台的新稿（保留原图）→ 一键复制到推特。
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50/60 px-3 py-1 text-[11px] font-medium text-indigo-700">
            <span className={cn('size-1.5 rounded-full', aiReady ? 'bg-emerald-500' : 'bg-amber-500')} />
            {aiReady ? 'AI 已连接，可直接生成' : 'AI 未配置，生成前请先到设置填密钥'}
          </div>
        </header>

        <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-stretch">
          <input
            id="rewriter-url"
            type="url"
            inputMode="url"
            value={url}
            onChange={(event) => { setUrl(event.target.value); setError(null); }}
            onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }}
            placeholder="https://x.com/... / https://github.com/owner/repo / 新闻链接"
            aria-label="待改写的链接（X、新闻或 GitHub）"
            className="w-full min-h-10 rounded-xl border border-ink-line/80 bg-white px-4 py-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!url.trim() || loading}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-slate-900 to-indigo-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:pointer-events-none disabled:opacity-40"
          >
            {loading ? <Loader2 size={16} className="animate-spin"/> : <Wand2 size={16}/>}
            {loading ? '正在改写…' : '开始洗稿'}
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-muted">目标平台</p>
            <div className="flex flex-wrap gap-1.5">
              {TARGETS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setTarget(option.id)}
                  className={cn(
                    'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 sm:min-h-0 sm:py-1.5 text-xs transition-colors',
                    target === option.id
                      ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                      : 'border-ink-line/70 bg-white text-ink-soft hover:border-indigo-200 hover:text-indigo-700',
                  )}
                  title={option.helper}
                  aria-label={`目标平台：${option.label}（${option.helper}）`}
                  aria-pressed={target === option.id}
                >
                  <span>{option.emoji}</span>{option.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-muted">语气</p>
            <div className="flex flex-wrap gap-1.5">
              {VOICES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setVoice(option.id)}
                  className={cn(
                    'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 sm:min-h-0 sm:py-1.5 text-xs transition-colors',
                    voice === option.id
                      ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                      : 'border-ink-line/70 bg-white text-ink-soft hover:border-indigo-200 hover:text-indigo-700',
                  )}
                  title={option.helper}
                  aria-label={`语气：${option.label}（${option.helper}）`}
                  aria-pressed={voice === option.id}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3">
          <label htmlFor="rewriter-intent" className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-muted">额外诉求（可选）</label>
          <input
            id="rewriter-intent"
            value={intent}
            onChange={(event) => setIntent(event.target.value)}
            placeholder="例如：突出公司股价、保留原始链接、加一句我个人评论"
            aria-label="额外诉求（可选）"
            className="w-full min-h-10 rounded-xl border border-ink-line/80 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      </div>

      {response && (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <OriginalCard result={response.result} />
          <RewriteCard
            result={response.result}
            verdict={response.verdict ?? null}
            verifying={verifying}
            onVerify={handleVerify}
            onCopy={handleCopy}
            onTwitterIntent={twitterIntent}
            copyState={copyState}
          />
        </div>
      )}

      {response && (
        <div className="mt-5 rounded-3xl border border-white/90 bg-white/90 p-6 shadow-[0_24px_80px_rgba(79,70,229,0.10)] backdrop-blur-xl">
          <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900">顺手找点 GitHub 截图当配图</h3>
              <p className="mt-1 text-xs text-ink-muted">根据原文标题 / 仓库名搜 GitHub 上的截图、Avatar、仓库列表，结果可直接插入到 X 帖。</p>
            </div>
            <button
              type="button"
              onClick={() => void handleGithubSearch()}
              disabled={githubSearching}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-ink-line bg-white px-4 sm:min-h-0 sm:py-2 text-sm font-medium text-ink hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50"
            >
              {githubSearching ? <Loader2 size={14} className="animate-spin"/> : <Search size={14}/>}
              {githubSearching ? '搜索中…' : '搜 GitHub 截图'}
            </button>
          </header>
          {githubImages.length > 0 && (
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {githubImages.map((image) => (
                <li key={image.url} className="overflow-hidden rounded-xl border border-ink-line/60 bg-slate-50">
                  <img src={image.url} alt={image.alt} loading="lazy" className="aspect-video w-full object-cover"/>
                  <div className="p-2">
                    <p className="truncate text-[11px] text-ink-soft">{image.alt}</p>
                    <p className="truncate text-[10px] text-ink-muted">{image.source}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function OriginalCard({ result }: { result: RewriteClientResponse['result'] }) {
  const source = result.source;
  const isTweet = source.kind === 'tweet';
  const isGithub = source.kind === 'github';

  return (
    <article className="overflow-hidden rounded-3xl border border-white/90 bg-white/90 shadow-[0_24px_80px_rgba(79,70,229,0.10)] backdrop-blur-xl">
      <header className="flex items-center justify-between gap-3 border-b border-ink-line/60 px-5 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-muted">原文</p>
          <h3 className="mt-0.5 truncate text-sm font-semibold text-ink">
            {isTweet ? `@${source.author || source.title}` : source.title || source.url}
          </h3>
        </div>
        <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-indigo-700">
          <ExternalLink size={11}/>打开
        </a>
      </header>
      <div className="px-5 py-4">
        <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-soft">{source.summary}</pre>
      </div>
      {source.images.length > 0 && (
        <div className="border-t border-ink-line/60 px-5 py-3">
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-ink-muted">
            <ImageIcon size={11}/>原图（{source.images.length}）会随新稿保留
          </p>
          <ul className="grid grid-cols-2 gap-2">
            {source.images.slice(0, 4).map((image) => (
              <li key={image.url} className="overflow-hidden rounded-lg border border-ink-line/60">
                <img src={image.url} alt={image.alt} loading="lazy" className="aspect-video w-full object-cover" referrerPolicy="no-referrer"/>
              </li>
            ))}
          </ul>
        </div>
      )}
      {isGithub && source.summary && (
        <div className="border-t border-ink-line/60 bg-slate-50 px-5 py-3 text-[11px] text-ink-muted">
          已读取 README 与仓库元数据；如需其他文件请直接打开原仓库。
        </div>
      )}
    </article>
  );
}

interface RewriteCardProps {
  result: RewriteClientResponse['result'];
  verdict: RewriteClientResponse['verdict'];
  verifying: boolean;
  onVerify: () => void;
  onCopy: () => void;
  onTwitterIntent: string;
  copyState: 'idle' | 'copied' | 'failed';
}

function RewriteCard({ result, verdict, verifying, onVerify, onCopy, onTwitterIntent, copyState }: RewriteCardProps) {
  const isX = result.target === 'x';
  const composeText = buildTwitterComposeText(result.body, result.hashtags);
  const charCount = Array.from(composeText).length;

  return (
    <article className="overflow-hidden rounded-3xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-sky-50 shadow-[0_24px_80px_rgba(79,70,229,0.12)] backdrop-blur-xl">
      <header className="flex items-center justify-between gap-3 border-b border-indigo-100 px-5 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-600">新稿 · {result.target}</p>
          <h3 className="mt-0.5 truncate text-sm font-semibold text-ink">已按平台规则改写</h3>
        </div>
        <button
          type="button"
          onClick={onVerify}
          disabled={verifying}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-indigo-200 bg-white px-3 sm:min-h-0 sm:py-1.5 text-[11px] font-medium text-indigo-700 hover:border-indigo-400 disabled:opacity-50"
        >
          {verifying ? <Loader2 size={11} className="animate-spin"/> : <ShieldCheck size={11}/>}
          {verifying ? '交叉验证中…' : '交叉验证'}
        </button>
      </header>

      <div className="space-y-3 px-5 py-4">
        <div className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-sm">
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-900">{result.body}</p>
          {result.hashtags.length > 0 && (
            <p className="mt-3 text-xs font-medium text-indigo-600">{result.hashtags.join(' ')}</p>
          )}
        </div>

        {isX && (
          <div className="rounded-2xl border border-white/80 bg-white/70 p-4 text-ink-soft">
            <div className="flex items-center gap-2 text-[11px] text-ink-muted">
              <Twitter size={11}/> 推特预览 · {charCount} 字
              <span className={cn('ml-auto inline-flex items-center gap-1', charCount > 240 ? 'text-red-600' : 'text-emerald-600')}>
                {charCount > 240 ? '超出 240 字，请裁剪' : '在字数限制内'}
              </span>
            </div>
            <pre className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">{composeText}</pre>
          </div>
        )}

        {result.imagePlan.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-ink-muted">
              <ImageIcon size={11}/>推荐插图位置
            </p>
            <ul className="space-y-1.5">
              {result.imagePlan.map((plan, index) => (
                <li key={`${plan.url}-${index}`} className="flex items-center gap-3 rounded-lg border border-ink-line/60 bg-white/80 p-2">
                  <img src={plan.url} alt={plan.alt} loading="lazy" className="size-12 rounded object-cover" referrerPolicy="no-referrer"/>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] text-ink">{plan.alt}</p>
                    <p className="text-[10px] text-ink-muted">{plan.position === 'after' ? '放在正文后第一张' : '放在正文最前'} · {plan.url}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {verdict && (
          <div className={cn('rounded-2xl border p-3 text-xs', verdict.passed ? 'border-emerald-200 bg-emerald-50/80 text-emerald-700' : 'border-amber-200 bg-amber-50/80 text-amber-700')}>
            <p className="flex items-center gap-1.5 font-semibold">
              <ShieldCheck size={12}/>交叉验证 · {verdict.model} · {verdict.passed ? '通过' : '需要修改'} · {verdict.score}/100
            </p>
            {verdict.issues.length > 0 && (
              <ul className="mt-1.5 list-disc pl-4">
                {verdict.issues.map((issue, index) => (
                  <li key={index}>{issue}</li>
                ))}
              </ul>
            )}
            {verdict.suggestions.length > 0 && (
              <p className="mt-2 font-medium">建议：</p>
            )}
            {verdict.suggestions.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {verdict.suggestions.map((suggestion, index) => (
                  <li key={index}>{suggestion}</li>
                ))}
              </ul>
            )}
            {verdict.fallback && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] font-medium">查看替代版本</summary>
                <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-white/70 p-2 text-[11px] text-ink">{verdict.fallback}</pre>
              </details>
            )}
          </div>
        )}

        {result.warnings.length > 0 && (
          <ul className="space-y-1 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 text-[11px] text-amber-700">
            {result.warnings.map((warning, index) => (
              <li key={index}>· {warning}</li>
            ))}
          </ul>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-indigo-100 bg-white/70 px-5 py-3">
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-slate-900 px-3 sm:min-h-0 sm:py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
        >
          {copyState === 'copied' ? <Check size={12}/> : <Copy size={12}/>}
          {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制新稿'}
        </button>
        {isX && onTwitterIntent && (
          <a
            href={onTwitterIntent}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-sky-300 bg-sky-50 px-3 sm:min-h-0 sm:py-1.5 text-xs font-semibold text-sky-700 hover:border-sky-400"
          >
            <Twitter size={12}/>打开 Twitter 发推页
            <ArrowRight size={11}/>
          </a>
        )}
        <span className="ml-auto text-[10px] text-ink-muted">via {result.via ?? 'unknown'}</span>
      </footer>
    </article>
  );
}