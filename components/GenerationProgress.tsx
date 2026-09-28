'use client';

import * as React from 'react';
import { Check, Clock3, FileText, Loader2, ShieldCheck, Square } from 'lucide-react';
import { Button } from './ui/button';
import type { GenerationStage, GenerationViewState } from '@/src/lib/generation-events';
import type { MaterialType } from '@/src/lib/types';
import { cn } from './ui/cn';

const STAGE_INDEX: Record<GenerationStage, number> = {
  source: 0,
  rules: 1,
  waiting: 2,
  streaming: 2,
  translating: 2,
  checking: 3,
  done: 4,
};

export function GenerationProgress({
  state,
  materialType,
  platformCount,
  onCancel,
}: {
  state: GenerationViewState;
  materialType: MaterialType;
  platformCount: number;
  onCancel: () => void;
}) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const isNews = materialType === 'news';
  const labels = ['素材', '规则', '生成', '检查'];
  const currentIndex = STAGE_INDEX[state.stage];
  const seconds = Math.max(0, Math.floor((now - state.startedAt) / 1000));
  const stageCopy = getStageCopy(state);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-indigo-100/90 bg-white/95 p-4 shadow-[0_18px_50px_rgba(79,70,229,0.12)] backdrop-blur-xl sm:p-5" aria-live="polite">
      <div className="pointer-events-none absolute -right-14 -top-20 size-44 rounded-full bg-indigo-200/35 blur-3xl"/>
      <div className="pointer-events-none absolute -bottom-16 left-10 size-36 rounded-full bg-sky-200/30 blur-3xl"/>

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-indigo-400 opacity-60"/>
              <span className="relative inline-flex size-2.5 rounded-full bg-indigo-600"/>
            </span>
            <div className="text-base font-semibold">{stageCopy.title}</div>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{stageCopy.detail}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-muted tabular-nums">
            <span className="inline-flex items-center gap-1"><Clock3 size={12}/> {formatSeconds(seconds)}</span>
            <span>·</span>
            <span>{isNews ? '新闻稿' : '文章'}</span>
            {state.chars > 0 && <span>· 已收到 {state.chars.toLocaleString('zh-CN')} 字</span>}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel} className="relative shrink-0 hover:bg-white/80">
          <Square size={11}/> 停止
        </Button>
      </div>

      <ol className="relative mt-4 grid grid-cols-4 gap-1.5">
        {labels.map((label, index) => {
          const done = index < currentIndex;
          const active = index === currentIndex;
          return (
            <li key={label} className="min-w-0 text-center text-[10px] sm:text-[11px]">
              <span className={`mx-auto size-6 rounded-full flex items-center justify-center ${done ? 'bg-indigo-600 text-white' : active ? 'bg-white border border-indigo-500 text-indigo-700 shadow-[0_0_0_4px_rgba(99,102,241,0.10)]' : 'border border-ink-line bg-white/70 text-ink-muted'}`}>
                {done ? <Check size={12}/> : active ? <Loader2 size={12} className="animate-spin"/> : index + 1}
              </span>
              <span className={`mt-1.5 block ${done || active ? 'text-ink' : 'text-ink-muted'}`}>{label}</span>
            </li>
          );
        })}
      </ol>

      <div className="relative mt-4 overflow-hidden rounded-xl border border-indigo-100 bg-indigo-50/45 px-3.5 py-3">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-indigo-700"><FileText size={12}/> {state.preview ? '正在生成的原稿' : '生成结果会出现在这里'}</div>
        {state.preview && (
          <p className="mt-2 text-xs leading-relaxed text-ink-soft line-clamp-3">…{state.preview}</p>
        )}
        {!state.preview && <p className="mt-2 text-xs text-ink-muted">第一段正文返回后会显示真实片段，不展示模拟过程。</p>}
      </div>
      {state.verdict && (
        <div className={cn('relative mt-3 rounded-xl border p-3 text-xs', state.verdict.passed ? 'border-emerald-200 bg-emerald-50/80 text-emerald-700' : 'border-amber-200 bg-amber-50/80 text-amber-700')}>
          <p className="flex items-center gap-1.5 font-semibold">
            <ShieldCheck size={12}/> 交叉验证 · {state.verdict.model} · {state.verdict.passed ? '通过' : '需要修改'} · {state.verdict.score}/100
          </p>
          {state.verdict.issues.length > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {state.verdict.issues.map((issue, index) => (<li key={index}>{issue}</li>))}
            </ul>
          )}
          {state.verdict.suggestions.length > 0 && (
            <>
              <p className="mt-1.5 font-medium">建议：</p>
              <ul className="mt-0.5 list-disc pl-4">
                {state.verdict.suggestions.map((suggestion, index) => (<li key={index}>{suggestion}</li>))}
              </ul>
            </>
          )}
        </div>
      )}
      <p className="relative mt-3 text-[10px] leading-relaxed text-ink-muted">完成后自动进入可编辑原稿{platformCount > 0 ? `，并在后台继续准备 ${platformCount} 个平台版本` : ''}。停止不会覆盖已有内容。</p>
    </div>
  );
}

function getStageCopy(state: GenerationViewState) {
  if (state.stage === 'source') return { title: '正在整理素材', detail: '读取输入并整理成可写作的上下文。' };
  if (state.stage === 'rules') return { title: '正在确定写法', detail: state.detail || '应用所选 Agent、风格和编辑准则。' };
  if (state.stage === 'waiting') return { title: '正在等待第一段正文', detail: '生成请求已提交，原稿在完整返回前不会被覆盖。' };
  if (state.stage === 'streaming') return { title: '原稿正在生成', detail: '正文片段正在真实返回，完成后会一次写入编辑器。' };
  if (state.stage === 'translating') return { title: '正在补译英文版', detail: '中文正文已完成，正在生成英文部分。' };
  if (state.stage === 'checking') return { title: '正在做发布前检查', detail: '检查标题、结构与基础格式，然后交付原稿。' };
  return { title: '原稿已经完成', detail: state.detail || '正在进入编辑器。' };
}

function formatSeconds(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}:${String(rest).padStart(2, '0')}` : `${rest} 秒`;
}
