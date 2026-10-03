import { NextRequest, NextResponse } from 'next/server';
import { generateMasterStream, type AiLike } from '@/src/lib/ai';
import { resolveAgent } from '@/src/lib/agents';
import { validateMarkdown } from '@/src/lib/editorial';
import { crossValidateDraft } from '@/src/lib/cross-validate';
import type { Brief } from '@/src/lib/types';
import type { GenerationStreamEvent } from '@/src/lib/generation-events';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: {
    brief?: Brief;
    material?: string;
    ai?: AiLike;
    config?: { seriesTitle?: string };
    directive?: string; // 客户端对 Agent 写作指令的定制；缺省回退内置预设
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求内容格式不正确' }, { status: 400 });
  }

  const brief = body.brief;
  if (!brief || typeof brief !== 'object') {
    return NextResponse.json({ error: '缺少创作指令' }, { status: 400 });
  }
  const source = body.material ?? brief.material;
  if (!source || typeof source !== 'string' || !source.trim()) {
    return NextResponse.json({ error: '请先放入素材' }, { status: 400 });
  }
  if (source.length > 100_000) {
    return NextResponse.json({ error: '素材过长，请控制在 10 万字以内' }, { status: 413 });
  }

  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const isBareNewsUrl = brief.materialType === 'news' && /^https?:\/\/\S+$/i.test(source.trim());
  const encoder = new TextEncoder();
  let cancelled = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: GenerationStreamEvent) => {
        if (cancelled) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // 心跳注释行：防止中间代理/负载均衡因「长时间无数据」掐断长连接。
      heartbeat = setInterval(() => {
        if (cancelled) return;
        controller.enqueue(encoder.encode(': ping\n\n'));
      }, 15_000);

      void (async () => {
        try {
          send({
            type: 'stage', requestId, stage: 'source',
            label: isBareNewsUrl ? '新闻链接已收到' : brief.materialType === 'news' ? '新闻素材已收到' : '素材已读取',
            detail: isBareNewsUrl ? '当前只有链接，未提取网页正文' : `${source.trim().length.toLocaleString('zh-CN')} 字`,
            at: Date.now(),
          });

          let firstChunk = true;
          let lastSentChars = 0;
          let lastSentAt = 0;
          // 用户定制的 directive 优先（截断防滥用），否则回退 Agent 内置预设
          const custom = typeof body.directive === 'string' && body.directive.trim()
            ? body.directive.slice(0, 4000)
            : undefined;
          const directive = custom ?? resolveAgent(brief.agentId)?.directive;
          const md = await generateMasterStream(brief, source, directive, body.ai, {
            seriesTitle: body.config?.seriesTitle,
            signal: req.signal,
            onPrepared: () => send({
              type: 'stage', requestId, stage: 'rules',
              label: brief.materialType === 'news' ? '新闻来源与引用规则已写入请求' : '写作风格与结构已写入请求',
              detail: brief.materialType === 'news' ? '要求标明来源、日期，不补写未知事实' : undefined,
              at: Date.now(),
            }),
            onRequested: () => send({
              type: 'stage', requestId, stage: 'waiting', label: '生成请求已创建，等待首段返回', at: Date.now(),
            }),
            onText: (_delta, snapshot) => {
              const now = Date.now();
              if (firstChunk) {
                firstChunk = false;
                send({
                  type: 'stage', requestId, stage: 'streaming',
                  label: brief.materialType === 'news' ? '新闻稿正在生成' : '正文正在生成',
                  detail: '下方只展示模型实际返回的文字片段', at: now,
                });
              }
              if (snapshot.length - lastSentChars >= 120 || now - lastSentAt >= 800) {
                lastSentChars = snapshot.length;
                lastSentAt = now;
                send({
                  type: 'delta', requestId, chars: snapshot.length,
                  // 保留换行的 1500 字尾部快照：客户端流面板按段落展示，压成单行会读不了。
                  preview: snapshot.slice(-1500), at: now,
                });
              }
            },
            onBilingual: () => send({
              type: 'stage', requestId, stage: 'translating',
              label: '中文稿已生成，正在补全英文版',
              detail: '双语稿需要追加翻译调用，比纯中文稿多等一会',
              at: Date.now(),
            }),
          });

          // 冲刷末段：即使末尾增量不足阈值，也要把最终字数推给客户端。
          if (md.length - lastSentChars > 0) {
            send({
              type: 'delta', requestId, chars: md.length,
              preview: md.slice(-1500), at: Date.now(),
            });
          }

          send({
            type: 'stage', requestId, stage: 'checking', label: '正文已收到，正在做标题与基础格式检查',
            detail: `${md.length.toLocaleString('zh-CN')} 字`, at: Date.now(),
          });
          const title = md.match(/^# (.+)$/m)?.[1]?.trim();
          // 交叉验证：跑在 done 之前，给用户多一道质检；失败不影响主流程，
          // 事件也是可选的——不认识 verify 的消费者忽略即可。
          try {
            const verdict = await crossValidateDraft({
              draft: md,
              platform: brief.platforms[0] ?? 'wechat',
              sourceSummary: source.slice(0, 800),
              signal: req.signal,
            });
            if (verdict) send({ type: 'verify', requestId, verdict, at: Date.now() });
          } catch { /* 验证失败不阻断交付 */ }
          send({
            type: 'done', requestId, md, title,
            durationMs: Date.now() - startedAt,
            issues: validateMarkdown(md).length,
            at: Date.now(),
          });
          if (heartbeat) clearInterval(heartbeat);
          if (!cancelled) controller.close();
        } catch (error) {
          if (heartbeat) clearInterval(heartbeat);
          if (cancelled) return;
          const message = (error as Error).name === 'AbortError'
            ? '生成已停止，原稿没有被覆盖'
            : (error as Error).message || '生成失败，请重试';
          send({ type: 'error', requestId, message, retryable: true, at: Date.now() });
          // 失败用 controller.error 结束：让客户端读取循环终止，而不是误判为正常结束。
          try { controller.error(new Error(message)); } catch { controller.close(); }
        }
      })();
    },
    cancel() {
      cancelled = true;
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
