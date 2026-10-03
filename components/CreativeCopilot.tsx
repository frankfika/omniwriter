'use client';

import * as React from 'react';
import { ArrowUp, ChevronDown, Loader2, MessageSquareText, Sparkles, Users } from 'lucide-react';
import type { CreatorMessage } from '@/src/lib/types';
import { CREATOR_AGENT_BY_ID, CREATOR_AGENTS } from '@/src/lib/creator-agents';
import { cn } from './ui/cn';

const DRAFT_SUGGESTIONS = ['标题更克制一点', '精简全文', '让开头更有判断'];
const EMPTY_SUGGESTIONS = ['按默认方式生成', '只导入原文排版', '先看看素材设置'];

export function CreativeCopilot({
  messages,
  hasContent,
  busy,
  onSubmit,
}: {
  messages: CreatorMessage[];
  hasContent: boolean;
  busy: boolean;
  onSubmit: (instruction: string) => Promise<void>;
}) {
  const [input, setInput] = React.useState('');
  const [expanded, setExpanded] = React.useState(false);
  const [agentsOpen, setAgentsOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const suggestions = hasContent ? DRAFT_SUGGESTIONS : EMPTY_SUGGESTIONS;
  const recent = messages.slice(-6);

  const submit = async (value = input) => {
    const instruction = value.trim();
    if (!instruction || busy) return;
    setInput('');
    await onSubmit(instruction);
  };

  return (
    <aside className="relative z-30 shrink-0 border-t border-ink-line bg-white px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 sm:px-5">
      <div className="mx-auto max-w-4xl">
        {expanded && recent.length > 0 && (
          <div aria-label="最近创作对话" className="mb-2 max-h-44 space-y-2 overflow-y-auto rounded-xl border border-ink-line/80 bg-ink-panel/80 p-3">
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink"><MessageSquareText size={12}/> 本篇创作对话</span>
              <button type="button" onClick={() => setExpanded(false)} className="inline-flex h-10 items-center gap-1 rounded-md px-2 text-xs text-ink-muted hover:bg-white hover:text-ink sm:h-8"><ChevronDown size={12}/> 收起</button>
            </div>
            {recent.map((message) => (
              <div key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  'max-w-[88%] rounded-xl px-3 py-2 text-xs leading-relaxed',
                  message.role === 'user' ? 'bg-ink text-white' : 'border border-ink-line bg-white text-ink-soft',
                )}>
                  {message.role === 'assistant' && message.agentId && (
                    <span className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-ink">
                      <span className="flex size-4 items-center justify-center rounded bg-ink-panel">{CREATOR_AGENT_BY_ID[message.agentId].symbol}</span>
                      {CREATOR_AGENT_BY_ID[message.agentId].label}
                    </span>
                  )}
                  <p>{message.content}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {agentsOpen && (
          <div aria-label="协作 Agents" className="mb-2 rounded-xl border border-ink-line bg-ink-panel/55 p-2.5">
            <div className="mb-2 flex items-center justify-between gap-3 px-1">
              <p className="text-xs font-medium text-ink">指定一位协作 Agent</p>
              <span className="text-xs text-ink-soft">不指定时自动派工</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
              {CREATOR_AGENTS.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => {
                    setInput(`${agent.handle} `);
                    setAgentsOpen(false);
                    window.setTimeout(() => inputRef.current?.focus(), 0);
                  }}
                  className="flex min-h-12 items-center gap-2 rounded-lg border border-ink-line bg-white px-2.5 text-left shadow-sm transition hover:border-ink hover:shadow"
                  title={`${agent.description}，例如：${agent.example}`}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink text-xs font-bold text-white">{agent.symbol}</span>
                  <span className="min-w-0"><span className="block text-xs font-semibold text-ink">{agent.label}</span><span className="block truncate text-[9px] text-ink-muted">{agent.description}</span></span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {!expanded && messages.length > 0 && (
            <button type="button" onClick={() => setExpanded(true)} className="h-10 shrink-0 rounded-full border border-ink-line bg-ink-panel px-3 text-xs font-medium text-ink hover:bg-ink-line/60 sm:h-8">
              最近对话 · {messages.length}
            </button>
          )}
          {suggestions.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => void submit(suggestion)} disabled={busy} className="h-10 shrink-0 rounded-full border border-ink-line bg-white px-3 text-xs text-ink-soft hover:border-ink hover:text-ink disabled:opacity-50 sm:h-8">
              {suggestion}
            </button>
          ))}
          {hasContent && <button type="button" onClick={() => void submit('生成并查看全部平台稿')} disabled={busy} className="h-10 shrink-0 rounded-full border border-ink-line bg-white px-3 text-xs text-ink-soft hover:border-ink hover:text-ink disabled:opacity-50 sm:h-8">生成全部平台稿</button>}
        </div>

        <div className="flex items-end gap-2 rounded-2xl border border-ink-line bg-white p-2 focus-within:border-ink focus-within:ring-2 focus-within:ring-indigo-100">
          <button
            type="button"
            aria-label="选择协作 Agent"
            aria-expanded={agentsOpen}
            onClick={() => setAgentsOpen((value) => !value)}
            className="mb-0.5 ml-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink text-white sm:mb-1.5 sm:ml-1 sm:size-7 sm:rounded-lg"
            title="选择协作 Agent"
          >
            {agentsOpen ? <Users size={14}/> : <Sparkles size={13}/>}
          </button>
          <textarea
            ref={inputRef}
            aria-label="继续创作或修改"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              // isComposing：中文输入法选词中的 Enter 不提交
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            rows={1}
            placeholder={hasContent ? '继续说怎么改，或让 AI 生成平台稿、切换模板、打开预览…' : '继续补充素材、判断或直接说“开始生成”…'}
            className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-1 py-2.5 text-base leading-5 text-ink placeholder:text-ink-muted focus:outline-none sm:text-sm"
          />
          <button type="button" aria-label="发送创作指令" onClick={() => void submit()} disabled={!input.trim() || busy} className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink text-white hover:bg-ink-soft disabled:opacity-35">
            {busy ? <Loader2 size={15} className="animate-spin"/> : <ArrowUp size={16}/>} 
          </button>
        </div>
        <p className="mt-1.5 text-center text-xs text-ink-muted">总编排会自动派工，也可以用 @ 指定 Agent；成果始终保留为可编辑稿件</p>
      </div>
    </aside>
  );
}
