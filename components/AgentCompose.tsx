'use client';

import * as React from 'react';
import { Sparkles, Loader2, Link as LinkIcon, ChevronDown, FileInput } from 'lucide-react';
import { Button } from './ui/button';
import { Input, Textarea } from './ui/input';
import { Select } from './ui/select';
import { cn } from './ui/cn';
import { AiSetupGuide } from './AiSetupGuide';
import { useAiStatus } from '@/src/lib/use-ai-status';
import { resolveAgent, SCENES, allPlatforms } from '@/src/lib/agents';
import { getCustomAgent } from '@/src/lib/custom-agents';
import { PLATFORMS } from '@/src/lib/platforms';
import { resolveWritingStyle, WRITING_STYLES } from '@/src/lib/styles';
import type { Brief, PlatformId, Voice } from '@/src/lib/types';
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

// Agent 优先的极简编排器：只露出「素材 + 发布地点 + 生成」，
// 风格/长度/标题/CTA/双语/细粒度平台全部折叠进高级抽屉。
export function AgentCompose({ brief, onChange, onGenerate, onImportMaterial, onError, generating, generationProgress, onCancelGeneration }: Props) {
  const { aiReady, refresh } = useAiStatus();
  const [showGuide, setShowGuide] = React.useState(false);
  const [fetching, setFetching] = React.useState(false);
  const advancedRef = React.useRef<HTMLDetailsElement>(null);
  const progressRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!generating) return;
    const frame = window.requestAnimationFrame(() => progressRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    return () => window.cancelAnimationFrame(frame);
  }, [generating]);

  const agent = resolveAgent(brief.agentId) ?? getCustomAgent(brief.agentId);

  // Hooks 恒定调用后再分支
  const update = (patch: Partial<Brief>) => onChange({ ...brief, ...patch });

  // Agent 已被删除（如自定义 Agent）：面板照常可用，只提示指令失效
  const agentMissing = !agent && Boolean(brief.agentId);
  if (!agent && !brief.agentId) return null;

  const selectedScene = SCENES.find((s) => s.id === brief.scene);
  const selectedStyle = resolveWritingStyle(brief.voice);
  const isCopyOnly = agent?.id === 'copy-format' || brief.materialType === 'copy';
  const materialUrls = extractHttpUrls(brief.material);
  const canFetchUrls = materialUrls.length > 0 && !brief.material.includes('## 来源 1');

  const pickScene = (sceneId: string) => {
    const scene = SCENES.find((s) => s.id === sceneId);
    update({ scene: sceneId, platforms: scene?.platforms ?? brief.platforms });
  };

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

  return (
    <div className="flex flex-col h-full overflow-y-auto p-5 gap-4 bg-white">
      {/* 当前模式 */}
      {agentMissing && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
          关联的 Agent 已被删除，生成时不会带它的定制指令；可回市场另选流程或继续按默认方式生成。
        </div>
      )}
      <div className="rounded-xl border border-ink-line p-3.5 flex items-center gap-3 bg-ink-panel/30">
        <div className="text-xl leading-none">{agent?.emoji ?? '✍️'}</div>
        <div className="min-w-0">
          <div className="text-sm font-semibold">{agent?.name ?? '自由写作'}</div>
          <div className="text-[11px] text-ink-muted mt-0.5 truncate">{agent?.tagline ?? '不绑定特定流程'}</div>
        </div>
      </div>

      {/* 素材 */}
      <Field label="素材" hint="支持正文、最多 8 个网页链接或 GitHub 仓库；链接可一键读取">
        <div className="flex gap-1.5">
          <Textarea
            aria-label="素材"
            value={brief.material}
            onChange={(e) => update({ material: e.target.value })}
            rows={5}
            placeholder={agent?.inputHint ?? '贴入正文、链接或 GitHub 仓库…'}
            className="flex-1"
          />
          {canFetchUrls && (
            <Button variant="outline" size="md" onClick={onPickUrl} disabled={fetching} title={`读取 ${materialUrls.length} 个链接`}>
              {fetching ? <Loader2 size={14} className="animate-spin"/> : <LinkIcon size={14}/>}
            </Button>
          )}
        </div>
        {!isCopyOnly && (
          <button
            className="mt-1.5 min-h-10 inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink sm:min-h-0"
            onClick={() => onImportMaterial(brief.material)}
            disabled={!brief.material.trim()}
          >
            <FileInput size={12}/> 仅导入编辑器，不调用 AI
          </button>
        )}
      </Field>

      {!isCopyOnly && (
        <Field label="我的判断（可选）" hint="一句话即可；留空时按素材提炼">
          <Textarea
            aria-label="我的判断"
            value={brief.angle ?? ''}
            onChange={(e) => update({ angle: e.target.value })}
            rows={2}
            placeholder="我真正想说的是……"
          />
        </Field>
      )}

      {/* 高级选项 */}
      <details ref={advancedRef} className="group rounded-lg border border-ink-line">
        <summary className="flex items-center justify-between px-3 py-2 cursor-pointer text-[13px] font-medium text-ink-soft select-none">
          高级选项
          <ChevronDown size={14} className="text-ink-muted transition-transform group-open:rotate-180"/>
        </summary>
        <div className="px-3 pb-3 pt-1 flex flex-col gap-3 border-t border-ink-line">
          <Field label="发布到" hint="选一个常用组合；也可以精细勾选">
            <div className="flex flex-wrap gap-1.5">
              {SCENES.map((s) => (
                <Chip key={s.id} active={selectedScene?.id === s.id} onClick={() => pickScene(s.id)} title={s.hint}>
                  {s.label}
                </Chip>
              ))}
              <Chip active={!selectedScene} onClick={() => update({ scene: undefined, platforms: agent?.defaults.platforms ? [...agent.defaults.platforms] : [] })} title="按当前模式默认平台">
                默认
              </Chip>
            </div>
            <p className="text-[11px] text-ink-muted mt-1.5">
              {brief.platforms.length > 0 ? brief.platforms.map((p) => PLATFORMS[p].label).join(' · ') : '使用默认平台'}
            </p>
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
          <Field label="行动号召（CTA）">
            <Input aria-label="行动号召" value={brief.cta ?? ''} onChange={(e) => update({ cta: e.target.value })} placeholder="默认按编辑准则"/>
          </Field>
          <Field label="平台精细勾选">
            <div className="flex flex-wrap gap-1.5">
              {allPlatforms().map((p) => (
                <Chip key={p} active={brief.platforms.includes(p)} onClick={() => togglePlatform(p)}>
                  {PLATFORMS[p].label}
                </Chip>
              ))}
            </div>
          </Field>
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={brief.bilingual}
              onChange={(e) => update({ bilingual: e.target.checked })}
              className="h-4 w-4 accent-ink"
            />
            生成中英双语版本
          </label>
        </div>
      </details>

      <div ref={progressRef} className="sticky bottom-0 z-10 -mx-5 mt-1 border-t border-ink-line/80 bg-white/95 px-5 pb-1 pt-3 backdrop-blur-xl">
        {generating && generationProgress ? (
          <GenerationProgress state={generationProgress} materialType={brief.materialType} platformCount={brief.platforms.length} onCancel={onCancelGeneration}/>
        ) : (
          <Button
            onClick={isCopyOnly ? () => onImportMaterial(brief.material) : handleGenerate}
            disabled={!brief.material.trim()}
            size="lg"
            className="w-full"
          >
            {isCopyOnly ? <FileInput size={16} className="mr-1.5"/> : <Sparkles size={16} className="mr-1.5"/>}
            {isCopyOnly ? '导入并排版' : '开始生成'}
          </Button>
        )}
        {!brief.material.trim() && <p className="mt-1.5 text-center text-[11px] text-ink-muted">先放入素材，再生成母稿</p>}
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
      {hint && <p className="text-[11px] text-ink-muted mt-1">{hint}</p>}
    </div>
  );
}

function Chip({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'h-10 px-3 rounded-full text-sm border transition-colors sm:h-7 sm:px-2.5 sm:text-xs',
        active ? 'bg-ink text-white border-ink' : 'bg-white text-ink-soft border-ink-line hover:border-ink',
      )}
    >
      {children}
    </button>
  );
}
