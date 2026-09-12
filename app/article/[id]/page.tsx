'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { AppShell } from '@/components/AppShell';
import { BriefPanel } from '@/components/BriefPanel';
import { AgentCompose } from '@/components/AgentCompose';
import { Editor } from '@/components/Editor';
import { ImageSearchPanel, type CursorImageInsert } from '@/components/ImageSearchPanel';
import { PreviewPane } from '@/components/PreviewPane';
import { PlatformTabs } from '@/components/PlatformTabs';
import { ValidationStrip } from '@/components/ValidationStrip';
import { CreativeCopilot } from '@/components/CreativeCopilot';
import { GenerationProgress } from '@/components/GenerationProgress';
import { useArticleStore } from '@/src/lib/store';
import { loadAiConfig } from '@/src/lib/ai-config';
import { loadConfig, getAgentOverride } from '@/src/lib/config';
import { getCustomAgent } from '@/src/lib/custom-agents';
import { collectContentImages } from '@/src/lib/images';
import { PLATFORMS, PLATFORM_ORDER } from '@/src/lib/platforms';
import type { Brief, CreatorAgentId, PlatformId } from '@/src/lib/types';
import { downloadBlob, htmlToMarkdown, markdownToInlineHtml } from '@/src/lib/export-html';
import { cn } from '@/components/ui/cn';
import { ErrorBanner, useError } from '@/components/ErrorBanner';
import { useAiStatus } from '@/src/lib/use-ai-status';
import type { GenerationStreamEvent, GenerationViewState } from '@/src/lib/generation-events';
import { extractContentTitle, joinBilingualContent, replaceContentTitle, splitBilingualContent, type ContentLanguage } from '@/src/lib/bilingual';
import { LanguageTabs } from '@/components/LanguageTabs';
import { Check, CircleAlert, FileText, Loader2, PencilLine, Save, Send } from 'lucide-react';
import { resolveAgent } from '@/src/lib/agents';
import { WECHAT_TEMPLATES } from '@/src/lib/templates';
import { inferPlatformsFromInstruction } from '@/src/lib/creator-intent';
import { routeCreatorCommand } from '@/src/lib/creator-agents';
import { composeFetchedMaterial, extractHttpUrls, fetchMaterialSources } from '@/src/lib/material-input';
import { validateMarkdown } from '@/src/lib/editorial';

// MiniMax 在同一账号高并发长文本时偶尔会断开连接；2 路并发在速度与稳定性之间更合适。
const PLATFORM_BATCH_CONCURRENCY = 2;
type WorkspaceStep = 'brief' | 'editor' | 'publish';

function initialWorkspaceStep(searchParams: Readonly<URLSearchParams>): WorkspaceStep {
  const step = searchParams.get('step');
  if (step === 'brief' || step === 'editor' || step === 'publish') return step;
  return searchParams.get('write') === '1' ? 'editor' : 'brief';
}

