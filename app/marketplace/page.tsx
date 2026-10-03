'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Archive,
  Blocks,
  Bot,
  Check,
  FileImage,
  Fingerprint,
  Github,
  LayoutTemplate,
  Link as LinkIcon,
  Palette,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  WandSparkles,
  ArrowRight,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useArticleStore } from '@/src/lib/store';
import { AGENTS, GROUP_LABELS, mergeBrief } from '@/src/lib/agents';
import type { WriterAgent } from '@/src/lib/agents';
import { CREATOR_PLUGIN_MAP, CREATOR_PLUGINS, PLUGIN_GROUP_LABELS } from '@/src/lib/plugins';
import type { CreatorPlugin } from '@/src/lib/plugins';
import { PLATFORMS } from '@/src/lib/platforms';
import { resolveWritingStyle, STYLE_GROUP_LABELS, WRITING_STYLES } from '@/src/lib/styles';
import type { WritingStylePreset } from '@/src/lib/styles';
import { loadConfig, saveConfig, getAgentOverride, clearAgentOverride } from '@/src/lib/config';
import { listCustomAgents, mergeCustomAgents, removeCustomAgent } from '@/src/lib/custom-agents';
import type { CustomAgent } from '@/src/lib/custom-agents';
import type { AgentOverride, Voice } from '@/src/lib/types';
import { cn } from '@/components/ui/cn';
import { WECHAT_TEMPLATES } from '@/src/lib/templates';
import type { WechatTemplate } from '@/src/lib/templates';
import { TemplateMiniature } from '@/components/TemplateMiniature';
import { AgentConfigDialog } from '@/components/AgentConfigDialog';
import { AgentStudio } from '@/components/AgentStudio';

type MarketTab = 'agents' | 'styles' | 'templates' | 'plugins';

const PLUGIN_ICONS = {
  link: LinkIcon,
  shield: ShieldCheck,
  layout: LayoutTemplate,
  image: FileImage,
  send: Send,
  archive: Archive,
  search: Search,
  github: Github,
  fingerprint: Fingerprint,
};

