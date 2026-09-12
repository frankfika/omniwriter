'use client';

import * as React from 'react';
import { ExternalLink, Image as ImageIcon, Loader2, Search, X } from 'lucide-react';
import { downscaleImage } from '@/src/lib/images';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from './ui/cn';

export interface ImageCandidate {
  id: string;
  title: string;
  thumbnailUrl: string;
  imageUrl: string;
  sourcePageUrl: string;
  sourceLabel: string;
  creator?: string;
  license?: string;
  origin: string;
}

interface ImageSearchResponse {
  images?: ImageCandidate[];
  results?: Array<ImageCandidate & { alt?: string }>;
  warnings?: string[];
}

// 传给编辑器的「光标处插图」载荷；编辑器不可用时面板降级为文末追加。
export interface CursorImageInsert {
  dataUrl: string;
  alt: string;
  caption: string;
  sourceUrl: string;
  sourceLabel: string;
  license: string;
  creator: string;
}

export interface ImageSearchPanelProps {
  sourceUrl?: string;
  initialQuery?: string;
  content: string;
  onChange: (content: string) => void;
  onClose: () => void;
  onInsertAtCursor?: (image: CursorImageInsert) => boolean;
  className?: string;
}

export function ImageSearchPanel({
  sourceUrl,
  initialQuery = '',
  content,
  onChange,
  onClose,
  onInsertAtCursor,
  className,
}: ImageSearchPanelProps) {
  const [query, setQuery] = React.useState(initialQuery);
  const [images, setImages] = React.useState<ImageCandidate[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [hasSearched, setHasSearched] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [insertingId, setInsertingId] = React.useState<string | null>(null);
  const searchAbort = React.useRef<AbortController | null>(null);

  const searchImages = React.useCallback(async (rawQuery: string) => {
    const nextQuery = rawQuery.trim();
    if (!nextQuery) {
      setImages([]);
      setHasSearched(false);
      setError('请输入图片关键词');
      return;
    }

    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    setSearching(true);
    setError(null);
    setWarning(null);

    try {
      const response = await fetch('/api/images/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: nextQuery,
          ...(sourceUrl ? { sourceUrl } : {}),
          limit: 6,
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error('图片搜索暂时不可用');
      const data = (await response.json()) as ImageSearchResponse;
      const candidates = Array.isArray(data.images) && data.images.length
        ? data.images
        : Array.isArray(data.results)
          ? data.results.map((item) => ({
            ...item,
            title: item.title || item.alt || '图片候选',
            origin: item.origin === 'source-page' ? 'source' : item.origin,
          }))
          : [];
      setImages(prioritizeOriginals(candidates).slice(0, 6));
      setHasSearched(true);
      setWarning(data.warnings?.find(Boolean) ?? null);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setImages([]);
      setHasSearched(true);
      setWarning(null);
      setError(reason instanceof Error ? reason.message : '图片搜索暂时不可用');
    } finally {
      if (searchAbort.current === controller) setSearching(false);
    }
  }, [sourceUrl]);

  React.useEffect(() => {
    setQuery(initialQuery);
    if (initialQuery.trim()) void searchImages(initialQuery);
    return () => searchAbort.current?.abort();
  }, [initialQuery, searchImages]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void searchImages(query);
  };

  const insertImage = async (candidate: ImageCandidate) => {
    if (insertingId) return;
    setInsertingId(candidate.id);
    setError(null);

    try {
      const response = await fetch('/api/images/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: candidate.imageUrl }),
      });
      if (!response.ok) throw new Error('图片下载失败，请换一张');

      const blob = await response.blob();
      if (blob.type && !blob.type.startsWith('image/')) {
        throw new Error('返回内容不是图片');
      }

      const dataUrl = await downscaleImage(blob);
      const figureNumber = (content.match(/<img(?:\s|>)/gi) ?? []).length + 1;
      const figure = buildFigure(figureNumber, dataUrl, candidate);
      // 优先插入当前光标处（作用于当前激活语言的编辑器）；不可用时降级为文末追加
      const insertedAtCursor = onInsertAtCursor?.({
        dataUrl,
        alt: figure.plainCaption,
        caption: figure.plainCaption,
        sourceUrl: safeHttpUrl(candidate.sourcePageUrl),
        sourceLabel: figure.sourceLabel,
        license: candidate.license?.trim() ?? '',
        creator: candidate.creator?.trim() ?? '',
      }) ?? false;
      if (!insertedAtCursor) {
        const separator = content.trim() ? '\n' : '';
        onChange(`${content}${separator}${figure.html}`);
      }
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图片插入失败，请重试');
    } finally {
      setInsertingId(null);
    }
  };

  return (
    <section className={cn('flex h-full min-h-0 w-full flex-col bg-white', className)} aria-label="联网配图">
      <header className="flex shrink-0 items-center gap-3 border-b border-ink-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight text-ink">联网配图</h2>
          <p className="mt-0.5 truncate text-[11px] text-ink-muted">优先展示原文图片，并保留来源与许可</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭配图面板"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-ink-panel hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <X size={16} />
        </button>
      </header>

      <form onSubmit={handleSubmit} className="flex shrink-0 gap-2 border-b border-ink-line/70 p-3 sm:p-4">
        <label className="sr-only" htmlFor="image-search-query">搜索图片</label>
        <Input
          aria-label="搜索配图"
          id="image-search-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="输入图片关键词"
          autoFocus
          className="h-10 min-w-0 flex-1 rounded-lg sm:h-9"
        />
        <Button type="submit" size="md" disabled={searching || !query.trim()} className="h-10 shrink-0 px-3 sm:h-9" aria-label="搜索图片">
          {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          <span className="hidden sm:inline">搜索</span>
        </Button>
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {error && (
          <div role="alert" className="mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {!error && warning && (
          <div role="status" className="mb-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            部分图片来源暂时不可用；已展示仍能读取的结果。{warning}
          </div>
        )}

        {searching && images.length === 0 ? (
          <PanelState icon={<Loader2 size={18} className="animate-spin" />} text="正在查找图片…" />
        ) : images.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {images.map((candidate) => {
              const isOriginal = isOriginalCandidate(candidate);
              const sourceHref = safeHttpUrl(candidate.sourcePageUrl);
              const isInserting = insertingId === candidate.id;

              return (
                <article key={`${candidate.id}-${candidate.imageUrl}`} className="overflow-hidden rounded-xl border border-ink-line bg-white shadow-sm transition hover:border-indigo-200 hover:shadow-md">
                  <div className="relative aspect-[16/10] overflow-hidden bg-ink-panel">
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[11px] text-ink-muted" aria-hidden="true">
                      <ImageIcon size={18}/>
                      <span>缩略图暂不可用</span>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={candidate.thumbnailUrl || candidate.imageUrl}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="relative h-full w-full bg-ink-panel object-cover"
                      onError={(event) => { event.currentTarget.style.display = 'none'; }}
                    />
                    {isOriginal && (
                      <span className="absolute left-2 top-2 rounded-full border border-white/70 bg-white/90 px-2 py-0.5 text-[10px] font-medium text-indigo-700 shadow-sm backdrop-blur">
                        原文
                      </span>
                    )}
                  </div>

                  <div className="space-y-2.5 p-3">
                    <h3 className="line-clamp-2 text-xs font-medium leading-5 text-ink">
                      {candidate.title || '未命名图片'}
                    </h3>
                    <div className="space-y-1 text-[11px] leading-4 text-ink-muted">
                      <div className="flex min-w-0 items-center gap-1">
                        <span className="shrink-0">来源</span>
                        {sourceHref ? (
                          <a
                            href={sourceHref}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-w-0 items-center gap-1 text-ink-soft hover:text-indigo-700"
                            title={candidate.sourceLabel}
                          >
                            <span className="truncate">{candidate.sourceLabel || sourceHost(sourceHref)}</span>
                            <ExternalLink size={10} className="shrink-0" />
                          </a>
                        ) : (
                          <span className="truncate text-ink-soft">{candidate.sourceLabel || '未标注'}</span>
                        )}
                      </div>
                      <p className="truncate" title={candidate.license || '许可未标注'}>
                        许可 <span className="text-ink-soft">{candidate.license || '未标注'}</span>
                        {candidate.creator ? ` · ${candidate.creator}` : ''}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-full"
                      disabled={Boolean(insertingId)}
                      onClick={() => void insertImage(candidate)}
                    >
                      {isInserting ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />}
                      {isInserting ? '正在插入' : '插入'}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : hasSearched ? (
          <PanelState icon={<ImageIcon size={18} />} text="没有找到可用图片。试试 2–4 个具体关键词，例如“AI 写作 工作台”" />
        ) : (
          <PanelState icon={<Search size={18} />} text="输入关键词，查找原文或可引用图片" />
        )}
      </div>
    </section>
  );
}

function PanelState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink-line bg-ink-panel/40 px-5 text-center text-xs text-ink-muted">
      <span className="text-ink-soft">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function prioritizeOriginals(images: ImageCandidate[]) {
  return images
    .map((image, index) => ({ image, index }))
    .sort((a, b) => Number(isOriginalCandidate(b.image)) - Number(isOriginalCandidate(a.image)) || a.index - b.index)
    .map(({ image }) => image);
}

function isOriginalCandidate(candidate: ImageCandidate) {
  const origin = candidate.origin.trim().toLowerCase();
  return origin === 'source' || origin === 'original' || origin === 'article';
}

function buildFigure(figureNumber: number, dataUrl: string, candidate: ImageCandidate) {
  const title = candidate.title.trim() || '文章配图';
  const sourceLabel = candidate.sourceLabel.trim() || sourceHost(candidate.sourcePageUrl) || '未标注';
  const sourceUrl = safeHttpUrl(candidate.sourcePageUrl);
  const source = sourceUrl
    ? `<a href="${escapeAttribute(sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(sourceLabel)}</a>`
    : escapeHtml(sourceLabel);
  const creator = candidate.creator?.trim() ? `；作者：${escapeHtml(candidate.creator.trim())}` : '';
  const license = candidate.license?.trim() ? `；许可：${escapeHtml(candidate.license.trim())}` : '';
  const plainCaption = `图 ${figureNumber}｜${title}。图片来源：${sourceLabel}${candidate.creator?.trim() ? `；作者：${candidate.creator.trim()}` : ''}${candidate.license?.trim() ? `；许可：${candidate.license.trim()}` : ''}`;
  const html = [
    '<figure>',
    `<img src="${escapeAttribute(dataUrl)}" alt="${escapeAttribute(plainCaption)}" data-source-url="${escapeAttribute(sourceUrl)}" data-source-label="${escapeAttribute(sourceLabel)}" data-image-license="${escapeAttribute(candidate.license?.trim() ?? '')}" data-creator="${escapeAttribute(candidate.creator?.trim() ?? '')}" />`,
    `<figcaption>图 ${figureNumber}｜${escapeHtml(title)}。图片来源：${source}${creator}${license}</figcaption>`,
    '</figure>',
  ].join('');
  return { html, plainCaption, sourceLabel };
}

function safeHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function sourceHost(value: string) {
  const safeUrl = safeHttpUrl(value);
  if (!safeUrl) return '';
  try {
    return new URL(safeUrl).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll('`', '&#96;');
}