export default function ArticlePage({ params }: { params: { id: string } }) {
  const searchParams = useSearchParams();
  const hydrate = useArticleStore((s) => s.hydrate);
  const hydrated = useArticleStore((s) => s.hydrated);
  const article = useArticleStore((s) => s.articles.find((a) => a.id === params.id));
  const setContent = useArticleStore((s) => s.setContent);
  const setDraft = useArticleStore((s) => s.setDraft);
  const update = useArticleStore((s) => s.update);
  const saveState = useArticleStore((s) => s.saveState);
  const { aiReady } = useAiStatus();

  React.useEffect(() => { hydrate(); }, [hydrate]);

  const [generating, setGenerating] = React.useState(false);
  const [generationProgress, setGenerationProgress] = React.useState<GenerationViewState | null>(null);
  const generationController = React.useRef<AbortController | null>(null);
  const autoGenerateStarted = React.useRef(false);
  const platformBatchController = React.useRef<AbortController | null>(null);
  const platformBatchRunId = React.useRef(0);
  const refineController = React.useRef<AbortController | null>(null);
  const [adapting, setAdapting] = React.useState<PlatformId | null>(null);
  const [batchProgress, setBatchProgress] = React.useState<{ done: number; total: number } | null>(null);
  // 所有尺寸都按阶段一次只显示一个主任务，避免素材、编辑、预览、平台稿同时堆叠。
  const [mobileTab, setMobileTab] = React.useState<WorkspaceStep>(() => initialWorkspaceStep(searchParams));
  const [publishView, setPublishView] = React.useState<'preview' | 'platforms'>('preview');
  const [editorView, setEditorView] = React.useState<'content' | 'images'>('content');
  const [language, setLanguage] = React.useState<ContentLanguage>('zh');
  const [commandBusy, setCommandBusy] = React.useState(false);
  const { error, show: showError, dismiss: dismissError } = useError();
  // 当前激活语言的 TipTap 实例（配图面板在光标处插图用）；导出 ZIP 的防连点标记
  const editorInstanceRef = React.useRef<TiptapEditor | null>(null);
  const exportingRef = React.useRef(false);

  React.useEffect(() => {
    setMobileTab(initialWorkspaceStep(searchParams));
  }, [searchParams]);

  const selectWorkspaceStep = React.useCallback((step: WorkspaceStep) => {
    setMobileTab(step);
    const url = new URL(window.location.href);
    url.searchParams.set('step', step);
    url.searchParams.delete('write');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  // 标签组键盘导航：←/→ 与 Home/End 移动焦点并同时激活对应标签（WAI-ARIA Tabs 自动激活模式）。
  // 因为 tabIndex 由激活态派生，激活后 roving tabindex 会随 aria-selected 一起更新。
  const onTabsKeyDown = React.useCallback((
    event: React.KeyboardEvent<HTMLDivElement>,
    buttons: Array<{ key: string; enabled: boolean }>,
    onSelect: (key: string) => void,
  ) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return;
    const targets = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
      .filter((button) => !button.disabled);
    if (!targets.length) return;
    // 与 targets（已过滤禁用按钮）按相同条件对齐，避免禁用项导致 key 错位
    const enabledButtons = buttons.filter((button) => button.enabled);
    const current = targets.indexOf(document.activeElement as HTMLButtonElement);
    const last = targets.length - 1;
    let next = -1;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if (event.key === 'ArrowRight') next = current === -1 ? 0 : current === last ? 0 : current + 1;
    else next = current === -1 ? last : current === 0 ? last : current - 1;
    event.preventDefault();
    const item = enabledButtons[next];
    if (!item) return;
    targets[next].focus();
    onSelect(item.key);
  }, []);

  // 联网配图：在「当前激活语言」编辑器的光标处插入图片 + 图注段落。
  // 编辑器不可用（已卸载/已销毁）时返回 false，由配图面板降级为文末追加。
  const insertImageAtCursor = React.useCallback((image: CursorImageInsert): boolean => {
    const editor = editorInstanceRef.current;
    if (!editor || editor.isDestroyed) return false;
    editor.chain().focus().insertContent([
      {
        type: 'image',
        attrs: {
          src: image.dataUrl,
          alt: image.alt,
          sourceUrl: image.sourceUrl || null,
          sourceLabel: image.sourceLabel || null,
          imageLicense: image.license || null,
          creator: image.creator || null,
        },
      },
      ...(image.caption ? [{ type: 'paragraph', content: [{ type: 'text', text: image.caption }] }] : []),
    ]).run();
    return true;
  }, []);

  React.useEffect(() => {
    if (!article || language === 'zh') return;
    const parts = splitBilingualContent(article.content);
    if (!article.brief.bilingual && !parts.hasEnglish) setLanguage('zh');
  }, [article, language]);

  React.useEffect(() => () => {
    generationController.current?.abort();
    platformBatchController.current?.abort();
    refineController.current?.abort();
    platformBatchRunId.current += 1;
  }, []);

  React.useEffect(() => {
    autoGenerateStarted.current = false;
  }, [params.id]);

  React.useEffect(() => {
    if (!hydrated || !article || aiReady !== true || searchParams.get('generate') !== '1' || autoGenerateStarted.current) return;
    autoGenerateStarted.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete('generate');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    void onGenerate();
  }, [aiReady, article, hydrated, searchParams]);

  if (!hydrated) {
    return <AppShell><div className="p-10 text-ink-muted text-sm">载入中…</div></AppShell>;
  }
  if (!article) {
    return <AppShell><div className="p-10 text-ink-muted text-sm">文章不存在或已删除。<a href="/" className="underline">返回首页</a></div></AppShell>;
  }

  const onBrief = (brief: Brief) => update(article.id, { brief });
  const onTitle = (title: string) => update(article.id, { title });
  const activeTemplateId = article.templateId ?? loadConfig().defaultTemplateId;
  const onImportMaterial = (material: string) => {
    setContent(article.id, markdownToInlineHtml(material || ''));
    setLanguage('zh');
    if (article.brief.materialType === 'copy') {
      setPublishView('preview');
      selectWorkspaceStep('publish');
    } else {
      selectWorkspaceStep('editor');
    }
  };

  const requestAdapt = async (
    platform: PlatformId,
    snapshot: { brief: Brief; master: string; signal?: AbortSignal; ai: ReturnType<typeof loadAiConfig> },
  ): Promise<string> => {
    const timeoutController = new AbortController();
    let timedOut = false;
    const onCancel = () => timeoutController.abort();
    snapshot.signal?.addEventListener('abort', onCancel, { once: true });
    const timer = window.setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, 90_000);
    try {
      const res = await fetch('/api/adapt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: timeoutController.signal,
        body: JSON.stringify({ brief: snapshot.brief, master: snapshot.master, platform, ai: snapshot.ai }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const { text } = (await res.json()) as { text: string };
      return text;
    } catch (error) {
      if (timedOut) throw new Error(`${PLATFORMS[platform].label}生成超过 90 秒，请单独重试`);
      throw error;
    } finally {
      window.clearTimeout(timer);
      snapshot.signal?.removeEventListener('abort', onCancel);
    }
  };

  const runPlatformBatch = async ({
    brief: briefSnapshot,
    master,
    wechatDraft,
    platforms,
    revealPublish,
  }: {
    brief: Brief;
    master: string;
    wechatDraft: string;
    platforms: PlatformId[];
    revealPublish: boolean;
  }) => {
    const targets = Array.from(new Set(platforms));
    if (!targets.length) return;

    platformBatchController.current?.abort();
    const controller = new AbortController();
    platformBatchController.current = controller;
    const runId = platformBatchRunId.current + 1;
    platformBatchRunId.current = runId;
    const aiSnapshot = loadAiConfig();

    if (revealPublish) {
      selectWorkspaceStep('publish');
      setPublishView('platforms');
    }
    // 注意：不预先清空已有平台稿。生成成功后才用 setDraft 覆盖；
    // 若中途失败或取消，旧稿仍保留，避免批量生成失败导致内容丢失。
    setAdapting(null);
    setBatchProgress({ done: 0, total: targets.length });

    let cursor = 0;
    let completed = 0;
    const failed: PlatformId[] = [];
    const worker = async () => {
      while (!controller.signal.aborted) {
        const index = cursor;
        cursor += 1;
        if (index >= targets.length) return;
        const platform = targets[index];
        try {
          const text = platform === 'wechat'
            ? wechatDraft
            : await requestAdapt(platform, {
              brief: briefSnapshot,
              master,
              signal: controller.signal,
              ai: aiSnapshot,
            });
          if (runId === platformBatchRunId.current && !controller.signal.aborted) {
            setDraft(article.id, platform, text);
          }
        } catch (error) {
          if ((error as Error).name !== 'AbortError') failed.push(platform);
        } finally {
          if (runId === platformBatchRunId.current && !controller.signal.aborted) {
            completed += 1;
            setBatchProgress({ done: completed, total: targets.length });
          }
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(PLATFORM_BATCH_CONCURRENCY, targets.length) },
        () => worker(),
      ),
    );
    if (runId !== platformBatchRunId.current || controller.signal.aborted) return;

    platformBatchController.current = null;
    setBatchProgress(null);
    if (failed.length) {
      showError(`已生成 ${targets.length - failed.length}/${targets.length} 个平台稿；${failed.map((platform) => PLATFORMS[platform].label).join('、')}可单独重试。`);
    }
  };

  async function onGenerate(briefOverride?: Brief) {
    if (!article) return;
    if (generating) return;
    platformBatchController.current?.abort();
    platformBatchController.current = null;
    platformBatchRunId.current += 1;
    setBatchProgress(null);
    const sourceBrief = briefOverride ?? article.brief;
    const briefSnapshot: Brief = { ...sourceBrief, platforms: [...sourceBrief.platforms] };
    // 用户在能力市场对该 Agent 定制的写作指令随请求发给服务端（服务端只认内置静态表）；
    // 自定义 Agent 服务端查不到，directive 也随请求直传
    const directive = getAgentOverride(briefSnapshot.agentId)?.directive ?? getCustomAgent(briefSnapshot.agentId)?.directive;
    const aiSnapshot = loadAiConfig();
    const controller = new AbortController();
    generationController.current = controller;
    const localRequestId = crypto.randomUUID();
    const startedAt = Date.now();
    setGenerating(true);
    setGenerationProgress({
      requestId: localRequestId,
      startedAt,
      stage: 'source',
      label: '正在接收素材',
      chars: 0,
      completed: [],
    });
    let generatedMaster = '';
    try {
      const res = await fetch('/api/generate/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          brief: briefSnapshot,
          material: briefSnapshot.material,
          ai: aiSnapshot,
          config: { seriesTitle: loadConfig().seriesTitle },
          ...(directive ? { directive } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error('浏览器没有收到生成内容');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;
      const applyEvent = (event: GenerationStreamEvent) => {
        // 只接受本请求的 SSE 事件：拒绝迟到/串流的旧请求（重启或上一轮 done 的残余），
        // 避免旧事件把刚开始的生成进度或正文覆盖掉。
        if (event.requestId && event.requestId !== localRequestId) return;
        if (event.type === 'stage') {
          setGenerationProgress((previous) => ({
            requestId: event.requestId,
            startedAt: previous?.startedAt ?? startedAt,
            stage: event.stage,
            label: event.label,
            detail: event.detail,
            chars: previous?.chars ?? 0,
            preview: previous?.preview,
            completed: previous && previous.stage !== event.stage
              ? Array.from(new Set([...previous.completed, previous.stage]))
              : previous?.completed ?? [],
          }));
        } else if (event.type === 'delta') {
          setGenerationProgress((previous) => previous ? {
            ...previous,
            requestId: event.requestId,
            chars: event.chars,
            preview: event.preview,
          } : previous);
        } else if (event.type === 'done') {
          completed = true;
          generatedMaster = event.md;
          setGenerationProgress((previous) => previous ? {
            ...previous,
            stage: 'done',
            label: `已生成并完成基础格式检查 · ${Math.max(1, Math.round(event.durationMs / 1000))} 秒`,
            detail: event.issues ? `发现 ${event.issues} 项编辑提醒，可在发布页查看` : '没有发现格式问题',
            chars: event.md.length,
          } : previous);
          setContent(article.id, markdownToInlineHtml(event.md));
          setLanguage('zh');
          if (event.title) onTitle(event.title);
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';
        for (const chunk of chunks) {
          const data = chunk.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
          if (data) applyEvent(JSON.parse(data) as GenerationStreamEvent);
        }
        if (done) break;
      }
      if (!completed) throw new Error('生成连接提前结束，请重试');
      await new Promise((resolve) => setTimeout(resolve, 500));
      selectWorkspaceStep('editor');
      if (briefSnapshot.platforms.length > 0) {
        void runPlatformBatch({
          brief: briefSnapshot,
          master: generatedMaster,
          wechatDraft: generatedMaster,
          platforms: briefSnapshot.platforms,
          revealPublish: false,
        });
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        showError('已停止生成，原稿没有被覆盖。');
      } else {
        showError((e as Error).message || '生成失败');
      }
    } finally {
      setGenerating(false);
      setGenerationProgress(null);
      generationController.current = null;
    }
  }

  const onCancelGeneration = () => generationController.current?.abort();
  const onCancelPlatformBatch = () => {
    if (!platformBatchController.current) return;
    platformBatchController.current.abort();
    platformBatchController.current = null;
    platformBatchRunId.current += 1;
    setBatchProgress(null);
    showError('已停止生成其余平台稿；已经完成的稿件会保留。');
  };

  const onAdapt = async (p: PlatformId) => {
    if (adapting || batchProgress || platformBatchController.current) return;
    if (aiReady === false) {
      showError('连接 AI 后才能自动适配；你仍然可以在平台稿文本框里手动编辑。');
      return;
    }
    if (!article.content.trim()) {
      showError('先生成或导入母稿，再适配平台。');
      return;
    }
    setAdapting(p);
    try {
      const briefSnapshot: Brief = {
        ...article.brief,
        bilingual: article.brief.bilingual || language === 'en',
        platforms: [...article.brief.platforms],
      };
      const master = htmlToMarkdown(article.content);
      setDraft(article.id, p, p === 'wechat'
        ? master
        : await requestAdapt(p, { brief: briefSnapshot, master, ai: loadAiConfig() }));
    } catch (e) {
      showError((e as Error).message || '适配失败');
    } finally {
      setAdapting(null);
    }
  };

  const onAdaptAll = async () => {
    if (adapting || batchProgress || platformBatchController.current) return;
    if (aiReady === false) {
      showError('请先在设置中连接 AI，再生成全部平台稿。');
      return;
    }
    if (!article.content.trim()) {
      showError('先生成或导入母稿，再生成平台发布包。');
      return;
    }
    const selected = Array.from(new Set(article.brief.platforms));
    if (!selected.length) {
      showError('先在高级选项中选择至少一个发布平台。');
      return;
    }
    const missing = selected.filter((platform) => {
      const parts = splitBilingualContent(article.platformDrafts[platform] ?? '');
      return !(language === 'zh' ? parts.zh : parts.en).trim();
    });
    const platforms = missing.length ? missing : selected;
    const briefSnapshot: Brief = {
      ...article.brief,
      bilingual: article.brief.bilingual || language === 'en',
      platforms: [...article.brief.platforms],
    };
    const master = htmlToMarkdown(article.content);
    await runPlatformBatch({
      brief: briefSnapshot,
      master,
      wechatDraft: master,
      platforms,
      revealPublish: true,
    });
  };

  const onExportZip = async () => {
    // 防连点重复导出（按钮在 PlatformTabs 内，这里用 ref 同步拦截，不等重渲染）
    if (exportingRef.current) return;
    exportingRef.current = true;
    try {
      const cfg = loadConfig();
      // 收集文章内嵌图（blob → dataURL），随导出请求打包进 ZIP
      const images = await collectContentImages(article.content);
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: article.title,
          md: article.content,
          eyebrow: article.brief.materialType === 'news' ? cfg.newsEyebrow : cfg.wechatEyebrow,
          author: cfg.authorSignature,
          images,
          templateId: activeTemplateId,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      downloadBlob(blob, `${slug(article.title)}.zip`);
    } catch (e) {
      showError((e as Error).message || '导出失败');
    } finally {
      exportingRef.current = false;
    }
  };

  const addConversationMessage = (role: 'user' | 'assistant', content: string, agentId?: CreatorAgentId) => {
    const latest = useArticleStore.getState().get(article.id);
    if (!latest) return;
    update(article.id, {
      conversation: [
        ...(latest.conversation ?? []),
        { id: crypto.randomUUID(), role, content, createdAt: Date.now(), ...(agentId ? { agentId } : {}) },
      ],
    });
  };

  const onCreativeCommand = async (rawInstruction: string) => {
    const originalInstruction = rawInstruction.trim();
    const routed = routeCreatorCommand(originalInstruction);
    const { agentId, instruction } = routed;
    if (!instruction || commandBusy || generating || Boolean(batchProgress)) return;
    addConversationMessage('user', originalInstruction);
    setCommandBusy(true);
    try {
      if (agentId === 'researcher') {
        const commandUrls = extractHttpUrls(originalInstruction);
        const materialUrls = extractHttpUrls(article.brief.material);
        const urls = commandUrls.length ? commandUrls : materialUrls;
        selectWorkspaceStep('brief');
        if (!urls.length) {
          addConversationMessage('assistant', '已打开素材区。贴入新闻、项目或参考资料链接，我会读取正文并保留来源。', agentId);
          return;
        }
        if (!commandUrls.length && /## 来源 \d+/.test(article.brief.material)) {
          addConversationMessage('assistant', `素材中已有 ${urls.length} 个来源，我已保留原始链接供写作和核查使用。`, agentId);
          return;
        }
        const sources = await fetchMaterialSources(urls);
        const fetched = sources.filter((source) => Boolean(source.text)).length;
        if (fetched === 0) {
          throw new Error(`链接读取失败，没有取到任何正文（共 ${urls.length} 个）。请确认链接可访问后重试。`);
        }
        const fetchedMaterial = composeFetchedMaterial(commandUrls.length ? originalInstruction : article.brief.material, urls, sources);
        onBrief({
          ...article.brief,
          material: commandUrls.length && article.brief.material.trim()
            ? `${article.brief.material.trim()}\n\n---\n\n${fetchedMaterial}`
            : fetchedMaterial,
        });
        addConversationMessage('assistant', `已读取 ${fetched}/${urls.length} 个来源并补入素材，原始链接也已保留。`, agentId);
        return;
      }

      if (!article.content.trim()) {
        if (/素材|设置|选项/.test(instruction)) {
          selectWorkspaceStep('brief');
          addConversationMessage('assistant', '已打开素材设置。你也可以继续在这里直接补充要求。', agentId);
        } else if (/排版|原文|导入/.test(instruction) && article.brief.material.trim()) {
          onImportMaterial(article.brief.material);
          addConversationMessage('assistant', '已按原文导入，没有调用 AI；可以直接查看排版成品。', agentId);
        } else {
          const isStartCommand = /^(开始|开始生成|生成|按默认方式生成|继续)$/.test(instruction);
          const nextBrief = isStartCommand ? article.brief : {
            ...article.brief,
            material: article.brief.material.trim()
              ? `${article.brief.material.trim()}\n\n## 用户补充\n${instruction}`
              : instruction,
          };
          if (nextBrief !== article.brief) onBrief(nextBrief);
          await onGenerate(nextBrief);
          const generated = useArticleStore.getState().get(article.id)?.content.trim();
          if (generated) addConversationMessage('assistant', '母稿已经生成。接下来直接告诉我怎么改，或让我生成平台发布包。', agentId);
        }
        return;
      }

      if (agentId === 'visual-editor') {
        setEditorView('images');
        selectWorkspaceStep('editor');
        addConversationMessage('assistant', '已打开联网配图，并按文章标题开始查找；插入时会保留来源与许可信息。', agentId);
        return;
      }

      if (agentId === 'qa-editor') {
        const issues = validateMarkdown(article.content);
        setPublishView('preview');
        selectWorkspaceStep('publish');
        const high = issues.filter((issue) => issue.severity === 'high').length;
        addConversationMessage(
          'assistant',
          issues.length
            ? `发布前检查发现 ${issues.length} 项提醒，其中 ${high} 项需要优先处理；已打开质检结果。`
            : '发布前检查通过，没有发现标题、图片命名或常见营销词问题；已打开成品预览。',
          agentId,
        );
        return;
      }

      if (/原稿|正文|编辑/.test(instruction) && /打开|查看|回到|进入/.test(instruction)) {
        selectWorkspaceStep('editor');
        addConversationMessage('assistant', '已打开原稿，修改会自动保存。', agentId);
        return;
      }
      if (/预览|成品|排版效果/.test(instruction) && !/修改|优化|改成/.test(instruction)) {
        setPublishView('preview');
        selectWorkspaceStep('publish');
        addConversationMessage('assistant', '已打开成品预览。模板、手机宽度和复制都在这里。', agentId);
        return;
      }

      const requestedPlatforms = inferPlatformsFromInstruction(instruction);
      if (requestedPlatforms.length > 0 || /平台稿|发布包|全平台|一稿多投/.test(instruction)) {
        if (aiReady === false) throw new Error('连接 AI 后才能生成平台发布包。');
        const targets = requestedPlatforms.length > 0
          ? requestedPlatforms
          : /全平台|一稿多投/.test(instruction) ? [...PLATFORM_ORDER] : [...article.brief.platforms];
        const nextBrief = { ...article.brief, platforms: Array.from(new Set([...article.brief.platforms, ...targets])) };
        onBrief(nextBrief);
        await runPlatformBatch({
          brief: nextBrief,
          master: htmlToMarkdown(article.content),
          wechatDraft: htmlToMarkdown(article.content),
          platforms: targets,
          revealPublish: true,
        });
        addConversationMessage('assistant', `已生成${targets.map((platform) => PLATFORMS[platform].label).join('、')}发布稿，并打开发布包。`, agentId);
        return;
      }

      if (/模板|版式|排版风格/.test(instruction)) {
        const nextTemplate = resolveTemplateFromInstruction(instruction, activeTemplateId);
        update(article.id, { templateId: nextTemplate.id });
        setPublishView('preview');
        selectWorkspaceStep('publish');
        addConversationMessage('assistant', `已切换为「${nextTemplate.name}」模板，并打开成品预览。`, agentId);
        return;
      }

      if (aiReady === false) throw new Error('连接 AI 后才能继续改稿；原稿仍可手动编辑。');
      const refineAbort = new AbortController();
      refineController.current = refineAbort;
      let refineTimedOut = false;
      const refineTimer = window.setTimeout(() => {
        refineTimedOut = true;
        refineAbort.abort();
      }, 90_000);
      let payload: { md?: string; title?: string; error?: string };
      try {
        const res = await fetch('/api/refine', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: refineAbort.signal,
          body: JSON.stringify({
            brief: article.brief,
            master: article.content,
            instruction,
            ai: loadAiConfig(),
          }),
        });
        payload = (await res.json().catch(() => ({}))) as { md?: string; title?: string; error?: string };
        if (!res.ok || !payload.md?.trim()) throw new Error(payload.error || '这次修改没有返回完整稿件');
      } finally {
        window.clearTimeout(refineTimer);
        if (refineController.current === refineAbort) refineController.current = null;
      }
      // 超时或已被更新的操作取代时，不要覆盖当前正文。
      if (refineAbort.signal.aborted) {
        throw new Error(refineTimedOut ? '改稿超过 90 秒，请稍后重试' : '改稿已停止，原稿没有变化');
      }
      if (refineController.current !== null) throw new Error('有新的改稿请求正在处理，本次结果已忽略');
      setContent(article.id, markdownToInlineHtml(payload.md));
      if (payload.title) onTitle(payload.title);
      setLanguage('zh');
      selectWorkspaceStep('editor');

      const existingPlatforms = PLATFORM_ORDER.filter((platform) => Boolean(article.platformDrafts[platform]?.trim()));
      addConversationMessage(
        'assistant',
        existingPlatforms.length > 0
          ? `已按“${instruction}”更新完整母稿，正在同步 ${existingPlatforms.length} 个已有平台稿。`
          : `已按“${instruction}”更新完整母稿。你可以继续改，不需要重新开始。`,
        agentId,
      );
      if (existingPlatforms.length > 0) {
        void runPlatformBatch({
          brief: article.brief,
          master: payload.md,
          wechatDraft: payload.md,
          platforms: existingPlatforms,
          revealPublish: false,
        });
      }
    } catch (reason) {
      const message = (reason as Error).message || '这次操作没有完成，请重试';
      showError(message);
      addConversationMessage('assistant', message, agentId);
    } finally {
      setCommandBusy(false);
    }
  };

  const briefPanel = article.brief.agentId && (resolveAgent(article.brief.agentId) ?? getCustomAgent(article.brief.agentId)) ? (
    <AgentCompose brief={article.brief} onChange={onBrief} onGenerate={onGenerate} onImportMaterial={onImportMaterial} onError={showError} generating={generating} generationProgress={generationProgress} onCancelGeneration={onCancelGeneration} />
  ) : (
    <BriefPanel brief={article.brief} onChange={onBrief} onGenerate={onGenerate} onImportMaterial={onImportMaterial} onError={showError} generating={generating} generationProgress={generationProgress} onCancelGeneration={onCancelGeneration} />
  );

  const contentParts = splitBilingualContent(article.content);
  const showLanguageTabs = article.brief.bilingual || contentParts.hasEnglish;
  const selectedContent = language === 'zh' ? contentParts.zh : contentParts.en;
  const selectedTitle = extractContentTitle(selectedContent) ?? (language === 'zh' ? article.title : '');
  const renderedTitle = selectedTitle || (language === 'zh' ? article.title : 'English Version');
  const updateSelectedContent = (next: string) => {
    const zh = language === 'zh' ? next : contentParts.zh;
    const en = language === 'en' ? next : contentParts.en;
    setContent(article.id, joinBilingualContent(zh, en, contentParts.separator));
    if (language === 'zh') {
      const nextTitle = extractContentTitle(next);
      if (nextTitle !== null && nextTitle !== article.title) onTitle(nextTitle);
    }
  };
  const updateSelectedTitle = (nextTitle: string) => {
    const nextContent = replaceContentTitle(selectedContent, nextTitle);
    const zh = language === 'zh' ? nextContent : contentParts.zh;
    const en = language === 'en' ? nextContent : contentParts.en;
    setContent(article.id, joinBilingualContent(zh, en, contentParts.separator));
    if (language === 'zh') onTitle(nextTitle);
  };

  const editorPanel = (
    <>
      <div className="px-5 sm:px-6 pt-4 pb-3 border-b border-ink-line/80 bg-white/85 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <input
            value={selectedTitle}
            onChange={(e) => updateSelectedTitle(e.target.value)}
            aria-label={language === 'zh' ? '中文标题' : 'English title'}
            placeholder={language === 'zh' ? '中文标题' : 'English title'}
            className="min-h-10 min-w-0 flex-1 text-[22px] font-bold tracking-tightish bg-transparent focus:outline-none placeholder:text-ink-muted sm:min-h-0"
          />
          {batchProgress && (
            <button
              type="button"
              onClick={onCancelPlatformBatch}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
              title="停止生成其余平台稿"
            >
              <Loader2 size={12} className="animate-spin"/> 平台稿 {batchProgress.done}/{batchProgress.total} · 停止
            </button>
          )}
          {!batchProgress && article.content.trim() && (
            <button
              type="button"
              onClick={() => { setPublishView('preview'); selectWorkspaceStep('publish'); }}
              className="min-h-10 shrink-0 inline-flex items-center gap-1.5 rounded-full bg-ink-panel px-3 text-[11px] font-medium text-ink-soft hover:bg-slate-200 sm:min-h-0 sm:px-2.5 sm:py-1.5"
              title="查看自动排版后的公众号成品"
            >
              <Check size={12}/><span className="hidden sm:inline">排版预览</span><span className="sm:hidden">预览</span>
            </button>
          )}
          <div
            className={cn(
              'inline-flex shrink-0 items-center gap-1 text-[11px]',
              saveState === 'error' ? 'text-red-600' : 'text-ink-muted',
            )}
            role="status"
            title={saveState === 'error' ? '浏览器存储空间可能不足，请尽快导出备份' : '文章保存在当前浏览器中'}
          >
            {saveState === 'saving' ? <Loader2 size={12} className="animate-spin"/> : saveState === 'error' ? <CircleAlert size={12}/> : <Save size={12}/>}
            <span className="hidden sm:inline">{saveState === 'saving' ? '正在保存' : saveState === 'error' ? '保存失败' : '已存本机'}</span>
            <span className="sr-only sm:hidden">{saveState === 'saving' ? '正在保存' : saveState === 'error' ? '保存失败' : '已存本机'}</span>
          </div>
        </div>
        {showLanguageTabs && (
          <div className="mt-3 flex items-center justify-between gap-3">
            <LanguageTabs value={language} onChange={setLanguage} hasEnglish={contentParts.hasEnglish}/>
            <span className="hidden sm:inline text-[11px] text-ink-muted">两种语言独立编辑，保存为同一篇稿件</span>
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {editorView === 'images' && (
          <ImageSearchPanel
            sourceUrl={firstHttpUrl(article.brief.material)}
            initialQuery={renderedTitle}
            content={selectedContent}
            onChange={updateSelectedContent}
            onClose={() => setEditorView('content')}
            onInsertAtCursor={insertImageAtCursor}
          />
        )}
        {/* 配图面板打开时编辑器保持挂载（仅隐藏），这样「插入」能落在当前光标处，
            且光标位置不会因卸载重建而丢失。 */}
        <div className={editorView === 'images' ? 'hidden' : 'h-full'}>
          <Editor
            key={article.id}
            html={selectedContent}
            onChange={updateSelectedContent}
            onFindImages={() => setEditorView('images')}
            editorRef={editorInstanceRef}
            placeholder={language === 'zh' ? '在这里编辑中文稿。' : '英文版会在生成双语稿后出现，也可以直接在这里编写。'}
          />
        </div>
      </div>
    </>
  );

  const publishPanel = (
    <div className="h-full flex flex-col bg-white">
      <ValidationStrip markdown={selectedContent} title={renderedTitle} />
      <div className="min-h-12 shrink-0 border-b border-ink-line px-4 py-1 flex items-center justify-between bg-white">
        <div className="text-sm font-semibold">发布准备</div>
        <div className="rounded-lg bg-ink-panel p-0.5 flex" role="tablist" aria-label="发布内容"
          onKeyDown={(event) => onTabsKeyDown(event, [
            { key: 'preview', enabled: true },
            { key: 'platforms', enabled: true },
          ], (key) => setPublishView(key as 'preview' | 'platforms'))}>
          <button
            role="tab"
            aria-selected={publishView === 'preview'}
            tabIndex={publishView === 'preview' ? 0 : -1}
            onClick={() => setPublishView('preview')}
            className={cn('h-10 px-3 rounded-md text-sm sm:h-7 sm:text-xs', publishView === 'preview' ? 'bg-white shadow-sm text-ink' : 'text-ink-muted')}
          >
            成品预览
          </button>
          <button
            role="tab"
            aria-selected={publishView === 'platforms'}
            tabIndex={publishView === 'platforms' ? 0 : -1}
            onClick={() => setPublishView('platforms')}
            className={cn('h-10 px-3 rounded-md text-sm sm:h-7 sm:text-xs', publishView === 'platforms' ? 'bg-white shadow-sm text-ink' : 'text-ink-muted')}
          >
            平台文案
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {publishView === 'preview' ? (
          <PreviewPane
            markdown={selectedContent}
            materialType={article.brief.materialType}
            title={renderedTitle}
            templateId={activeTemplateId}
            language={language}
            showLanguageTabs={showLanguageTabs}
            hasEnglish={contentParts.hasEnglish}
            onLanguageChange={setLanguage}
            onTemplateChange={(templateId) => update(article.id, { templateId })}
            onError={showError}
          />
        ) : (
          <PlatformTabs
            article={article}
            generating={adapting}
            batchProgress={batchProgress}
            aiReady={aiReady}
            onAdapt={onAdapt}
            onAdaptAll={onAdaptAll}
            onDraftChange={(p, t) => setDraft(article.id, p, t)}
            onExportZip={onExportZip}
            onError={showError}
            language={language}
            onLanguageChange={setLanguage}
            showLanguageTabs={showLanguageTabs}
          />
        )}
      </div>
    </div>
  );

  const hasContent = Boolean(article.content.trim());
  const workspaceViews = [
    { key: 'brief', label: '素材', icon: FileText, enabled: true },
    { key: 'editor', label: '原稿', icon: PencilLine, enabled: hasContent || mobileTab === 'editor' },
    { key: 'publish', label: '发布包', icon: Send, enabled: hasContent },
  ] as const;

  return (
    <AppShell>
      <div className="h-full flex flex-col app-workspace-bg">
        {error && <ErrorBanner message={error} onDismiss={dismissError}/>}
        <div className="h-14 flex items-center border-b border-white/80 bg-white/80 px-3 shrink-0 shadow-[0_1px_0_rgba(15,23,42,0.06)] backdrop-blur-xl sm:px-5">
          <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-ink">{article.title || '未命名内容'}</span>
                {generating || batchProgress || commandBusy ? <Loader2 size={12} className="shrink-0 animate-spin text-indigo-600"/> : <Check size={12} className="shrink-0 text-emerald-600"/>}
              </div>
              <p className="hidden truncate text-[10px] text-ink-muted sm:block">{generating ? 'AI 正在生成母稿' : batchProgress ? `正在同步平台稿 ${batchProgress.done}/${batchProgress.total}` : commandBusy ? 'AI 正在执行本轮修改' : '继续在下方对话，不必重新走流程'}</p>
            </div>
            <div className="flex rounded-lg bg-ink-panel p-0.5" role="tablist" aria-label="创作成果"
              onKeyDown={(event) => onTabsKeyDown(event, workspaceViews.map((view) => ({ key: view.key, enabled: view.enabled && !generating })), (key) => selectWorkspaceStep(key as WorkspaceStep))}>
              {workspaceViews.map((view) => {
                const Icon = view.icon;
                const active = mobileTab === view.key && !generating;
                return (
                  <button
                    key={view.key}
                    role="tab"
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    disabled={!view.enabled || generating}
                    onClick={() => selectWorkspaceStep(view.key)}
                    className={cn(
                      'inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs transition-colors sm:h-8 sm:px-3',
                      active ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
                      !view.enabled && 'opacity-35',
                    )}
                  >
                    <Icon size={13}/><span className={view.key === 'brief' ? 'hidden sm:inline' : ''}>{view.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {batchProgress && !generating && mobileTab !== 'publish' && (
          <div className="h-9 shrink-0 border-b border-indigo-100 bg-indigo-50/80 px-4 flex items-center justify-center gap-3 text-xs text-indigo-900" role="status">
            <span>平台稿正在后台生成 {batchProgress.done}/{batchProgress.total}</span>
            <button type="button" onClick={onCancelPlatformBatch} className="font-medium underline underline-offset-2">停止</button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden">
          {generating && generationProgress && (
            <div className="flex h-full items-center justify-center p-5">
              <div className="w-full max-w-xl">
                <GenerationProgress state={generationProgress} materialType={article.brief.materialType} platformCount={article.brief.platforms.length} onCancel={onCancelGeneration}/>
              </div>
            </div>
          )}
          {mobileTab === 'brief' && !generating && (
            <div className="h-full max-w-2xl mx-auto bg-white/90 border-x border-white shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
              {briefPanel}
            </div>
          )}
          {mobileTab === 'editor' && !generating && (
            <div className="h-full max-w-4xl mx-auto bg-white/95 border-x border-white shadow-[0_18px_60px_rgba(15,23,42,0.08)] flex flex-col">
              {editorPanel}
            </div>
          )}
          {mobileTab === 'publish' && !generating && (
            <div className="h-full max-w-5xl mx-auto bg-white/95 border-x border-white shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
              {publishPanel}
            </div>
          )}
        </div>
        <CreativeCopilot
          messages={article.conversation ?? []}
          hasContent={hasContent}
          busy={commandBusy || generating || Boolean(batchProgress)}
          onSubmit={onCreativeCommand}
        />
      </div>
    </AppShell>
  );
}

function slug(s: string) {
  return (s || 'article').toLowerCase().replace(/[^\w一-龥]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'article';
}

function firstHttpUrl(value: string): string | undefined {
  return value.match(/https?:\/\/[^\s<>"')\]]+/i)?.[0];
}

function resolveTemplateFromInstruction(instruction: string, currentId: string) {
  const aliases: Record<string, RegExp> = {
    graphite: /石墨|黑白|极简|克制/,
    paper: /纸张|纸感|温暖|人文/,
    focus: /焦点|专注|蓝紫|观点/,
    citrus: /柑橘|橙色|活力|明快/,
    geek: /极客|技术|代码|开发者/,
    jade: /翡翠|绿色|清新|自然/,
    magazine: /杂志|编辑部|红黑|刊物/,
  };
  const matched = WECHAT_TEMPLATES.find((template) => aliases[template.id]?.test(instruction));
  if (matched) return matched;
  const currentIndex = Math.max(0, WECHAT_TEMPLATES.findIndex((template) => template.id === currentId));
  return WECHAT_TEMPLATES[(currentIndex + 1) % WECHAT_TEMPLATES.length];
}
