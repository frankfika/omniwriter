'use client';

import * as React from 'react';
import { Clock3, Square } from 'lucide-react';
import { Button } from './ui/button';
import type { GenerationStage, GenerationViewState } from '@/src/lib/generation-events';
import type { MaterialType } from '@/src/lib/types';

// 阶段进度条只是「走到哪一步」的示意，不是百分比；宽度按阶段常量表固定，
// 避免用编造的数字冒充生成进度。
const STAGE_WIDTH: Record<GenerationStage, number> = {
  source: 8,
  rules: 15,
  waiting: 25,
  streaming: 60,
  translating: 75,
  checking: 90,
  done: 100,
};

export function GenerationProgress({
  state,
  onCancel,
}: {
  state: GenerationViewState;
  // materialType / platformCount 仍是 props 签名的一部分（BriefPanel、AgentCompose
  // 在传），简化后的界面不再展示这两项。
  materialType: MaterialType;
  platformCount: number;
  onCancel: () => void;
}) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  // 流面板内容变化时，只有用户仍然贴底才自动滚到底部。是否贴底在 onScroll 里
  // 记录（那一刻内容还没变长）；不能在 effect 里算距底距离，那时内容已经变长，
  // 算出来一定 > 80，之后就再也不自动滚了。
  const streamRef = React.useRef<HTMLDivElement | null>(null);
  const stickRef = React.useRef(true);
  React.useEffect(() => {
    const el = streamRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [state.preview]);

  const seconds = Math.max(0, Math.floor((now - state.startedAt) / 1000));
  const stageCopy = getStageCopy(state);

  return (
    <div className="rounded-xl border border-ink-line bg-white p-4 sm:p-5" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="relative flex size-2.5 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-ink opacity-40"/>
            <span className="relative inline-flex size-2.5 rounded-full bg-ink"/>
          </span>
          <span className="min-w-0 truncate text-sm font-medium">{stageCopy.title}</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs tabular-nums text-ink-muted">
            <Clock3 size={12}/> {formatSeconds(seconds)}
          </span>
          {state.chars > 0 && (
            <span className="shrink-0 text-xs tabular-nums text-ink-muted">
              · 已写 {state.chars.toLocaleString('zh-CN')} 字
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel} className="shrink-0">
          <Square size={11}/> 停止
        </Button>
      </div>

      <div className="mt-4 h-0.5 w-full overflow-hidden rounded-full bg-ink-line">
        <div
          className="h-full rounded-full bg-ink transition-[width] duration-500 ease-out"
          style={{ width: `${STAGE_WIDTH[state.stage]}%` }}
        />
      </div>

      <div
        ref={streamRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="mt-4 max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-ink-soft"
      >
        {state.preview ? denoise(state.preview) : '等待第一段正文…'}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-muted">完成后自动进入编辑器，停止不会覆盖已有内容。</p>
    </div>
  );
}

// 去掉 preview 里的 markdown 噪音符号：行首标题井号和所有 **。
// ** 不按成对匹配：preview 是 slice(-1500) 截出来的，开头可能截断一对 **。
// 行首的 - 保留（列表符号比裸井号可读）。
function denoise(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*/g, '');
}

function getStageCopy(state: GenerationViewState) {
  if (state.stage === 'source') return { title: '正在整理素材' };
  if (state.stage === 'rules') return { title: '正在确定写法' };
  if (state.stage === 'waiting') return { title: '正在等待第一段正文' };
  if (state.stage === 'streaming') return { title: '原稿正在生成' };
  if (state.stage === 'translating') return { title: '正在补译英文版' };
  if (state.stage === 'checking') return { title: '正在做发布前检查' };
  return { title: '原稿已经完成' };
}

function formatSeconds(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}:${String(rest).padStart(2, '0')}` : `${rest} 秒`;
}
