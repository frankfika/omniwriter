'use client';

import * as React from 'react';

// 内联错误提示：替代 alert()，不打断流程，自动消失
// 默认单行紧凑展示；长消息（如多平台失败列表）点击可展开换行查看
export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const [expanded, setExpanded] = React.useState(false);
  React.useEffect(() => { setExpanded(false); }, [message]);
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-2 px-4 py-2 text-[13px] bg-red-50 text-red-700 border-b border-red-200"
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        title={expanded ? '点击收起' : '点击展开完整信息'}
        className={`min-w-0 flex-1 cursor-pointer text-left ${expanded ? 'whitespace-pre-wrap break-words' : 'truncate'}`}
      >
        {message}
      </button>
      <button onClick={onDismiss} className="shrink-0 self-start text-red-500 hover:text-red-700 px-1" aria-label="关闭">
        ×
      </button>
    </div>
  );
}

// 简单的自动消失错误状态
export function useError(ms = 8000) {
  const [error, setError] = React.useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = React.useCallback((msg: string) => {
    setError(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setError(null), ms);
  }, [ms]);
  const dismiss = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setError(null);
  }, []);
  return { error, show, dismiss };
}
