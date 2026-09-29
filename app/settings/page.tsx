'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Blocks, Bot, Check, CheckCircle2, DatabaseBackup, Download, KeyRound, PenLine, RadioTower, ShieldCheck, SlidersHorizontal, Upload } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DEFAULT_CONFIG, loadConfig, saveConfig } from '@/src/lib/config';
import { DEFAULT_AI_CONFIG, loadAiConfig, saveAiConfig } from '@/src/lib/ai-config';
import { useAiStatus } from '@/src/lib/use-ai-status';
import type { AiConfig } from '@/src/lib/ai-config';
import type { CreatorConfig, PlatformId, Voice } from '@/src/lib/types';
import { PLATFORM_ORDER, PLATFORMS } from '@/src/lib/platforms';
import { CREATOR_PLUGINS } from '@/src/lib/plugins';
import { WRITING_STYLES } from '@/src/lib/styles';
import { cn } from '@/components/ui/cn';
import { WECHAT_TEMPLATES } from '@/src/lib/templates';
import { createBackup, parseBackup, reconcileAgentOverrides, restoreCustomAgents } from '@/src/lib/backup';
import { useArticleStore } from '@/src/lib/store';
import { downloadBlob } from '@/src/lib/export-html';

type SettingsTab = 'ai' | 'writing' | 'publishing' | 'capabilities' | 'data';

const TABS: Array<{ id: SettingsTab; label: string; icon: LucideIcon }> = [
  { id: 'ai', label: 'AI 连接', icon: Bot },
  { id: 'writing', label: '写作偏好', icon: PenLine },
  { id: 'publishing', label: '发布', icon: RadioTower },
  { id: 'capabilities', label: '插件', icon: Blocks },
  { id: 'data', label: '数据安全', icon: DatabaseBackup },
];