export default function MarketplacePage() {
  const router = useRouter();
  const create = useArticleStore((s) => s.create);
  const [tab, setTab] = React.useState<MarketTab>('agents');
  const [query, setQuery] = React.useState('');
  const [defaultStyle, setDefaultStyle] = React.useState<Voice | null>(null);
  const [defaultTemplate, setDefaultTemplate] = React.useState('graphite');
  const [notice, setNotice] = React.useState<string | null>(null);
  const [overrides, setOverrides] = React.useState<Record<string, AgentOverride>>({});
  const [configuring, setConfiguring] = React.useState<WriterAgent | null>(null);
  const [customAgents, setCustomAgents] = React.useState<CustomAgent[]>([]);
  const [studioOpen, setStudioOpen] = React.useState(false);

  React.useEffect(() => {
    const config = loadConfig();
    setDefaultStyle(config.marketStyleId ?? null);
    setDefaultTemplate(config.defaultTemplateId);
    setOverrides(config.agentOverrides ?? {});
    setCustomAgents(listCustomAgents());
  }, []);

  React.useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    if (requestedTab === 'agents' || requestedTab === 'styles' || requestedTab === 'templates' || requestedTab === 'plugins') {
      setTab(requestedTab);
    }
  }, []);

  const useAgent = (agent: WriterAgent) => {
    const override = getAgentOverride(agent.id);
    const effectiveVoice = defaultStyle ?? override?.defaults?.voice ?? agent.defaults.voice ?? 'relaxed';
    // 用户定制的默认选项随 mergeBrief 的 custom 进入新文章的 Brief
    const article = create(mergeBrief(agent, undefined, { ...override?.defaults, voice: effectiveVoice }));
    useArticleStore.getState().update(article.id, {
      conversation: [{
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `已装配「${agent.name}」流程：使用${resolveWritingStyle(effectiveVoice).name}风格，目标平台会按需生成，内置能力自动调用。把素材放进来就可以开始。`,
        createdAt: Date.now(),
      }],
    });
    router.push(`/article/${article.id}?step=brief&from=market`);
  };

  const onConfigured = (agent: WriterAgent, saved: boolean) => {
    setConfiguring(null);
    setOverrides(loadConfig().agentOverrides ?? {});
    if (saved) setNotice(`「${agent.name}」的配置已更新，之后用此流程创作会按你的设置来。`);
  };

  const onStudioClose = (saved: CustomAgent | null) => {
    setStudioOpen(false);
    setCustomAgents(listCustomAgents());
    if (saved) setNotice(`「${saved.name}」已保存到能力市场，和内置 Agent 一样可用来创作。`);
  };

  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);
  const pendingDeleteTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    pendingDeleteTimer.current = setTimeout(() => setPendingDeleteId(null), 3000);
    return () => {
      if (pendingDeleteTimer.current) clearTimeout(pendingDeleteTimer.current);
    };
  }, [pendingDeleteId]);

  const onDeleteCustom = React.useCallback((agent: CustomAgent) => {
    if (pendingDeleteId === agent.id) {
      removeCustomAgent(agent.id);
      clearAgentOverride(agent.id); // 连同该 Agent 的配置 override 一起清掉，不留孤儿数据
      setCustomAgents(listCustomAgents());
      setNotice(`已删除「${agent.name}」。`);
      setPendingDeleteId(null);
      return;
    }
    setPendingDeleteId(agent.id);
  }, [pendingDeleteId]);

  const normalized = query.trim().toLowerCase();
  const agents = mergeCustomAgents(AGENTS, customAgents).filter((agent) =>
    !normalized || `${agent.name} ${agent.tagline} ${agent.description}`.toLowerCase().includes(normalized),
  );
  const plugins = CREATOR_PLUGINS.filter((plugin) =>
    !normalized || `${plugin.name} ${plugin.description} ${plugin.capability}`.toLowerCase().includes(normalized),
  );
  const styles = WRITING_STYLES.filter((style) =>
    !normalized || `${style.name} ${style.tagline} ${style.description} ${style.bestFor.join(' ')}`.toLowerCase().includes(normalized),
  );
  const templates = WECHAT_TEMPLATES.filter((template) =>
    !normalized || `${template.name} ${template.tagline} ${template.description} ${template.tags.join(' ')}`.toLowerCase().includes(normalized),
  );
  const makeDefaultStyle = (style: WritingStylePreset) => {
    const config = loadConfig();
    saveConfig({ ...config, voice: style.id, marketStyleId: style.id });
    setDefaultStyle(style.id);
    setNotice(`已将「${style.name}」设为新内容的默认写作风格。现有文章不会被覆盖。`);
  };
  const clearDefaultStyle = () => {
    const config = loadConfig();
    const { marketStyleId: _marketStyleId, ...rest } = config;
    saveConfig(rest);
    setDefaultStyle(null);
    setNotice('已恢复自动选择：以后由 Agent 和创作意图决定写作风格。');
  };
  const makeDefaultTemplate = (template: WechatTemplate) => {
    const config = loadConfig();
    saveConfig({ ...config, defaultTemplateId: template.id });
    setDefaultTemplate(template.id);
    setNotice(`已将「${template.name}」设为新内容的默认公众号模板。现有文章可在成品预览中单独切换。`);
  };

  return (
    <AppShell>
      <div className="h-full overflow-y-auto bg-ink-panel/25">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-8 sm:py-10">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 mb-8">
            <div>
              <div className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[1.4px] text-ink-muted mb-3">
                <Blocks size={13}/> OmniWriter 能力市场
              </div>
              <h1 className="text-[28px] sm:text-[32px] font-bold tracking-tightish leading-tight mb-2">按需要组合能力，不用自己搭工作流</h1>
              <p className="max-w-2xl text-sm leading-relaxed text-ink-soft">
                市场不是另一个创作入口。Agent 用来带预设新建任务；风格和模板成为新内容默认；插件由系统按需自动调用。
              </p>
            </div>
            <div className="w-full lg:w-[280px]">
              <Input aria-label="搜索能力市场" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 Agent、风格、模板或插件…" className="h-10 bg-white sm:h-9"/>
            </div>
          </div>

          <section aria-label="能力市场使用方法" className="mb-6 rounded-2xl border border-ink-line bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
              <div className="flex items-center gap-3 lg:w-48 lg:shrink-0">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink text-white"><WandSparkles size={17}/></span>
                <div><h2 className="text-sm font-semibold text-ink">怎么组合</h2><p className="mt-0.5 text-xs text-ink-muted">选择是可选的，创作台也会自动判断</p></div>
              </div>
              <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
                <MarketGuideStep index="1" title="Agent" detail="带预设新建任务"/>
                <MarketGuideStep index="2" title="风格" detail="设为以后默认"/>
                <MarketGuideStep index="3" title="模板" detail="设为以后默认"/>
                <MarketGuideStep index="4" title="插件" detail="执行时自动调用"/>
              </div>
              <button type="button" onClick={() => router.push('/')} className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-ink px-4 text-xs font-semibold text-white hover:bg-ink-soft">
                回创作台 <ArrowRight size={13}/>
              </button>
            </div>
          </section>

          {notice && (
            <div role="status" className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <span className="inline-flex items-center gap-1.5"><Check size={13}/>{notice}</span>
              <button type="button" onClick={() => setNotice(null)} className="min-h-10 shrink-0 rounded-lg px-2 font-medium hover:bg-white sm:min-h-8">知道了</button>
            </div>
          )}

          <div role="tablist" aria-label="能力类型" className="flex w-full sm:w-auto max-w-full overflow-x-auto rounded-lg border border-ink-line bg-white p-1 mb-3">
            <MarketTabButton active={tab === 'agents'} onClick={() => setTab('agents')} icon={<Bot size={14}/>} label={`Agent · ${AGENTS.length + customAgents.length}`}/>
            <MarketTabButton active={tab === 'styles'} onClick={() => setTab('styles')} icon={<Palette size={14}/>} label={`风格 · ${WRITING_STYLES.length}`}/>
            <MarketTabButton active={tab === 'templates'} onClick={() => setTab('templates')} icon={<LayoutTemplate size={14}/>} label={`模板 · ${WECHAT_TEMPLATES.length}`}/>
            <MarketTabButton active={tab === 'plugins'} onClick={() => setTab('plugins')} icon={<Blocks size={14}/>} label={`插件 · ${CREATOR_PLUGINS.length}`}/>
          </div>

          <div className="mb-7 flex min-h-10 items-center justify-between gap-3 rounded-xl border border-ink-line bg-white px-3 py-2 text-xs leading-relaxed text-ink-muted">
            <span>{tab === 'agents' ? '选择一个 Agent 会立即新建内容，并带入适合的写作方式、平台和内置能力。' : tab === 'styles' ? '设为通用默认后，只影响之后新建的内容；每篇文章仍可单独调整。' : tab === 'templates' ? '设为默认后，新内容的公众号预览、富文本复制和 ZIP 导出会使用该模板。' : '已启用插件无需安装或手动添加；Agent 会在读取素材、质检、配图、分发和导出时自动调用。'}</span>
            {tab === 'styles' && defaultStyle && <button type="button" onClick={clearDefaultStyle} className="min-h-10 shrink-0 rounded-lg px-2 font-medium text-ink hover:bg-white sm:min-h-8">恢复自动选择</button>}
          </div>

          {tab === 'agents' ? (
            <div className="space-y-8">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-ink-line bg-ink-panel/50 px-4 py-3">
                <p className="text-[12px] leading-relaxed text-ink-soft">没有合手的流程？喂几篇范文，孵化一个只属于你的写作 Agent。</p>
                <Button size="sm" onClick={() => setStudioOpen(true)} className="shrink-0"><Plus size={13}/>创建 Agent</Button>
              </div>
              {Object.entries(GROUP_LABELS).map(([group, label]) => {
                const items = agents.filter((agent) => agent.group === group);
                if (!items.length) return null;
                return (
                  <section key={group}>
                    <div className="flex items-baseline gap-2 mb-3">
                      <h2 className="text-sm font-semibold">{label}</h2>
                      <span className="text-xs text-ink-muted">{items.length} 个创作流程</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {items.map((agent) => (
                        <AgentMarketCard
                          key={agent.id}
                          agent={agent}
                          override={overrides[agent.id]}
                          onUse={() => useAgent(agent)}
                          onConfigure={() => setConfiguring(agent)}
                          onDelete={agent.id.startsWith('custom-') ? () => onDeleteCustom(agent as CustomAgent) : undefined}
                          deletePending={pendingDeleteId === agent.id}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
              {agents.length === 0 && <EmptySearch/>}
            </div>
          ) : tab === 'styles' ? (
            <div className="space-y-8">
              {Object.entries(STYLE_GROUP_LABELS).map(([group, label]) => {
                const items = styles.filter((style) => style.group === group);
                if (!items.length) return null;
                return (
                  <section key={group}>
                    <div className="flex items-baseline gap-2 mb-3">
                      <h2 className="text-sm font-semibold">{label}</h2>
                      <span className="text-xs text-ink-muted">可与任意 Agent 组合</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {items.map((style) => <StyleCard key={style.id} style={style} isDefault={defaultStyle === style.id} onDefault={() => makeDefaultStyle(style)}/>) }
                    </div>
                  </section>
                );
              })}
              {styles.length === 0 && <EmptySearch/>}
            </div>
          ) : tab === 'templates' ? (
            <section>
              <div className="flex items-baseline gap-2 mb-3">
                <h2 className="text-sm font-semibold">公众号排版</h2>
                <span className="text-xs text-ink-muted">预览、复制与导出共用同一模板</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {templates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    isDefault={defaultTemplate === template.id}
                    onDefault={() => makeDefaultTemplate(template)}
                  />
                ))}
              </div>
              {templates.length === 0 && <EmptySearch/>}
            </section>
          ) : (
            <div className="space-y-8">
              {Object.entries(PLUGIN_GROUP_LABELS).map(([group, label]) => {
                const items = plugins.filter((plugin) => plugin.group === group);
                if (!items.length) return null;
                return (
                  <section key={group}>
                    <div className="flex items-baseline gap-2 mb-3">
                      <h2 className="text-sm font-semibold">{label}</h2>
                      <span className="text-xs text-ink-muted">Agent 可调用的创作能力</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {items.map((plugin) => <PluginCard key={plugin.id} plugin={plugin}/>)}
                    </div>
                  </section>
                );
              })}
              {plugins.length === 0 && <EmptySearch/>}
            </div>
          )}
        </div>
      </div>
      {configuring && <AgentConfigDialog agent={configuring} onClose={(saved) => onConfigured(configuring, saved)}/>}
      {studioOpen && <AgentStudio onClose={onStudioClose}/>}
    </AppShell>
  );
}

function TemplateCard({ template, isDefault, onDefault }: { template: WechatTemplate; isDefault: boolean; onDefault: () => void }) {
  return (
    <article className={cn('flex flex-col overflow-hidden rounded-xl border bg-white transition-colors', isDefault ? 'border-ink shadow-[inset_0_0_0_1px_#1d1d1f]' : 'border-ink-line')}>
      <div className="h-44 overflow-hidden p-4 flex items-center justify-center" style={{ backgroundColor: template.preview.background }}>
        <TemplateMiniature template={template} scale={0.61}/>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">{template.name}</h3><p className="text-xs text-ink-muted mt-0.5">{template.tagline}</p></div>
          <span className="text-xs rounded-full border border-ink-line px-2 py-0.5 text-ink-muted">{template.status === 'built-in' ? '内置' : '市场'}</span>
        </div>
        <p className="mt-3 text-[12.5px] text-ink-soft leading-relaxed">{template.description}</p>
        <div className="mt-3 flex flex-wrap gap-1">{template.tags.map((tag) => <span key={tag} className="rounded-full bg-ink-panel px-2 py-0.5 text-xs text-ink-muted">{tag}</span>)}</div>
        <div className="mt-4 pt-3 border-t border-ink-line flex justify-end">
          <Button size="sm" variant={isDefault ? 'secondary' : 'outline'} onClick={onDefault} disabled={isDefault}>{isDefault ? <><Check size={12}/>默认模板</> : '设为默认'}</Button>
        </div>
      </div>
    </article>
  );
}

function StyleCard({ style, isDefault, onDefault }: { style: WritingStylePreset; isDefault: boolean; onDefault: () => void }) {
  return (
    <article className={cn('flex flex-col rounded-xl border bg-white p-4 transition-colors', isDefault ? 'border-ink shadow-[inset_0_0_0_1px_#1d1d1f]' : 'border-ink-line')}>
      <div className="flex items-start gap-3 mb-3">
        <div className="size-10 shrink-0 rounded-lg bg-ink-panel flex items-center justify-center text-sm font-semibold font-mono">{style.symbol}</div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{style.name}</h3>
          <p className="text-xs text-ink-muted mt-0.5">{style.tagline}</p>
        </div>
        {isDefault && <span className="ml-auto text-xs rounded-full bg-ink px-2 py-0.5 text-white">默认</span>}
      </div>
      <p className="text-[12.5px] text-ink-soft leading-relaxed mb-3">{style.description}</p>
      <blockquote className="rounded-lg bg-ink-panel/70 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-soft mb-3">“{style.sample}”</blockquote>
      <div className="flex flex-wrap gap-1 mb-4">{style.bestFor.map((item) => <span key={item} className="rounded-full border border-ink-line px-2 py-0.5 text-xs text-ink-muted">{item}</span>)}</div>
      <div className="mt-auto pt-3 border-t border-ink-line flex items-center justify-between gap-3">
        <span className="text-xs text-ink-muted truncate">{style.sourceNote}</span>
        <Button size="sm" variant={isDefault ? 'secondary' : 'outline'} onClick={onDefault} disabled={isDefault} className="shrink-0">{isDefault ? <><Check size={12}/>通用默认</> : '设为通用默认'}</Button>
      </div>
    </article>
  );
}

function MarketTabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick} className={cn('h-10 px-3 rounded-md inline-flex shrink-0 items-center gap-1.5 text-sm transition-colors sm:h-8', active ? 'bg-ink text-white' : 'text-ink-soft hover:bg-ink-panel')}>
      {icon}{label}
    </button>
  );
}

function AgentMarketCard({ agent, override, onUse, onConfigure, onDelete, deletePending }: { agent: WriterAgent; override?: AgentOverride; onUse: () => void; onConfigure: () => void; onDelete?: () => void; deletePending?: boolean }) {
  const isCustom = agent.id.startsWith('custom-');
  const customized = Boolean(override && (override.directive !== undefined || Object.keys(override.defaults ?? {}).length > 0));
  const effectiveVoice = override?.defaults?.voice ?? agent.defaults.voice ?? 'relaxed';
  const effectivePlatforms = override?.defaults?.platforms ?? agent.defaults.platforms ?? [];
  const writingStyle = resolveWritingStyle(effectiveVoice);
  return (
    <article className="group flex flex-col rounded-xl border border-ink-line bg-white p-4 hover:border-ink/70 hover:shadow-sm transition-all">
      <div className="flex items-start gap-3 mb-3">
        <div className="size-10 shrink-0 rounded-lg bg-ink-panel flex items-center justify-center text-xl">{agent.emoji}</div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-snug">{agent.name}</h3>
          <p className="text-xs text-ink-muted mt-0.5">{agent.tagline}</p>
        </div>
        {isCustom
          ? <span className="ml-auto text-xs rounded-full bg-ink-panel px-2 py-0.5 text-ink">自定义</span>
          : customized
            ? <span className="ml-auto text-xs rounded-full bg-ink-panel px-2 py-0.5 text-ink">已定制</span>
            : <span className="ml-auto text-xs rounded-full border border-ink-line px-2 py-0.5 text-ink-muted">内置</span>}
      </div>
      <p className="text-[12.5px] text-ink-soft leading-relaxed mb-3">{agent.description}</p>
      <div className="flex flex-wrap gap-1 mb-4">
        <span className="rounded-full bg-ink text-white px-2 py-0.5 text-xs">{writingStyle.name}</span>
        {effectivePlatforms.slice(0, 4).map((platform) => (
          <span key={platform} className="rounded-full bg-ink-panel px-2 py-0.5 text-xs text-ink-soft">{PLATFORMS[platform].label}</span>
        ))}
        {effectivePlatforms.length > 4 && <span className="rounded-full bg-ink-panel px-2 py-0.5 text-xs text-ink-muted">+{effectivePlatforms.length - 4}</span>}
      </div>
      {agent.pluginIds.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1">
          <span className="text-xs text-ink-muted mr-0.5">调用</span>
          {agent.pluginIds.slice(0, 3).map((id) => CREATOR_PLUGIN_MAP[id]).filter(Boolean).map((plugin) => (
            <span key={plugin.id} className="rounded-full border border-ink-line px-2 py-0.5 text-xs text-ink-soft">{plugin.name}</span>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 pt-3 border-t border-ink-line">
        <span className="text-xs text-ink-muted truncate pr-1">{agent.inputHint}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {onDelete && (
            <Button size="sm" variant="ghost" onClick={onDelete} aria-label={deletePending ? `再次点击确认删除 ${agent.name}` : `删除 ${agent.name}`} title={deletePending ? '再次点击以确认删除（3 秒内有效）' : '删除这个自定义 Agent'} className={cn(deletePending && 'bg-red-50 text-red-600 ring-1 ring-red-200')}><Trash2 size={13}/></Button>
          )}
          <Button size="sm" variant="ghost" onClick={onConfigure} aria-label={`配置 ${agent.name}`} title="配置提示词和默认选项"><Settings2 size={13}/><span className="hidden sm:inline">配置</span></Button>
          <Button size="sm" onClick={onUse}><Sparkles size={13}/>用此流程创作</Button>
        </div>
      </div>
    </article>
  );
}

function PluginCard({ plugin }: { plugin: CreatorPlugin }) {
  const Icon = PLUGIN_ICONS[plugin.icon];
  const builtIn = plugin.status === 'built-in';
  return (
    <article className={cn('flex flex-col rounded-xl border bg-white p-4', builtIn ? 'border-ink-line' : 'border-dashed border-ink-line')}>
      <div className="flex items-start gap-3 mb-3">
        <div className="size-9 shrink-0 rounded-lg bg-ink-panel flex items-center justify-center"><Icon size={17}/></div>
        <div>
          <h3 className="text-sm font-semibold">{plugin.name}</h3>
          <p className="text-xs text-ink-muted mt-0.5">{plugin.capability}</p>
        </div>
      </div>
      <p className="text-[12.5px] text-ink-soft leading-relaxed mb-4">{plugin.description}</p>
      <div className="mt-auto pt-3 border-t border-ink-line flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-ink-muted">{PLUGIN_GROUP_LABELS[plugin.group]}</span>
        {builtIn ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><Check size={12}/>自动调用</span>
        ) : (
          <span className="text-xs text-ink-muted">即将开放</span>
        )}
      </div>
    </article>
  );
}

function EmptySearch() {
  return <div className="rounded-xl border border-dashed border-ink-line bg-white py-16 text-center text-sm text-ink-muted">没有找到匹配的能力，换个关键词试试。</div>;
}

function MarketGuideStep({ index, title, detail }: { index: string; title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-ink-line bg-white px-3 py-2.5">
      <div className="flex items-center gap-1.5"><span className="flex size-5 items-center justify-center rounded-full bg-ink-panel text-xs font-bold text-ink">{index}</span><span className="text-xs font-semibold text-ink">{title}</span></div>
      <p className="mt-1 text-xs text-ink-muted">{detail}</p>
    </div>
  );
}
