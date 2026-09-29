'use client';

import * as React from 'react';
import Link from 'next/link';
import { Copy, Check, Download, Eye, Image as ImageIcon, Loader2, ExternalLink, PencilLine, Sparkles, FileText } from 'lucide-react';
import { Button } from './ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { PLATFORMS } from '@/src/lib/platforms';
import type { Article, PlatformId } from '@/src/lib/types';
import { applyInlineStyles, copyRichToClipboard, markdownToInlineHtml, mdToPlainText, wechatBody } from '@/src/lib/export-html';
import { loadConfig } from '@/src/lib/config';
import { cn } from './ui/cn';
import { LanguageTabs } from './LanguageTabs';
import { extractContentTitle, joinBilingualContent, splitBilingualContent, type ContentLanguage } from '@/src/lib/bilingual';
import { copyContentImage, downloadContentImage, extractContentImageRefs, type ContentImageRef } from '@/src/lib/images';

export function PlatformTabs({
  article,
  generating,
  batchProgress,
  aiReady,
  onAdapt,
  onAdaptAll,
  onDraftChange,
  onExportZip,
  onError,
  language,
  onLanguageChange,
  showLanguageTabs,
}: {
  article: Article;
  generating: PlatformId | null;
  batchProgress: { done: number; total: number } | null;
  aiReady: boolean | null;
  onAdapt: (p: PlatformId) => Promise<void>;
  onAdaptAll: () => Promise<void>;
  onDraftChange: (p: PlatformId, text: string) => void;
  onExportZip: () => Promise<void>;
  onError?: (message: string) => void;
  language: ContentLanguage;
  onLanguageChange: (language: ContentLanguage) => void;
  showLanguageTabs: boolean;
}) {
  const available = article.brief.platforms as PlatformId[];
  const [tab, setTab] = React.useState<PlatformId>(available[0] ?? 'wechat');
  const [copied, setCopied] = React.useState<PlatformId | null>(null);
  const images = React.useMemo(() => extractContentImageRefs(article.content), [article.content]);

  // 当可用平台集合变化导致当前 Tab 失效时，回退到第一个平台
  React.useEffect(() => {
    if (!available.includes(tab)) setTab(available[0] ?? 'wechat');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article.brief.platforms.join(',')]);

  const readyCount = available.filter((platform) => {
    const parts = splitBilingualContent(article.platformDrafts[platform] ?? '');
    return Boolean((language === 'zh' ? parts.zh : parts.en).trim());
  }).length;
  const remainingCount = available.length - readyCount;

  const onCopy = async (platform: PlatformId, text: string) => {
    const platformSpec = PLATFORMS[platform];
    let richHtml = '';
    let plainText = replaceImageMarkersForText(text, images);
    if (platform === 'wechat') {
      const config = loadConfig();
      const configuredEyebrow = article.brief.materialType === 'news' ? config.newsEyebrow : config.wechatEyebrow;
      richHtml = placeImagesInHtml(wechatBody(text, {
        eyebrow: language === 'en' && containsCjk(configuredEyebrow) ? undefined : configuredEyebrow,
        author: language === 'en' && containsCjk(config.authorSignature) ? undefined : config.authorSignature,
        title: extractContentTitle(text) ?? (language === 'zh' ? article.title : 'English Version'),
        templateId: article.templateId ?? config.defaultTemplateId,
      }), images);
      plainText = mdToPlainText(richHtml);
    } else if (platformSpec.copyMode === 'rich') {
      richHtml = placeImagesInHtml(applyInlineStyles(markdownToInlineHtml(text)), images);
      plainText = mdToPlainText(richHtml);
    }
    const ok = await copyRichToClipboard(richHtml, plainText);
    if (ok) {
      setCopied(platform);
      setTimeout(() => setCopied(null), 1800);
    } else {
      onError?.('复制失败。请允许浏览器访问剪贴板；也可以先导出 ZIP，再从离线发布页复制。');
    }
  };

  if (!available.length) {
    return (
      <div className="h-full min-h-[320px] flex flex-col items-center justify-center bg-white px-6 text-center">
        <div className="size-11 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-700"><FileText size={18}/></div>
        <div className="mt-3 text-sm font-semibold">还没选择发布平台</div>
        <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-ink-muted">回到“素材”，在高级选项里勾选需要的平台；生成母稿后会自动同步生成。</p>
        <Button variant="outline" size="sm" onClick={onExportZip} className="mt-4">仅导出母稿 ZIP</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      <Tabs value={tab} onValueChange={(v) => setTab(v as PlatformId)} className="flex-1 min-h-0">
        <div className="px-4 pt-2 flex flex-col sm:flex-row sm:items-center gap-x-3 border-b border-ink-line overflow-hidden shrink-0">
          <TabsList className="w-full shrink-0 sm:w-auto sm:min-w-0 sm:flex-1 sm:shrink flex-nowrap overflow-x-auto border-b-0">
            {available.map((p) => (
              <TabsTrigger key={p} value={p}>
                {PLATFORMS[p].label}
                {(() => {
                  const parts = splitBilingualContent(article.platformDrafts[p] ?? '');
                  const ready = language === 'zh' ? parts.zh : parts.en;
                  return ready.trim() ? <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-indigo-500"/> : null;
                })()}
              </TabsTrigger>
            ))}
          </TabsList>
          <span className="w-full sm:w-auto pb-2 text-right text-[11px] text-ink-muted shrink-0 tabular-nums">{language === 'zh' ? '中文' : 'English'} {readyCount}/{available.length} 已完成</span>
        </div>

        {available.map((p) => (
          <TabsContent key={p} value={p} className="px-4 pb-4 flex-1 min-h-0">
            <PlatformBody
              platform={p}
              draft={article.platformDrafts[p] ?? ''}
              generating={generating === p}
              busy={Boolean(generating || batchProgress)}
              aiReady={aiReady}
              onAdapt={() => onAdapt(p)}
              onChange={(t) => onDraftChange(p, t)}
              onCopy={(text) => onCopy(p, text)}
              copied={copied === p}
              language={language}
              onLanguageChange={onLanguageChange}
              showLanguageTabs={showLanguageTabs}
              images={images}
              onError={onError}
            />
          </TabsContent>
        ))}
      </Tabs>
      <div className="border-t border-ink-line p-2 flex items-center justify-end gap-2 bg-white shrink-0 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {aiReady === false && <Link href="/settings" className="mr-auto text-[11px] text-ink-muted underline underline-offset-2">连接 AI 后自动生成</Link>}
        <Button size="sm" onClick={onAdaptAll} disabled={Boolean(generating || batchProgress) || !article.content.trim() || aiReady === false}>
          {batchProgress ? <Loader2 size={13} className="animate-spin"/> : <Sparkles size={13}/>}
          {batchProgress
            ? `生成中 ${batchProgress.done}/${batchProgress.total}`
            : remainingCount === 0
              ? '重新生成全部'
              : readyCount > 0
                ? `生成其余 ${remainingCount} 个平台`
                : '生成全部'}
        </Button>
        <Button variant="outline" size="sm" onClick={onExportZip}>
          导出 ZIP
        </Button>
      </div>
    </div>
  );
}

function containsCjk(value: string | undefined) {
  return Boolean(value && /[\u3400-\u9fff]/.test(value));
}

function PlatformBody({
  platform,
  draft,
  generating,
  busy,
  aiReady,
  onAdapt,
  onChange,
  onCopy,
  copied,
  language,
  onLanguageChange,
  showLanguageTabs,
  images,
  onError,
}: {
  platform: PlatformId;
  draft: string;
  generating: boolean;
  busy: boolean;
  aiReady: boolean | null;
  onAdapt: () => void;
  onChange: (t: string) => void;
  onCopy: (text: string) => void;
  copied: boolean;
  language: ContentLanguage;
  onLanguageChange: (language: ContentLanguage) => void;
  showLanguageTabs: boolean;
  images: ContentImageRef[];
  onError?: (message: string) => void;
}) {
  const spec = PLATFORMS[platform];
  const [copiedImage, setCopiedImage] = React.useState<number | null>(null);
  const [viewMode, setViewMode] = React.useState<'preview' | 'edit'>('preview');
  if (!draft) {
    return (
      <div className="h-full min-h-[280px] flex flex-col items-center justify-center text-center px-5">
        <div className="size-11 rounded-xl bg-ink-panel flex items-center justify-center text-ink-muted mb-3">
          {generating ? <Loader2 size={18} className="animate-spin"/> : <FileText size={18}/>}
        </div>
        <div className="text-sm font-semibold">{generating ? `正在生成${spec.label}文案` : `还没有${spec.label}文案`}</div>
        <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-ink-muted">
          {generating ? '生成完成后会直接出现在这里。' : `根据母稿生成符合${spec.label}阅读习惯的版本，再人工检查和复制。`}
        </p>
        {!generating && (
          <Button className="mt-4" onClick={onAdapt} disabled={busy || aiReady === false} size="md">
            <Sparkles size={13}/> {aiReady === false ? '连接 AI 后生成' : `生成${spec.label}文案`}
          </Button>
        )}
        {spec.officialUrl && (
          <a href={spec.officialUrl} target="_blank" rel="noreferrer" className="mt-3 text-[11px] text-ink-muted hover:text-ink inline-flex items-center gap-1">
            官方发布入口 <ExternalLink size={11}/>
          </a>
        )}
      </div>
    );
  }
  const parts = splitBilingualContent(draft);
  const selectedDraft = language === 'zh' ? parts.zh : parts.en;
  const onSelectedChange = (next: string) => {
    const zh = language === 'zh' ? next : parts.zh;
    const en = language === 'en' ? next : parts.en;
    onChange(joinBilingualContent(zh, en, parts.separator ?? '## English Version'));
  };
  const renderedPreview = applyInlineStyles(markdownToInlineHtml(selectedDraft));
  const previewHtml = sanitizePlatformPreview(placeImagesInHtml(renderedPreview, images));
  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-3 pt-2 pr-1">
      <div className="text-xs text-ink-muted flex items-center gap-2 flex-wrap">
        <span><span className="font-medium text-ink-soft">{spec.label}</span> · {spec.shape}{spec.maxChars ? ` · 建议 ≤${spec.maxChars} 字` : ''}</span>
        {spec.officialUrl && (
          <a href={spec.officialUrl} target="_blank" rel="noreferrer" className="ml-auto hover:text-ink inline-flex items-center gap-1 shrink-0">
            发布入口 <ExternalLink size={11}/>
          </a>
        )}
      </div>
      {showLanguageTabs && (
        <LanguageTabs value={language} onChange={onLanguageChange} hasEnglish={parts.hasEnglish} compact/>
      )}
      <div className="flex items-center gap-2">
        <div role="tablist" aria-label={`${spec.label}文案视图`} className="inline-flex rounded-md border border-ink-line bg-ink-panel/60 p-0.5"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return;
            const buttons = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button[role="tab"]'));
            if (!buttons.length) return;
            const last = buttons.length - 1;
            const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
            let next = -1;
            if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = last;
            else if (event.key === 'ArrowRight') next = current === -1 ? 0 : current === last ? 0 : current + 1;
            else next = current === -1 ? last : current === 0 ? last : current - 1;
            event.preventDefault();
            buttons[next].focus();
          }}>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'preview'}
            tabIndex={viewMode === 'preview' ? 0 : -1}
            onClick={() => setViewMode('preview')}
            className={`h-10 rounded px-3 text-xs inline-flex items-center gap-1.5 sm:h-7 ${viewMode === 'preview' ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}`}
          ><Eye size={12}/>成稿预览</button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'edit'}
            tabIndex={viewMode === 'edit' ? 0 : -1}
            onClick={() => setViewMode('edit')}
            className={`h-10 rounded px-3 text-xs inline-flex items-center gap-1.5 sm:h-7 ${viewMode === 'edit' ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}`}
          ><PencilLine size={12}/>编辑文案</button>
        </div>
        <span className="ml-auto text-[10px] text-ink-muted">{copyModeLabel(spec.copyMode)}</span>
      </div>
      {viewMode === 'edit' ? (
        <textarea
          aria-label={`${spec.label}${language === 'zh' ? '中文' : 'English'}文案`}
          value={selectedDraft}
          onChange={(e) => onSelectedChange(e.target.value)}
          className="w-full flex-1 min-h-[180px] resize-none rounded-md border border-ink-line bg-white px-3 py-2 text-base leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink sm:text-sm"
          placeholder={language === 'zh' ? `${spec.label} 的中文改写稿会在此显示。` : `${spec.label} 的英文改写稿会在此显示。`}
        />
      ) : (
        <section
          aria-label={`${spec.label}${language === 'zh' ? '中文' : 'English'}成稿预览`}
          className="w-full flex-1 min-h-[180px] overflow-y-auto rounded-md border border-ink-line bg-white px-4 py-4 text-ink"
        >
          <div className="platform-rendered" dangerouslySetInnerHTML={{ __html: previewHtml }}/>
        </section>
      )}
      {images.length > 0 && (
        <section aria-label={`${spec.label}发布配图`} className="rounded-lg border border-ink-line bg-ink-panel/35 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs">
            <ImageIcon size={13} className="text-ink-muted"/>
            <span className="font-medium text-ink-soft">发布配图 · {images.length}</span>
            <span className="ml-auto text-[11px] text-ink-muted">{spec.copyMode === 'rich' ? '复制图文时自动带入' : '发布时单独上传'}</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {images.map((image, index) => (
              <article key={`${image.src.slice(0, 48)}-${index}`} className="w-[150px] shrink-0 overflow-hidden rounded-md border border-ink-line bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.src} alt={image.alt} className="h-24 w-full bg-ink-panel object-cover"/>
                <div className="p-2">
                  <p className="truncate text-[10px] text-ink-muted" title={image.caption || image.alt}>{image.caption || image.alt}</p>
                  <div className="mt-2 flex gap-1">
                    <button
                      type="button"
                      aria-label={`复制图片 ${index + 1}`}
                      onClick={async () => {
                        const ok = await copyContentImage(image.src);
                        if (!ok) return onError?.('图片复制失败，请允许浏览器访问剪贴板，或使用下载图片。');
                        setCopiedImage(index);
                        setTimeout(() => setCopiedImage(null), 1800);
                      }}
                      className="inline-flex h-10 min-w-10 flex-1 items-center justify-center gap-1 rounded border border-ink-line text-[11px] text-ink-soft hover:bg-ink-panel sm:h-8 sm:min-w-0"
                    >
                      {copiedImage === index ? <Check size={11}/> : <Copy size={11}/>}
                      {copiedImage === index ? '已复制' : '复制'}
                    </button>
                    <button
                      type="button"
                      aria-label={`下载图片 ${index + 1}`}
                      onClick={async () => {
                        const ok = await downloadContentImage(image.src, `omniwriter-${platform}-${String(index + 1).padStart(2, '0')}.png`);
                        if (!ok) onError?.('图片下载失败，请稍后重试。');
                      }}
                      className="inline-flex h-10 w-10 items-center justify-center rounded border border-ink-line text-ink-muted hover:bg-ink-panel sm:h-8 sm:w-8"
                    >
                      <Download size={12}/>
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="flex items-center gap-2">
        <Button onClick={onAdapt} disabled={busy || aiReady === false} size="sm">
          {generating ? <Loader2 size={13} className="animate-spin mr-1"/> : null}
          {generating ? '适配中…' : aiReady === false ? '连接 AI 后适配' : selectedDraft ? '重新适配' : language === 'en' ? '生成 English' : '生成中文稿'}
        </Button>
        <Button variant="outline" size="sm" onClick={() => onCopy(selectedDraft)} disabled={!selectedDraft}>
          {copied ? <Check size={13} className="mr-1"/> : <Copy size={13} className="mr-1"/>}
          {copied ? '已复制' : platform === 'wechat' ? '复制排版正文' : spec.copyMode === 'rich' ? '复制图文' : '复制文案'}
        </Button>
        <span
          className={cn(
            'text-xs ml-auto tabular-nums',
            spec.maxChars && selectedDraft.length > spec.maxChars ? 'text-red-600 font-medium' : 'text-ink-muted',
          )}
        >
          {selectedDraft.length}{spec.maxChars ? ` / ${spec.maxChars} 字` : ' 字'}
        </span>
      </div>
    </div>
  );
}

function copyModeLabel(mode: 'rich' | 'markdown' | 'plain') {
  if (mode === 'rich') return '富文本复制';
  if (mode === 'markdown') return 'Markdown 复制';
  return '纯文本复制';
}

function sanitizePlatformPreview(html: string) {
  return html
    .replace(/<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed)\b[^>]*\/?>/gi, '')
    .replace(/\s(?:on\w+|srcdoc)=(['"])[\s\S]*?\1/gi, '')
    .replace(/\s(href|src)=(['"])\s*javascript:[\s\S]*?\2/gi, ' $1="#"');
}

function placeImagesInHtml(html: string, images: ContentImageRef[]) {
  if (!images.length) return html;
  const used = new Set<number>();
  let placed = html.replace(/(?:<p\b[^>]*>)?\s*\[\[图片\s*(\d+)\]\]\s*(?:<br\s*\/?>\s*\[配图说明：[^\]]*\])?\s*(?:<\/p>)?(?:\s*<p\b[^>]*>\s*\[配图说明：[^\]]*\]\s*<\/p>)?/gi, (_match, rawIndex: string) => {
    const index = Number(rawIndex) - 1;
    const image = images[index];
    if (!image || used.has(index)) return '';
    used.add(index);
    return imageFigure(image);
  });

  // 兼容旧平台稿：旧版本只留下“配图说明”，优先在原提示位置恢复图片。
  images.forEach((image, index) => {
    if (used.has(index) || placed.includes(image.src)) return;
    const descriptions = [image.caption, image.alt].filter(Boolean);
    for (const description of descriptions) {
      const escaped = escapeRegExp(description);
      const pattern = new RegExp(`(?:<p\\b[^>]*>)?\\s*\\[配图说明：[^\\]]*${escaped.slice(0, 80)}[^\\]]*\\]\\s*(?:<\\/p>)?`, 'i');
      if (!pattern.test(placed)) continue;
      placed = placed.replace(pattern, imageFigure(image));
      used.add(index);
      break;
    }
  });

  const missing = images.map((image, index) => ({ image, index })).filter(({ image, index }) => !used.has(index) && !placed.includes(image.src));
  if (!missing.length) return placed;

  // 没有旧位置提示的历史稿按正文段落均匀分布，避免再次全部堆到文末。
  const closingSection = /<\/section>\s*$/i.test(placed);
  let body = closingSection ? placed.replace(/<\/section>\s*$/i, '') : placed;
  const paragraphMatches = Array.from(body.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi));
  if (!paragraphMatches.length) {
    body += missing.map(({ image }) => imageFigure(image)).join('');
  } else {
    const insertions = missing.map(({ image }, order) => {
      const paragraphIndex = Math.min(paragraphMatches.length - 1, Math.max(0, Math.floor(((order + 1) * paragraphMatches.length) / (missing.length + 1))));
      const at = (paragraphMatches[paragraphIndex].index ?? 0) + paragraphMatches[paragraphIndex][0].length;
      return { at, figure: imageFigure(image) };
    }).sort((a, b) => b.at - a.at);
    insertions.forEach(({ at, figure }) => { body = `${body.slice(0, at)}${figure}${body.slice(at)}`; });
  }
  return closingSection ? `${body}</section>` : body;
}

function imageFigure(image: ContentImageRef) {
  const caption = image.caption || image.alt;
  return applyInlineStyles(`<figure data-omniwriter-inline-image="true"><img src="${escapeAttribute(image.src)}" alt="${escapeAttribute(image.alt)}"/><figcaption>${escapeText(caption)}</figcaption></figure>`);
}

function replaceImageMarkersForText(text: string, images: ContentImageRef[]) {
  let output = text.replace(/\[\[图片\s*(\d+)\]\](?:\s*\n+\s*\[配图说明：[^\]]*\])?/gi, (_match, rawIndex: string) => {
    const index = Number(rawIndex) - 1;
    const image = images[index];
    return image ? `【此处上传图片 ${index + 1}｜${image.caption || image.alt}】` : '';
  });
  images.forEach((image, index) => {
    if (output.includes(`【此处上传图片 ${index + 1}`)) return;
    output = `${output.trimEnd()}\n\n【此处上传图片 ${index + 1}｜${image.caption || image.alt}】`;
  });
  return output;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/'/g, '&#39;');
}

function escapeText(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
