'use client';

import * as React from 'react';
import { Copy, Check, ChevronDown, Smartphone, Monitor, ImageDown, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { copyRichToClipboard, wechatBody, mdToPlainText } from '@/src/lib/export-html';
import { loadConfig } from '@/src/lib/config';
import type { MaterialType } from '@/src/lib/types';
import { toPng } from 'html-to-image';
import { LanguageTabs } from './LanguageTabs';
import type { ContentLanguage } from '@/src/lib/bilingual';
import { resolveWechatTemplate, WECHAT_TEMPLATES } from '@/src/lib/templates';
import { TemplateMiniature } from './TemplateMiniature';

export function PreviewPane({ markdown, materialType, title = 'article', templateId, language = 'zh', showLanguageTabs = false, hasEnglish = false, onLanguageChange, onTemplateChange, onError }: { markdown: string; materialType?: MaterialType; title?: string; templateId?: string; language?: ContentLanguage; showLanguageTabs?: boolean; hasEnglish?: boolean; onLanguageChange?: (language: ContentLanguage) => void; onTemplateChange?: (templateId: string) => void; onError?: (message: string) => void }) {
  const [copied, setCopied] = React.useState(false);
  const [width, setWidth] = React.useState<'mobile' | 'desktop'>('mobile');
  const [savingImage, setSavingImage] = React.useState(false);
  const previewRef = React.useRef<HTMLDivElement>(null);
  const template = resolveWechatTemplate(templateId);

  // 预览与「复制公众号正文」共用同一份：行内样式 + Eyebrow + 署名
  // loadConfig 是同步 localStorage 读，放在 memo 外保证设置页改完配置回来能刷新
  const cfg = loadConfig();
  const html = React.useMemo(() => {
    const configuredEyebrow = materialType === 'news' ? cfg.newsEyebrow : cfg.wechatEyebrow;
    const englishEyebrow = language === 'en' && containsCjk(configuredEyebrow) ? undefined : configuredEyebrow;
    const englishAuthor = language === 'en' && containsCjk(cfg.authorSignature) ? undefined : cfg.authorSignature;
    return wechatBody(markdown || '', {
      eyebrow: englishEyebrow,
      author: englishAuthor,
      title,
      templateId: template.id,
    });
  }, [markdown, materialType, language, title, template.id, cfg.newsEyebrow, cfg.wechatEyebrow, cfg.authorSignature]);

  const onCopy = async () => {
    const ok = await copyRichToClipboard(html, mdToPlainText(html));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else {
      onError?.('复制失败。请允许浏览器访问剪贴板；也可以导出 ZIP 后从离线发布页复制。');
    }
  };

  const onSaveImage = async () => {
    if (!previewRef.current || savingImage) return;
    setSavingImage(true);
    try {
      const url = await toPng(previewRef.current, {
        backgroundColor: '#ffffff',
        cacheBust: true,
        pixelRatio: 2,
        width: previewRef.current.scrollWidth,
        height: previewRef.current.scrollHeight,
        style: {
          margin: '0',
          marginLeft: '0',
          marginRight: '0',
          transform: 'none',
        },
      });
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${safeName(title)}-${language === 'zh' ? '中文' : 'English'}-预览.png`;
      anchor.click();
    } catch {
      onError?.('预览图生成失败，请检查文章中的外部图片后重试。');
    } finally {
      setSavingImage(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-ink-panel/40">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 min-h-12 py-2 border-b border-ink-line bg-white">
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-xs font-medium text-ink-soft shrink-0">公众号成品</div>
          {WECHAT_TEMPLATES.length > 1 && onTemplateChange ? (
            <TemplatePicker template={template} onChange={onTemplateChange}/>
          ) : (
            <span className="hidden sm:inline-flex items-center rounded-full bg-ink-panel px-2 py-1 text-[10px] text-ink-muted">{template.name}模板 · 已自动应用</span>
          )}
          {showLanguageTabs && onLanguageChange && (
            <LanguageTabs value={language} onChange={onLanguageChange} hasEnglish={hasEnglish} compact/>
          )}
        </div>
        <div className="flex items-center justify-end gap-1.5 overflow-x-auto">
          <SegBtn label="手机宽度" active={width === 'mobile'} onClick={() => setWidth('mobile')}><Smartphone size={13}/></SegBtn>
          <SegBtn label="桌面宽度" active={width === 'desktop'} onClick={() => setWidth('desktop')}><Monitor size={13}/></SegBtn>
          <Button size="sm" variant="outline" onClick={onSaveImage} disabled={!markdown.trim() || savingImage}>
            {savingImage ? <Loader2 size={13} className="animate-spin"/> : <ImageDown size={13}/>}
            {savingImage ? '生成中' : '保存截图'}
          </Button>
          <Button size="sm" variant={copied ? 'secondary' : 'primary'} onClick={onCopy}>
            {copied ? <Check size={13} className="mr-1"/> : <Copy size={13} className="mr-1"/>}
            {copied ? '已复制，去公众号粘贴' : language === 'zh' ? '复制公众号正文' : '复制 English 正文'}
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 bg-[#f5f5f7]">
        <div ref={previewRef} className={`mx-auto bg-white border border-ink-line overflow-hidden ${width === 'mobile' ? 'max-w-[390px]' : 'max-w-[680px]'}`}>
          <div className="wechat-rendered" dangerouslySetInnerHTML={{ __html: html || `<p style="color:#86868b">${language === 'zh' ? '中文稿还没有内容。' : '英文稿还没有内容；生成双语稿后会显示在这里。'}</p>` }} />
        </div>
      </div>
    </div>
  );
}

function TemplatePicker({ template, onChange }: { template: ReturnType<typeof resolveWechatTemplate>; onChange: (templateId: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="公众号排版模板"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="h-10 min-w-[104px] rounded-md border border-ink-line bg-white px-2.5 text-sm text-ink-soft inline-flex items-center justify-between gap-2 hover:border-ink-muted focus:outline-none focus:ring-2 focus:ring-ink sm:h-7 sm:text-[11px]"
      >
        <span className="inline-flex items-center gap-2">
          <span className="size-3 rounded-sm border border-black/10" style={{ backgroundColor: template.preview.ink }}/>
          <span>{template.name}</span>
        </span>
        <ChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'}/>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="选择公众号排版模板"
          className="absolute -left-[72px] top-[calc(100%+8px)] z-50 w-[calc(100vw-32px)] max-w-[350px] rounded-xl border border-ink-line bg-white p-2 shadow-[0_18px_50px_rgba(15,23,42,0.18)] sm:left-0 sm:w-[350px]"
        >
          <div className="mb-2 px-1.5 pt-1">
            <div className="text-xs font-semibold text-ink">选择排版模板</div>
            <div className="mt-0.5 text-[10px] text-ink-muted">预览、复制与 ZIP 导出同步切换</div>
          </div>
          <div className="grid grid-cols-2 gap-1.5 max-h-[390px] overflow-y-auto">
            {WECHAT_TEMPLATES.map((item) => {
              const selected = item.id === template.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  data-template-id={item.id}
                  aria-selected={selected}
                  onClick={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                  className={`rounded-lg border p-2 text-left transition-colors ${selected ? 'border-ink bg-ink-panel' : 'border-ink-line hover:border-ink-muted hover:bg-ink-panel/50'}`}
                >
                  <div className="flex justify-center overflow-hidden rounded bg-ink-panel/40 py-1.5">
                    <TemplateMiniature template={item} scale={0.36}/>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{item.name}</span>
                    {selected && <Check size={12} className="shrink-0"/>}
                  </div>
                  <p className="mt-0.5 truncate text-[10px] text-ink-muted">{item.tagline}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SegBtn({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={
        'h-10 w-10 shrink-0 inline-flex items-center justify-center rounded sm:h-7 sm:w-7 ' +
        (active ? 'bg-ink text-white' : 'text-ink-muted hover:bg-ink-panel')
      }
    >
      {children}
    </button>
  );
}

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 60) || 'article';
}

function containsCjk(value: string | undefined) {
  return Boolean(value && /[\u3400-\u9fff]/.test(value));
}
