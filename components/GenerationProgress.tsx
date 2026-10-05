'use client';

import * as React from 'react';
import { Clock3, Square } from 'lucide-react';
import { Button } from './ui/button';
import type { GenerationStage, GenerationViewState } from '@/src/lib/generation-events';

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

// WP-A: 降级为 ~40px 细条。流式正文已直接长在 Editor 里，这里只剩「阶段文案 +
// 计时 + 字数 + 停止按钮 + 0.5px 进度线」。原 250px+ 流面板 + denoise + stickRef
// 全部删除（数据来源 GenerationViewState.preview 也不再存在）。
export function GenerationProgress({
  state,
  onCancel,
}: {
  state: GenerationViewState;
  onCancel: () => void;
}) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.floor((now - state.startedAt) / 1000));
  const stageCopy = getStageCopy(state);

  return (
    <div className="border-y border-ink-line bg-white" aria-live="polite">
      <div className="mx-auto flex max-w-prose items-center gap-3 px-4 py-2">
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-ink opacity-40"/>
          <span className="relative inline-flex size-2 rounded-full bg-ink"/>
        </span>
        <span className="min-w-0 truncate text-xs sm:text-sm font-medium text-ink-soft">{stageCopy.title}</span>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs tabular-nums text-ink-muted">
          <Clock3 size={11}/> {formatSeconds(seconds)}
        </span>
        {state.chars > 0 && (
          <span className="shrink-0 text-xs tabular-nums text-ink-muted">
            · {state.chars.toLocaleString('zh-CN')} 字
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={onCancel} className="ml-auto shrink-0">
          <Square size={10}/> 停止
        </Button>
      </div>
      <div className="mx-auto h-px max-w-prose bg-ink-line">
        <div
          className="h-px bg-ink transition-[width] duration-500 ease-out"
          style={{ width: `${STAGE_WIDTH[state.stage]}%` }}
        />
      </div>
    </div>
  );
}

function getStageCopy(state: GenerationViewState) {
  if (state.stage === 'source') return { title: '正在整理素材' };
  if (state.stage === 'rules') return { title: state.label || '正在确定写法' };
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