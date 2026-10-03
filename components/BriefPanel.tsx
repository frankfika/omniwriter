'use client';

import * as React from 'react';
import { Sparkles, Loader2, Link as LinkIcon, FileInput, ChevronDown } from 'lucide-react';
import { Button } from './ui/button';
import { Input, Textarea } from './ui/input';
import { Select } from './ui/select';
import { cn } from './ui/cn';
import { AiSetupGuide } from './AiSetupGuide';
import { useAiStatus } from '@/src/lib/use-ai-status';
import type { Brief, MaterialType, PlatformId, Voice } from '@/src/lib/types';
import { PLATFORM_ORDER, PLATFORMS } from '@/src/lib/platforms';
import { resolveWritingStyle, WRITING_STYLES } from '@/src/lib/styles';
import type { GenerationViewState } from '@/src/lib/generation-events';
import { composeFetchedMaterial, extractHttpUrls, fetchMaterialSources } from '@/src/lib/material-input';
import { GenerationProgress } from './GenerationProgress';

interface Props {
  brief: Brief;
  onChange: (brief: Brief) => void;
  onGenerate: () => Promise<void>;
  onImportMaterial: (material: string) => void;
  onError?: (message: string) => void;
  generating: boolean;
  generationProgress: GenerationViewState | null;
  onCancelGeneration: () => void;
}

const MATERIAL_OPTIONS: { value: MaterialType; label: string }[] = [
  { value: 'news', label: '新闻 / 事件 / 资讯' },
  { value: 'project-own', label: '自有 GitHub 项目' },
  { value: 'project-third', label: '第三方开源项目' },
  { value: 'topic', label: '观点 / 话题 / 随笔' },
  { value: 'copy', label: '已有文案（只排版）' },
];

