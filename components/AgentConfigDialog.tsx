'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import type { WriterAgent } from '@/src/lib/agents';
import { getAgentOverride, saveAgentOverride, clearAgentOverride } from '@/src/lib/config';
import { PLATFORM_ORDER, PLATFORMS } from '@/src/lib/platforms';
import { WRITING_STYLES } from '@/src/lib/styles';
import type { Brief, PlatformId, Voice } from '@/src/lib/types';
import { Button } from './ui/button';
import { Select } from './ui/select';
import { Textarea } from './ui/input';
import { cn } from './ui/cn';

// 能力市场 Agent「配置」弹窗：定制写作指令与默认选项。
// 只把与内置预设不同的字段写入 override；全相同则清除 override。

interface AgentConfigDialogProps {
  agent: WriterAgent;
  onClose: (saved: boolean) => void;
}

export function AgentConfigDialog({ agent, onClose }: AgentConfigDialogProps) {
  const [directive, setDirective] = React.useState('');
  const [voice, setVoice] = React.useState<Voice>('relaxed');
  const [length, setLength] = React.useState<Brief['length']>('medium');
  const [platforms, setPlatforms] = React.useState<PlatformId[]>([]);
  const [bilingual, setBilingual] = React.useState(false);

  React.useEffect(() => {
    const override = getAgentOverride(agent.id);
    setDirective(override?.directive ?? agent.directive);
    setVoice(override?.defaults?.voice ?? agent.defaults.voice ?? 'relaxed');
    setLength(override?.defaults?.length ?? agent.defaults.length ?? 'medium');
    setPlatforms(override?.defaults?.platforms ?? agent.defaults.platforms ?? []);
    setBilingual(override?.defaults?.bilingual ?? agent.defaults.bilingual ?? false);
  }, [agent]);

  const togglePlatform = (id: PlatformId) => {
    setPlatforms((previous) => previous.includes(id) ? previous.filter((p) => p !== id) : [...previous, id]);
  };

  const onSave = () => {
    const defaults = agent.defaults;
    // 与内置预设逐项对比，只存不同的字段
    const patch: Parameters<typeof saveAgentOverride>[1] = { defaults: {} };
    const trimmed = directive.trim();
    // 空指令不存 override：服务端对空串会回退内置，存了只会让「已定制」徽标说谎
    if (trimmed && trimmed !== agent.directive) patch.directive = trimmed;
    if (voice !== (defaults.voice ?? 'relaxed')) patch.defaults!.voice = voice;
    if (length !== (defaults.length ?? 'medium')) patch.defaults!.length = length;
    if (bilingual !== (defaults.bilingual ?? false)) patch.defaults!.bilingual = bilingual;
    const basePlatforms = defaults.platforms ?? [];
    if (platforms.length !== basePlatforms.length || platforms.some((p) => !basePlatforms.includes(p))) {
      patch.defaults!.platforms = platforms;
    }
    const hasDefaults = Object.keys(patch.defaults!).length > 0;
    if (patch.directive === undefined && !hasDefaults) {
      clearAgentOverride(agent.id); // 全部等于内置：视为无定制
    } else {
      clearAgentOverride(agent.id); // 先清再整体写入，避免旧字段残留
      saveAgentOverride(agent.id, hasDefaults ? patch : { directive: patch.directive });
    }
    onClose(true);
  };

  const onReset = () => {
    clearAgentOverride(agent.id);
    onClose(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={`配置 ${agent.name}`}>
      <button type="button" aria-label="关闭" className="absolute inset-0 cursor-default" onClick={() => onClose(false)}/>
      <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-sm sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-ink-line px-5 py-3.5">
          <h2 className="text-sm font-semibold">配置「{agent.name}」</h2>
          <button type="button" aria-label="关闭" onClick={() => onClose(false)} className="rounded-lg p-1.5 text-ink-muted hover:bg-ink-panel"><X size={16}/></button>
        </div>
        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
          <Field label="写作指令" hint="会追加进生成请求的系统提示，约束风格、结构与事实层级">
            <Textarea
              aria-label="写作指令"
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder={agent.directive}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="默认写作风格">
              <Select aria-label="默认写作风格" value={voice} onChange={(e) => setVoice(e.target.value as Voice)}>
                {WRITING_STYLES.map((style) => <option key={style.id} value={style.id}>{style.name} · {style.tagline}</option>)}
              </Select>
            </Field>
            <Field label="默认长度">
              <Select aria-label="默认长度" value={length} onChange={(e) => setLength(e.target.value as Brief['length'])}>
                <option value="short">短 (&lt;800)</option>
                <option value="medium">中 (800–2000)</option>
                <option value="long">长 (&gt;2000)</option>
              </Select>
            </Field>
          </div>
          <Field label="目标平台">
            <div className="flex flex-wrap gap-1.5">
              {PLATFORM_ORDER.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={platforms.includes(p)}
                  onClick={() => togglePlatform(p)}
                  className={cn(
                    'h-10 rounded-full border px-3 text-sm transition-colors sm:h-7 sm:px-2.5 sm:text-xs',
                    platforms.includes(p) ? 'border-ink bg-ink text-white' : 'border-ink-line bg-white text-ink-soft hover:border-ink',
                  )}
                >
                  {PLATFORMS[p].label}
                </button>
              ))}
            </div>
          </Field>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={bilingual} onChange={(e) => setBilingual(e.target.checked)} className="size-4 accent-ink"/>
            默认生成中英双语稿
          </label>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-ink-line px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="ghost" size="md" onClick={onReset}>恢复默认</Button>
          <div className="flex gap-2 sm:justify-end">
            <Button variant="outline" size="md" onClick={() => onClose(false)} className="flex-1 sm:flex-none">取消</Button>
            <Button size="md" onClick={onSave} className="flex-1 sm:flex-none">保存</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-ink-soft">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
