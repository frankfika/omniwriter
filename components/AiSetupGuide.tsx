'use client';

import * as React from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { Button } from './ui/button';

interface Props {
  onRefresh: () => Promise<boolean>;
  compact?: boolean;
}

// 未配 AI 密钥时的引导（命中点生成才出现）
export function AiSetupGuide({ onRefresh, compact = false }: Props) {
  const [checking, setChecking] = React.useState(false);
  const [ok, setOk] = React.useState<boolean | null>(null);

  const doRefresh = async () => {
    setChecking(true);
    setOk(await onRefresh());
    setChecking(false);
  };

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <div className="font-semibold mb-1.5">先配置 AI 密钥，AI 生成才可用</div>
      {!compact && (
        <ol className="list-decimal pl-4 space-y-1 text-xs text-amber-900/90">
          <li>
            打开<Link href="/settings" className="underline">设置 → AI 连接</Link>
            （或侧栏「设置」）。
          </li>
          <li>
            粘贴你的 API Key——默认接 MiniMax 接口（Base URL / 模型可按需改）。
            <span className="opacity-80 block">密钥只存在你的浏览器里，仅生成 / 适配时发送；无需重启服务器。</span>
          </li>
          <li>
            回这里点「重新检测」。<span className="opacity-80">没配 key 也能用：编辑器、预览、平台稿、ZIP 导出都正常，「纯排版」Agent 不依赖 AI。</span>
          </li>
        </ol>
      )}
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={doRefresh} disabled={checking}>
          {checking ? '检测中…' : ok ? '已配置' : '重新检测'}
        </Button>
        {ok && (
          <span className="inline-flex items-center gap-1 text-emerald-700">
            <Check size={13}/> AI 已可用
          </span>
        )}
        {compact && (
          <Link href="/settings" className="text-xs underline underline-offset-2">去设置填密钥</Link>
        )}
      </div>
    </div>
  );
}