export function BriefPanel({ brief, onChange, onGenerate, onImportMaterial, onError, generating, generationProgress, onCancelGeneration }: Props) {
  const { aiReady, refresh } = useAiStatus();
  const [showGuide, setShowGuide] = React.useState(false);
  const [fetching, setFetching] = React.useState(false);
  const advancedRef = React.useRef<HTMLDetailsElement>(null);
  const progressRef = React.useRef<HTMLDivElement>(null);

  const update = (patch: Partial<Brief>) => onChange({ ...brief, ...patch });
  const selectedStyle = resolveWritingStyle(brief.voice);
  const materialUrls = extractHttpUrls(brief.material);
  const canFetchUrls = materialUrls.length > 0 && !brief.material.includes('## 来源 1');

  const togglePlatform = (p: PlatformId) => {
    const set = new Set(brief.platforms);
    set.has(p) ? set.delete(p) : set.add(p);
    update({ platforms: Array.from(set) });
  };

  const onPickUrl = async () => {
    if (!canFetchUrls) return;
    setFetching(true);
    try {
      const sources = await fetchMaterialSources(materialUrls);
      update({ material: composeFetchedMaterial(brief.material, materialUrls, sources) });
    } catch (e) {
      (onError ?? ((m: string) => alert(m)))((e as Error).message || '抓取失败');
    } finally {
      setFetching(false);
    }
  };

  const handleGenerate = () => {
    if (aiReady === false) {
      setShowGuide(true);
      return;
    }
    if (advancedRef.current) advancedRef.current.open = false;
    void onGenerate();
  };

  React.useEffect(() => {
    if (!generating) return;
    const frame = window.requestAnimationFrame(() => progressRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    return () => window.cancelAnimationFrame(frame);
  }, [generating]);

  return (
    <div className="flex flex-col h-full overflow-y-auto p-5 gap-4 bg-white">
      <div>
        <h2 className="text-base font-semibold tracking-tightish">创作指令</h2>
        <p className="text-xs text-ink-muted mt-1">
          {aiReady === null ? '检测 AI 配置…' : aiReady ? 'AI 已配置。给素材 + 你的判断，剩下交给模型。' : '尚未配置 AI 密钥：打开「设置 → AI 连接」粘贴你的密钥。编辑器 / 预览 / 导出现在就能用。'}
        </p>
      </div>

      <Field
        label="素材"
        hint="支持正文、最多 8 个网页链接或 GitHub 仓库；链接可一键读取"
      >
        <div className="flex gap-1.5">
          <Textarea
            aria-label="素材"
            value={brief.material}
            onChange={(e) => update({ material: e.target.value })}
            rows={5}
            placeholder={brief.materialType === 'news' ? 'https://...' : '把你的主题、痛点、判断贴在这里…'}
            className="flex-1"
          />
          {canFetchUrls && (
            <Button variant="outline" size="md" onClick={onPickUrl} disabled={fetching} title={`读取 ${materialUrls.length} 个链接`}>
              {fetching ? <Loader2 size={14} className="animate-spin"/> : <LinkIcon size={14}/>}
            </Button>
          )}
        </div>
        <button
          className="mt-1.5 min-h-10 inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink sm:min-h-0"
          onClick={() => onImportMaterial(brief.material)}
          disabled={!brief.material.trim()}
        >
          <FileInput size={12}/> 仅导入编辑器，不调用 AI
        </button>
      </Field>

      <Field label="我的判断（可选）" hint="一句话即可；留空时按素材提炼">
        <Textarea
          aria-label="我的判断"
          value={brief.angle}
          onChange={(e) => update({ angle: e.target.value })}
          rows={2}
          placeholder="我真正想说的是……"
        />
      </Field>

      <details ref={advancedRef} className="group rounded-lg border border-ink-line">
        <summary className="flex items-center justify-between px-3 py-2 cursor-pointer text-sm font-medium text-ink-soft select-none">
          高级选项
          <ChevronDown size={14} className="text-ink-muted transition-transform group-open:rotate-180"/>
        </summary>
        <div className="px-3 pb-3 pt-1 flex flex-col gap-3 border-t border-ink-line">
          <Field label="素材类型">
            <Select aria-label="素材类型" value={brief.materialType} onChange={(e) => update({ materialType: e.target.value as MaterialType })}>
              {MATERIAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="写作风格" hint={selectedStyle.description}>
              <Select aria-label="写作风格" value={brief.voice} onChange={(e) => update({ voice: e.target.value as Voice })}>
                {WRITING_STYLES.map((style) => <option key={style.id} value={style.id}>{style.name} · {style.tagline}</option>)}
              </Select>
            </Field>
            <Field label="长度">
              <Select aria-label="文章长度" value={brief.length} onChange={(e) => update({ length: e.target.value as Brief['length'] })}>
                <option value="short">短 (&lt;800)</option>
                <option value="medium">中 (800–2000)</option>
                <option value="long">长 (&gt;2000)</option>
              </Select>
            </Field>
          </div>
          <Field label="标题方向" hint="留空则按编辑准则最后拟">
            <Input aria-label="标题方向" value={brief.titleHint ?? ''} onChange={(e) => update({ titleHint: e.target.value })} placeholder="人物/事件 + 判断"/>
          </Field>
          <Field label="发布到">
            <div className="flex flex-wrap gap-1.5">
              {PLATFORM_ORDER.map((p) => (
                <PlatformChip key={p} active={brief.platforms.includes(p)} onClick={() => togglePlatform(p)}>
                  {PLATFORMS[p].label}
                </PlatformChip>
              ))}
            </div>
          </Field>
          <Field label="行动号召（CTA）">
            <Input aria-label="行动号召" value={brief.cta ?? ''} onChange={(e) => update({ cta: e.target.value })} placeholder="默认：留言讨论"/>
          </Field>
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={brief.bilingual} onChange={(e) => update({ bilingual: e.target.checked })} className="h-4 w-4 accent-ink"/>
            生成中英双语版本
          </label>
        </div>
      </details>

      <div ref={progressRef} className="sticky bottom-0 z-10 -mx-5 mt-1 border-t border-ink-line/80 bg-white px-5 pb-1 pt-3">
        {generating && generationProgress ? (
          <GenerationProgress state={generationProgress} materialType={brief.materialType} platformCount={brief.platforms.length} onCancel={onCancelGeneration}/>
        ) : (
          <Button
            onClick={brief.materialType === 'copy' ? () => onImportMaterial(brief.material) : handleGenerate}
            disabled={!brief.material.trim()}
            size="lg"
            className="w-full"
          >
            {brief.materialType === 'copy' ? <FileInput size={16} className="mr-1.5"/> : <Sparkles size={16} className="mr-1.5"/>}
            {brief.materialType === 'copy' ? '导入并排版' : '开始生成'}
          </Button>
        )}
        {showGuide && (
          <div className="mt-2">
            <AiSetupGuide onRefresh={refresh}/>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink-soft mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-ink-muted mt-1">{hint}</p>}
    </div>
  );
}

function PlatformChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'h-10 px-3 rounded-full text-sm border transition-colors sm:h-7 sm:px-2.5 sm:text-xs',
        active ? 'bg-ink text-white border-ink' : 'bg-white text-ink-soft border-ink-line hover:border-ink',
      )}
    >
      {children}
    </button>
  );
}
