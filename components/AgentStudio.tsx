'use client';

import * as React from 'react';
import { ChevronDown, ChevronUp, FlaskConical, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { GROUP_LABELS, type AgentGroup } from '@/src/lib/agents';
import { saveCustomAgent, type CustomAgent } from '@/src/lib/custom-agents';
import { loadAiConfig } from '@/src/lib/ai-config';
import { Button } from './ui/button';
import { Input, Textarea } from './ui/input';
import { Select } from './ui/select';
import { cn } from './ui/cn';

// 自定义 Agent「孵化」对话框：喂范文 → AI 提炼写作指令 → 测试素材试写 →
// 反馈修订循环，满意后命名保存进能力市场。

interface StudioMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AgentStudioProps {
  onClose: (saved: CustomAgent | null) => void;
}

export function AgentStudio({ onClose }: AgentStudioProps) {
  const [samples, setSamples] = React.useState<string[]>(['']);
  const [history, setHistory] = React.useState<StudioMessage[]>([]);
  const [feedback, setFeedback] = React.useState('');
  const [directive, setDirective] = React.useState('');
  const [directiveOpen, setDirectiveOpen] = React.useState(true);
  const [material, setMaterial] = React.useState('');
  const [trialArticle, setTrialArticle] = React.useState('');
  const [name, setName] = React.useState('');
  const [emoji, setEmoji] = React.useState('🧬');
  const [tagline, setTagline] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [group, setGroup] = React.useState<AgentGroup>('craft');
  const [busy, setBusy] = React.useState<'revise' | 'trial' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const usableSamples = samples.map((s) => s.trim()).filter(Boolean);
  const canRevise = usableSamples.length > 0 && busy === null;

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [history, trialArticle]);

  const tuneAbortRef = React.useRef<AbortController | null>(null);
  // 卸载 / 主动关闭时打断所有飞行中的 /api/agents/tune 请求，避免在已 unmount 的
  // 组件上 setDirective / setHistory（开发环境 React 18 会有警告，生产环境也是无意义的请求）。
  React.useEffect(() => () => tuneAbortRef.current?.abort(), []);

  const callTune = async (body: Record<string, unknown>) => {
    // 一次只跑一个 tune：来新请求前先 abort 旧的，避免连点「开始提炼 / 反馈改稿」
    // 让旧响应覆盖新响应。
    tuneAbortRef.current?.abort();
    const ac = new AbortController();
    tuneAbortRef.current = ac;
    try {
      const res = await fetch('/api/agents/tune', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, ai: loadAiConfig() }),
        signal: ac.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    } finally {
      if (tuneAbortRef.current === ac) tuneAbortRef.current = null;
    }
  };

  const revise = async (userFeedback?: string) => {
    if (!canRevise) return;
    setBusy('revise');
    setError(null);
    const nextHistory = userFeedback ? [...history, { role: 'user' as const, content: userFeedback }] : history;
    try {
      const data = await callTune({
        action: 'revise',
        samples: usableSamples,
        history: nextHistory,
        draftDirective: directive,
      });
      setDirective(data.directive);
      setHistory([...nextHistory, { role: 'assistant', content: data.reply }]);
      if (data.suggestion) {
        if (!name.trim()) setName(data.suggestion.name ?? '');
        if (data.suggestion.emoji) setEmoji(data.suggestion.emoji);
        if (!tagline.trim()) setTagline(data.suggestion.tagline ?? '');
        if (!description.trim()) setDescription(data.suggestion.description ?? '');
      }
      setFeedback('');
    } catch (e) {
      // AbortError 静默：用户主动关闭弹窗，不算错误
      if ((e as Error).name === 'AbortError') return;
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const trial = async () => {
    if (!directive.trim() || !material.trim() || busy) return;
    setBusy('trial');
    setError(null);
    setTrialArticle('');
    try {
      const data = await callTune({ action: 'trial', directive, material });
      setTrialArticle(data.article);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const [saving, setSaving] = React.useState(false);
  const onSave = () => {
    // 防双击：onClose 关弹窗是同步的但 React 提交需要一拍；fast double-click 会在两次
    // 都还没 unmount 之前两次进 onSave，第二次 saveCustomAgent 用新的 UUID 写入，
    // listCustomAgents() 第二次读时已经看到第一次写入的 agent 但只过滤自己的 id，于是
    // 留下两条 id 不同的同名 Agent。
    if (saving) return;
    if (!directive.trim() || !name.trim()) return;
    setSaving(true);
    const agent: CustomAgent = {
      id: `custom-${crypto.randomUUID()}`,
      emoji: emoji.trim() || '🧬',
      name: name.trim(),
      tagline: tagline.trim() || '自定义写作流程',
      description: description.trim() || '用范文孵化出的自定义写作 Agent。',
      group,
      defaults: {
        materialType: 'topic',
        voice: 'relaxed',
        length: 'medium',
        platforms: [],
        angle: '',
      },
      inputHint: '贴主题、素材或链接…',
      directive: directive.trim(),
      pluginIds: ['editorial-check', 'platform-adapter'],
      createdAt: Date.now(),
    };
    saveCustomAgent(agent);
    onClose(agent);
  };

  const setSample = (index: number, value: string) => {
    setSamples((prev) => prev.map((s, i) => (i === index ? value : s)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="创建 Agent">
      <button type="button" aria-label="关闭" className="absolute inset-0 cursor-default" onClick={() => onClose(null)}/>
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-ink-line px-5 py-3.5">
          <h2 className="text-sm font-semibold">孵化自己的 Agent</h2>
          <button type="button" aria-label="关闭" onClick={() => onClose(null)} className="rounded-lg p-1.5 text-ink-muted hover:bg-ink-panel"><X size={16}/></button>
        </div>

        <div ref={scrollRef} className="flex flex-col gap-5 overflow-y-auto px-5 py-4">
          {error && (
            <div role="alert" className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
          )}

          {/* 样本区 */}
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-xs font-medium text-ink-soft">范文样本</h3>
              <Button variant="ghost" size="sm" onClick={() => setSamples((prev) => [...prev, ''])} disabled={samples.length >= 5}>
                <Plus size={12}/>加一条
              </Button>
            </div>
            <p className="mb-2 text-[11px] text-ink-muted">贴 1–5 篇你欣赏的文章全文，AI 会从中提炼写作指令。</p>
            <div className="flex flex-col gap-2">
              {samples.map((sample, index) => (
                <div key={index} className="relative">
                  <Textarea
                    aria-label={`范文样本 ${index + 1}`}
                    value={sample}
                    onChange={(e) => setSample(index, e.target.value)}
                    rows={3}
                    maxLength={8000}
                    placeholder={`样本 ${index + 1}：粘贴范文全文…`}
                  />
                  {samples.length > 1 && (
                    <button
                      type="button"
                      aria-label={`删除样本 ${index + 1}`}
                      onClick={() => setSamples((prev) => prev.filter((_, i) => i !== index))}
                      className="absolute right-2 top-2 rounded-lg p-1 text-ink-muted hover:bg-ink-panel"
                    >
                      <Trash2 size={13}/>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2">
              <Button size="md" onClick={() => revise()} disabled={!canRevise || history.length > 0}>
                {busy === 'revise' ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14}/>}
                开始提炼
              </Button>
            </div>
          </section>

          {/* 对话区 */}
          {history.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-medium text-ink-soft">反馈与修订</h3>
              <div className="flex flex-col gap-2 rounded-xl border border-ink-line bg-ink-panel/40 p-3">
                {history.map((message, index) => (
                  <div
                    key={index}
                    className={cn(
                      'max-w-[85%] rounded-xl px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap',
                      message.role === 'user' ? 'self-end bg-ink text-white' : 'self-start bg-white text-ink border border-ink-line',
                    )}
                  >
                    {message.content}
                  </div>
                ))}
                {busy === 'revise' && <div className="self-start text-[11px] text-ink-muted">正在按反馈修订指令…</div>}
              </div>
              <div className="mt-2 flex gap-2">
                <Input
                  aria-label="反馈"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  onKeyDown={(event) => {
                    // isComposing：中文输入法选词中的 Enter 不提交
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing && feedback.trim()) {
                      event.preventDefault();
                      revise(feedback.trim());
                    }
                  }}
                  placeholder="告诉 AI 哪里要改，比如「开头太平，要更有钩子」…"
                  className="h-10 sm:h-9"
                />
                <Button size="md" variant="outline" onClick={() => feedback.trim() && revise(feedback.trim())} disabled={!feedback.trim() || busy !== null} className="shrink-0">发送</Button>
              </div>
            </section>
          )}

          {/* 当前指令 */}
          {directive && (
            <section className="rounded-xl border border-ink-line">
              <button type="button" onClick={() => setDirectiveOpen((v) => !v)} className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-ink-soft">
                当前写作指令（可手改）
                {directiveOpen ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
              </button>
              {directiveOpen && (
                <div className="border-t border-ink-line p-3">
                  <Textarea aria-label="当前写作指令" value={directive} onChange={(e) => setDirective(e.target.value)} rows={5} maxLength={4000}/>
                </div>
              )}
            </section>
          )}

          {/* 试写区 */}
          {directive && (
            <section>
              <h3 className="mb-1.5 text-xs font-medium text-ink-soft">试写一篇</h3>
              <Textarea
                aria-label="测试素材"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                rows={3}
                maxLength={12000}
                placeholder="贴一段测试素材，用当前指令真实试写一篇看看效果…"
              />
              <div className="mt-2">
                <Button size="md" variant="outline" onClick={trial} disabled={!material.trim() || busy !== null}>
                  {busy === 'trial' ? <Loader2 size={14} className="animate-spin"/> : <FlaskConical size={14}/>}
                  {busy === 'trial' ? '正在试写…' : '试写一篇'}
                </Button>
              </div>
              {trialArticle && (
                <div className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl border border-ink-line bg-ink-panel/40 p-3 text-[12.5px] leading-relaxed text-ink">
                  {trialArticle}
                </div>
              )}
            </section>
          )}

          {/* 命名与保存 */}
          {directive && (
            <section className="rounded-xl border border-ink-line p-3">
              <h3 className="mb-2 text-xs font-medium text-ink-soft">命名并保存到能力市场</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[64px_1fr]">
                <Input aria-label="emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} className="h-10 text-center sm:h-9"/>
                <Input aria-label="Agent 名称" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="给 Agent 起个名字…" className="h-10 sm:h-9"/>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input aria-label="slogan" value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={40} placeholder="一句 slogan（可选）" className="h-10 sm:h-9"/>
                <Select aria-label="分组" value={group} onChange={(e) => setGroup(e.target.value as AgentGroup)}>
                  {Object.entries(GROUP_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </Select>
              </div>
              <Textarea aria-label="描述" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={120} placeholder="一句话描述这个 Agent 适合写什么（可选）" className="mt-2"/>
            </section>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-line px-5 py-3.5">
          <Button variant="outline" size="md" onClick={() => onClose(null)}>取消</Button>
          <Button size="md" onClick={onSave} disabled={!directive.trim() || !name.trim() || busy !== null || saving}>{saving ? '保存中…' : '保存 Agent'}</Button>
        </div>
      </div>
    </div>
  );
}
