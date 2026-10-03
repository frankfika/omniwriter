'use client';

import type { ReactNode } from 'react';
import type { ContentLanguage } from '@/src/lib/bilingual';
import { cn } from './ui/cn';

export function LanguageTabs({
  value,
  onChange,
  hasEnglish,
  compact = false,
}: {
  value: ContentLanguage;
  onChange: (language: ContentLanguage) => void;
  hasEnglish: boolean;
  compact?: boolean;
}) {
  // 标签组键盘导航：←/→ 移动焦点并直接激活对应 tab（WAI-ARIA Tabs 自动激活模式）。
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
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
    buttons[next].click();
  };

  return (
    <div
      className="inline-flex shrink-0 items-center rounded-xl border border-ink-line bg-ink-panel p-1"
      role="tablist"
      aria-label="稿件语言"
      onKeyDown={onKeyDown}
    >
      <LanguageTab active={value === 'zh'} compact={compact} tabIndex={value === 'zh' ? 0 : -1} onClick={() => onChange('zh')}>
        中文
      </LanguageTab>
      <LanguageTab active={value === 'en'} compact={compact} tabIndex={value === 'en' ? 0 : -1} onClick={() => onChange('en')}>
        English
        {!hasEnglish && <span className="ml-1 text-[9px] font-normal opacity-60">待生成</span>}
      </LanguageTab>
    </div>
  );
}

function LanguageTab({
  active,
  compact,
  tabIndex,
  onClick,
  children,
}: {
  active: boolean;
  compact: boolean;
  tabIndex: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      tabIndex={tabIndex}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-200',
        compact ? 'h-10 px-3 text-sm sm:h-7 sm:px-2.5 sm:text-xs' : 'h-10 px-3.5 text-sm sm:h-8 sm:text-xs',
        active
          ? 'bg-white text-ink'
          : 'text-ink-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
