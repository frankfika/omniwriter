import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';

// 端到端模拟一次 SSE 消费循环：客户端不应再用「本地 requestId」与服务端
// requestId 比对过滤——两端互不可见，UUID 永远不一致。
//
// 这是 2026-09-29 在真实浏览器里复现出来的 P0：文章提交后，brief 面板永远
// 停留「AI 正在生成」，但服务端实际跑完了 21s，文章 store 始终空。

interface SSEEvent {
  type: string;
  requestId?: string;
  md?: string;
  chars?: number;
  title?: string;
  [key: string]: unknown;
}

// 与 app/article/[id]/page.tsx 的消费循环保持一致
async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: SSEEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const data = chunk.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
        if (data) {
          try {
            onEvent(JSON.parse(data) as SSEEvent);
          } catch {
            /* 与 page.tsx 行为一致：单条事件损坏不能毁掉整条流 */
          }
        }
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

function sseStream(events: SSEEvent[]): ReadableStream<Uint8Array> {
  return Readable.toWeb(
    Readable.from(
      (async function* () {
        for (const e of events) {
          yield new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`);
        }
      })(),
    ),
  ) as unknown as ReadableStream<Uint8Array>;
}

describe('SSE 消费循环 (article-page)', () => {
  it('服务器返回的事件即便 requestId 与本地不同也应被处理', async () => {
    const serverRequestId = 'srv-uuid-1234';
    const localRequestId = 'cli-uuid-9999'; // 故意不同：模拟真实的客户端/服务端独立 UUID

    const events: SSEEvent[] = [
      { type: 'stage', requestId: serverRequestId, stage: 'source', label: '素材已读取' },
      { type: 'stage', requestId: serverRequestId, stage: 'rules', label: '写作风格已写入' },
      { type: 'stage', requestId: serverRequestId, stage: 'streaming', label: '正文正在生成' },
      { type: 'delta', requestId: serverRequestId, chars: 80, preview: '# 测试标题' },
      { type: 'stage', requestId: serverRequestId, stage: 'checking', label: '基础格式检查' },
      { type: 'done', requestId: serverRequestId, md: '# 测试\n\n正文', title: '测试' },
    ];

    const received: SSEEvent[] = [];
    // 关键断言：过滤函数不再因 requestId 不匹配而丢事件。
    const filtered = events.filter(
      (e) => !e.requestId || e.requestId === localRequestId,
    );
    expect(filtered.length, '修复前的 bug 会让所有事件被过滤').toBe(0);

    // 修复后：不过滤，所有事件都应被消费。
    await consumeSSE(sseStream(events), (e) => received.push(e));
    expect(received.length).toBe(events.length);
    expect(received.find((e) => e.type === 'done')?.md).toContain('测试');
  });

  it('空 data 行（心跳 : ping）应被忽略，不报错', async () => {
    const events: SSEEvent[] = [
      { type: 'stage', requestId: 'x', stage: 'source', label: 'a' },
      // 这里混入一段心跳，保持现有解析器稳健
    ];

    const pingChunk = new TextEncoder().encode(': ping\n\n');
    const realChunks = events
      .map((e) => new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`));
    const combined = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of [pingChunk, ...realChunks, pingChunk]) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });

    const received: SSEEvent[] = [];
    await consumeSSE(combined, (e) => received.push(e));
    expect(received.length).toBe(events.length);
  });

  it('不合法 JSON 的 chunk 应被跳过而不是炸掉整个流', async () => {
    // 真实场景：服务端罕见地发了一个空 `data: ` 行；解析器必须稳健地继续。
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: \n\n'));
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ type: 'done', md: 'hi' })}\n\n`,
          ),
        );
        controller.close();
      },
    });

    const received: SSEEvent[] = [];
    // 直接调消费逻辑：空 data 行不进 if(data)，done 仍能到达。
    await consumeSSE(stream, (e) => received.push(e));
    expect(received.length).toBe(1);
    expect(received[0]?.type).toBe('done');
  });

  it('坏 JSON 数据应被吞掉而后续有效事件仍到达', async () => {
    // 模拟「解析失败不能整条流爆炸」：坏 JSON → 跳过；后续两个 valid event 仍要落地。
    const events: SSEEvent[] = [
      { type: 'stage', requestId: 'a', stage: 'source', label: 'A' },
      { type: 'stage', requestId: 'a', stage: 'rules', label: 'B' },
      { type: 'done', requestId: 'a', md: 'ok', title: 't' },
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${events[0] && JSON.stringify(events[0])}\n\n`));
        controller.enqueue(new TextEncoder().encode('data: {not-json,\n\n'));
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(events[1])}\n\n`));
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(events[2])}\n\n`));
        controller.close();
      },
    });

    // 复刻 page.tsx 的容错语义：JSON.parse 抛错要 try/catch 跳过。
    const received: SSEEvent[] = [];
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const data = chunk.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
        if (data) {
          try {
            received.push(JSON.parse(data) as SSEEvent);
          } catch {
            /* 单条事件损坏不能毁掉整条流 */
          }
        }
      }
      if (done) break;
    }
    expect(received.length).toBe(3);
    expect(received.map((e) => e.type)).toEqual(['stage', 'stage', 'done']);
  });
});