export default function SettingsPage() {
  const [tab, setTab] = React.useState<SettingsTab>('ai');
  const [cfg, setCfg] = React.useState<CreatorConfig>(DEFAULT_CONFIG);
  const [ai, setAi] = React.useState<AiConfig>(DEFAULT_AI_CONFIG);
  const [saved, setSaved] = React.useState(false);
  const [manageAi, setManageAi] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [connectionResult, setConnectionResult] = React.useState<{ ok: boolean; message: string } | null>(null);
  const { aiReady, refresh } = useAiStatus();
  const articles = useArticleStore((state) => state.articles);
  const hydrateArticles = useArticleStore((state) => state.hydrate);
  const restoreArticles = useArticleStore((state) => state.restore);
  const backupInputRef = React.useRef<HTMLInputElement>(null);
  const [backupResult, setBackupResult] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [restoring, setRestoring] = React.useState(false);

  React.useEffect(() => { setCfg(loadConfig()); setAi(loadAiConfig()); hydrateArticles(); }, [hydrateArticles]);

  const flashTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = () => {
    setSaved(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSaved(false), 1000);
  };
  const update = (patch: Partial<CreatorConfig>) => { const next = { ...cfg, ...patch }; setCfg(next); saveConfig(next); flash(); };
  const updateAi = (patch: Partial<AiConfig>) => { const next = { ...ai, ...patch }; setAi(next); saveAiConfig(next); flash(); };
  const togglePlatform = (platform: PlatformId) => {
    const platforms = new Set(cfg.defaultPlatforms);
    platforms.has(platform) ? platforms.delete(platform) : platforms.add(platform);
    update({ defaultPlatforms: Array.from(platforms) });
  };
  const checkConnection = async () => {
    setChecking(true);
    setConnectionResult(null);
    try {
      const response = await fetch('/api/ai-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ai }),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; model?: string; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || `连接失败（HTTP ${response.status}）`);
      setConnectionResult({ ok: true, message: `${result.model || ai.model} 已连接，可以开始创作。` });
      await refresh();
    } catch (error) {
      setConnectionResult({ ok: false, message: (error as Error).message || 'AI 连接失败' });
    } finally {
      setChecking(false);
    }
  };
  const exportBackup = () => {
    const backup = createBackup(articles, cfg);
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(
      new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' }),
      `omniwriter-backup-${date}.json`,
    );
    setBackupResult({ ok: true, message: `已备份 ${articles.length} 篇文章；API Key 未写入文件。` });
  };
  const importBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    // 防连点：恢复期间文件选择按钮与「正在洗稿/正在生成」属于同一类 UX 风险。
    if (restoring) return;
    setRestoring(true);
    if (file.size > 20 * 1024 * 1024) {
      setBackupResult({ ok: false, message: '备份文件超过 20MB，请确认文件是否正确。' });
      setRestoring(false);
      return;
    }
    try {
      const backup = parseBackup(await file.text());
      const restored = restoreArticles(backup.articles);
      // 把备份里带的 custom Agents 写回 localStorage（saveCustomAgent 内部按 id 去重）。
      // 注意顺序：先 restore CustomAgents 再 reconcile overrides，让调和时能拿到完整 id 集。
      if (backup.customAgents && backup.customAgents.length > 0) {
        restoreCustomAgents(backup.customAgents);
      }
      if (backup.config) {
        const nextConfig = reconcileAgentOverrides(
          { ...DEFAULT_CONFIG, ...backup.config },
          backup.customAgents ?? [],
        );
        saveConfig(nextConfig);
        setCfg(nextConfig);
      }
      setBackupResult(restored.saved
        ? {
            ok: true,
            message: backup.customAgents && backup.customAgents.length > 0
              ? `恢复完成：当前共 ${restored.total} 篇文章 + ${backup.customAgents.length} 个自定义 Agent。重复内容已按更新时间安全合并。`
              : `恢复完成：当前共 ${restored.total} 篇文章。重复稿件已按更新时间安全合并。`,
          }
        : { ok: false, message: '文章已读入，但浏览器存储空间不足，无法安全保存。请先保留备份文件并清理空间。' });
    } catch (error) {
      setBackupResult({ ok: false, message: (error as Error).message || '恢复失败，请检查备份文件。' });
    } finally {
      setRestoring(false);
    }
  };

  const hasClientKey = Boolean(ai.apiKey.trim());
  const connectionName = hasClientKey
    ? ai.baseUrl.includes('minimaxi') ? 'MiniMax · 本地密钥' : '兼容模型 · 本地密钥'
    : aiReady ? '服务器部署配置' : '尚未连接';
  const builtInPlugins = CREATOR_PLUGINS.filter((plugin) => plugin.status === 'built-in');

  return (
    <AppShell>
      <div className="h-full overflow-y-auto bg-ink-panel/20">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-8 sm:py-10">
          <div className="mb-7">
            <h1 className="text-[28px] font-bold tracking-tightish mb-1">设置</h1>
            <p className="text-sm text-ink-muted">连接一次，之后专注创作。所有更改自动保存。</p>
          </div>

          <div role="tablist" aria-label="设置分类" className="flex flex-wrap gap-1 rounded-xl border border-ink-line bg-white p-1.5 mb-7">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn('h-10 px-3 rounded-lg inline-flex items-center gap-1.5 text-sm transition-colors sm:h-9', tab === id ? 'bg-ink text-white' : 'text-ink-soft hover:bg-ink-panel')}>
                <Icon size={14}/>{label}
              </button>
            ))}
            {saved && <span className="ml-auto hidden sm:inline-flex items-center gap-1 px-3 text-xs text-emerald-700"><Check size={12}/>已保存</span>}
          </div>

          {tab === 'ai' && (
            <div className="space-y-4">
              <section className="rounded-2xl border border-ink-line bg-white overflow-hidden">
                <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className={cn('size-11 rounded-xl flex items-center justify-center shrink-0', aiReady ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
                    {aiReady ? <CheckCircle2 size={21}/> : <KeyRound size={20}/>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1"><h2 className="text-base font-semibold">{aiReady ? 'AI 已经准备好' : '连接你的 AI'}</h2><span className={cn('size-2 rounded-full', aiReady ? 'bg-emerald-500' : aiReady === false ? 'bg-amber-500' : 'bg-ink-line')}/></div>
                    <p className="text-[12.5px] text-ink-muted leading-relaxed">{aiReady ? `${connectionName}。所有 Agent 都可以直接生成和适配。` : '连接后即可使用写作 Agent；编辑、排版和导出不依赖 AI。'}</p>
                  </div>
                  <Button variant={aiReady ? 'outline' : 'primary'} onClick={() => setManageAi((open) => !open)} className="shrink-0">{manageAi ? '收起' : aiReady ? '管理连接' : '连接 AI'}</Button>
                </div>

                {manageAi && (
                  <div className="border-t border-ink-line bg-ink-panel/25 p-5 sm:p-6">
                    <div className="max-w-xl space-y-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1"><span className="text-sm font-semibold">使用自己的 API Key</span><span className="text-[10px] rounded-full bg-ink px-2 py-0.5 text-white">推荐</span></div>
                        <p className="text-xs text-ink-muted">默认使用 MiniMax。粘贴密钥后自动保存，不需要重启应用。</p>
                      </div>
                      <Field label="API Key">
                        <Input aria-label="API Key" type="password" value={ai.apiKey} onChange={(event) => updateAi({ apiKey: event.target.value })} placeholder="粘贴 API Key" autoComplete="off" className="h-10 sm:h-9"/>
                      </Field>
                      <details className="rounded-lg border border-ink-line bg-white group">
                        <summary className="cursor-pointer select-none px-3 py-2.5 text-xs font-medium inline-flex items-center gap-1.5"><SlidersHorizontal size={13}/>高级连接设置</summary>
                        <div className="px-3 pb-3 pt-1 border-t border-ink-line space-y-3">
                          <Field label="Base URL"><Input aria-label="Base URL" value={ai.baseUrl} onChange={(event) => updateAi({ baseUrl: event.target.value })} placeholder="https://api.minimaxi.com/anthropic" autoComplete="off"/></Field>
                          <Field label="模型"><Input aria-label="模型" value={ai.model} onChange={(event) => updateAi({ model: event.target.value })} placeholder="MiniMax-M2.7" autoComplete="off"/></Field>
                        </div>
                      </details>
                      <div className="flex flex-wrap items-center gap-3">
                        <Button size="sm" onClick={checkConnection} disabled={checking || (!hasClientKey && !aiReady)}>{checking ? '正在请求模型…' : '测试真实连接'}</Button>
                        <span className="text-[11px] text-ink-muted">密钥保存在当前浏览器，只在生成请求时交给本应用服务端调用模型。</span>
                      </div>
                      {connectionResult && (
                        <div className={cn('rounded-lg border px-3 py-2 text-xs', connectionResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700')}>
                          {connectionResult.message}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-ink-line bg-white p-5">
                <div className="flex items-start gap-3"><RadioTower size={16} className="mt-0.5 text-ink-muted"/><div><h3 className="text-sm font-semibold mb-1">部署配置会被自动识别</h3><p className="text-xs leading-relaxed text-ink-muted">如果部署环境已经设置模型密钥，OmniWriter 会直接显示“AI 已准备好”。普通用户不需要看到 Base URL、协议或模型 ID。</p></div></div>
              </section>
            </div>
          )}

          {tab === 'writing' && (
            <SettingsPanel title="写作默认值" description="Agent 会先使用自己的专业预设；没有指定时，再使用这些默认偏好。">
              <Field label="默认风格" onReset={() => update({ voice: DEFAULT_CONFIG.voice })}><Select aria-label="默认风格" value={cfg.voice} onChange={(event) => update({ voice: event.target.value as Voice })}>{WRITING_STYLES.map((style) => <option key={style.id} value={style.id}>{style.name} · {style.tagline}</option>)}</Select></Field>
              <label className="flex items-center gap-2 text-sm text-ink-soft"><input type="checkbox" checked={cfg.bilingual} onChange={(event) => update({ bilingual: event.target.checked })} className="h-4 w-4 accent-ink"/>默认生成中英双语</label>
              <Field label="系列标题前缀" onReset={() => update({ seriesTitle: '' })}><Input aria-label="系列标题前缀" value={cfg.seriesTitle} onChange={(event) => update({ seriesTitle: event.target.value })} placeholder="如 Vibe Coding｜；留空则不用"/></Field>
              <Field label="作者署名" onReset={() => update({ authorSignature: '' })}><Input aria-label="作者署名" value={cfg.authorSignature} onChange={(event) => update({ authorSignature: event.target.value })} placeholder="如 陈放 Frank"/></Field>
            </SettingsPanel>
          )}

          {tab === 'publishing' && (
            <div className="space-y-4">
              <SettingsPanel title="默认发布平台" description="新建空白文章时默认选中；Agent 仍会根据任务给出更合适的平台组合。">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-1.5">{PLATFORM_ORDER.map((platform) => <button key={platform} onClick={() => togglePlatform(platform)} className={cn('h-10 px-3 rounded-full text-sm border transition-colors sm:h-7 sm:px-2.5 sm:text-xs', cfg.defaultPlatforms.includes(platform) ? 'bg-ink text-white border-ink' : 'bg-white text-ink-soft border-ink-line hover:border-ink')}>{PLATFORMS[platform].label}</button>)}</div>
                  <button type="button" onClick={() => update({ defaultPlatforms: [...DEFAULT_CONFIG.defaultPlatforms] })} className="text-[11px] text-indigo-700 hover:underline shrink-0">恢复默认</button>
                </div>
              </SettingsPanel>
              <SettingsPanel title="公众号排版" description="应用到实时预览、富文本复制和离线发布包。">
                <Field label="默认模板" onReset={() => update({ defaultTemplateId: DEFAULT_CONFIG.defaultTemplateId })}><Select aria-label="默认模板" value={cfg.defaultTemplateId} onChange={(event) => update({ defaultTemplateId: event.target.value })}>{WECHAT_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.tagline}</option>)}</Select></Field>
                <Field label="普通文章 Eyebrow" onReset={() => update({ wechatEyebrow: DEFAULT_CONFIG.wechatEyebrow })}><Input aria-label="普通文章 Eyebrow" value={cfg.wechatEyebrow} onChange={(event) => update({ wechatEyebrow: event.target.value })}/></Field>
                <Field label="新闻文章 Eyebrow" onReset={() => update({ newsEyebrow: DEFAULT_CONFIG.newsEyebrow })}><Input aria-label="新闻文章 Eyebrow" value={cfg.newsEyebrow} onChange={(event) => update({ newsEyebrow: event.target.value })}/></Field>
              </SettingsPanel>
            </div>
          )}

          {tab === 'capabilities' && (
            <div className="space-y-4">
              <section className="rounded-2xl border border-ink-line bg-white p-5 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-5">
                  <div className="size-11 rounded-xl bg-ink-panel flex items-center justify-center"><Blocks size={20}/></div>
                  <div className="flex-1"><h2 className="text-base font-semibold mb-1">{builtInPlugins.length} 个插件已启用</h2><p className="text-xs text-ink-muted">它们由 Agent 自动调用，覆盖素材读取、质量校验、图片排版和发布导出。</p></div>
                  <Link href="/marketplace" className="h-8 px-3 rounded-md border border-ink-line inline-flex items-center justify-center gap-1.5 text-sm font-medium hover:bg-ink-panel">打开能力市场 <ArrowRight size={13}/></Link>
                </div>
                <div className="divide-y divide-ink-line border-y border-ink-line">
                  {builtInPlugins.map((plugin) => <div key={plugin.id} className="py-3 flex items-center gap-3"><div className="size-7 rounded-md bg-ink-panel flex items-center justify-center"><Check size={13}/></div><div className="min-w-0 flex-1"><div className="text-sm font-medium">{plugin.name}</div><div className="text-[11px] text-ink-muted truncate">{plugin.capability}</div></div><span className="text-[11px] text-emerald-700">已启用</span></div>)}
                </div>
              </section>
              <p className="text-xs text-ink-muted px-1">插件增强 Agent 的能力，但不会改变“素材 → 母稿 → 编辑 → 平台适配 → 发布”的主流程。</p>
            </div>
          )}

          {tab === 'data' && (
            <div className="space-y-4">
              <section className="rounded-2xl border border-ink-line bg-white p-5 sm:p-6">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                  <div className="size-11 shrink-0 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center"><ShieldCheck size={20}/></div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base font-semibold mb-1">稿件可带走，也可恢复</h2>
                    <p className="text-xs leading-relaxed text-ink-muted">当前浏览器保存了 {articles.length} 篇文章。备份包含文章、平台稿、模板、创作偏好，以及你自己孵化的写作 Agent，不包含 API Key。</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={exportBackup} variant="primary" disabled={restoring}><Download size={14}/>导出全部备份</Button>
                    <Button onClick={() => backupInputRef.current?.click()} variant="outline" disabled={restoring}><Upload size={14}/>{restoring ? '恢复中…' : '恢复备份'}</Button>
                    <input ref={backupInputRef} type="file" accept="application/json,.json" onChange={importBackup} className="sr-only" aria-label="选择 OmniWriter 备份文件"/>
                  </div>
                </div>
                {backupResult && (
                  <div role="status" className={cn('mt-5 rounded-lg border px-3 py-2.5 text-xs', backupResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700')}>
                    {backupResult.message}
                  </div>
                )}
              </section>
              <section className="rounded-xl border border-ink-line bg-white p-5">
                <h3 className="text-sm font-semibold mb-1">恢复不会覆盖较新的稿件</h3>
                <p className="text-xs leading-relaxed text-ink-muted">相同文章按最后更新时间合并；备份中的旧版本不会覆盖浏览器里的新版本。你可以先导出一次，再放心恢复其他设备的备份。</p>
              </section>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function SettingsPanel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-ink-line bg-white p-5 sm:p-6"><h2 className="text-base font-semibold tracking-tightish mb-1">{title}</h2><p className="text-xs leading-relaxed text-ink-muted mb-5">{description}</p><div className="max-w-xl space-y-4">{children}</div></section>;
}

function Field({ label, children, onReset }: { label: string; children: React.ReactNode; onReset?: () => void }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="block text-xs font-medium text-ink-soft">{label}</label>
        {onReset && (
          <button type="button" onClick={onReset} className="text-[11px] text-indigo-700 hover:underline">恢复默认</button>
        )}
      </div>
      {children}
    </div>
  );
}
