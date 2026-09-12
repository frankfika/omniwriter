import { NextRequest, NextResponse } from 'next/server';
import { generateMasterStream, getClient, MODEL, type AiLike } from '@/src/lib/ai';
import type { Brief } from '@/src/lib/types';

export const runtime = 'nodejs';

// 自定义 Agent「孵化」：revise 从范文/反馈提炼写作指令；trial 用指令真实试写一篇。

const REVISE_SYSTEM = `你是一位中文写作风格分析师，帮用户从范文样本中提炼可复用的写作指令（directive）。
规则：
- 指令要具体可执行：句式、结构、语气、用词禁忌、事实层级；不写空话。
- 如果用户给了反馈，就在当前指令基础上按反馈修订，并保留仍有效的部分。
- 只用中文回复，按以下格式输出（不要输出其它内容）：
【指令】
（完整的写作指令全文）
【说明】
（用一两句话告诉用户这次提炼/修订了什么、学到了什么）
【建议】
（仅在首轮、且样本足够时输出：给这个写作 Agent 起个名字、一个 emoji、一句 slogan（tagline）、一句描述，四行各一项，顺序为 名字/emoji/slogan/描述；非首轮不要输出本段）`;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function clip(text: unknown, max: number): string {
  return typeof text === 'string' ? text.slice(0, max) : '';
}

function parseReviseOutput(text: string): {
  directive: string;
  reply: string;
  suggestion?: { name: string; emoji: string; tagline: string; description: string };
} {
  const directive = text.match(/【指令】\s*([\s\S]*?)(?=【说明】|【建议】|$)/)?.[1]?.trim() ?? '';
  const reply = text.match(/【说明】\s*([\s\S]*?)(?=【建议】|$)/)?.[1]?.trim() ?? '';
  const suggestionBlock = text.match(/【建议】\s*([\s\S]*)$/)?.[1]?.trim();
  let suggestion: { name: string; emoji: string; tagline: string; description: string } | undefined;
  if (suggestionBlock) {
    // 模型常把「名字/emoji/slogan/描述」当标签原样输出，剥掉行首标签
    const lines = suggestionBlock
      .split('\n')
      .map((line) => line.trim().replace(/^(名字|名称|emoji|表情|slogan|tagline|描述)\s*[/／：:]\s*/i, ''))
      .filter(Boolean);
    if (lines.length >= 4) {
      suggestion = { name: lines[0], emoji: lines[1], tagline: lines[2], description: lines.slice(3).join(' ') };
    }
  }
  return { directive, reply, suggestion };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action?: string;
      samples?: unknown;
      history?: unknown;
      draftDirective?: unknown;
      directive?: unknown;
      material?: unknown;
      ai?: AiLike;
    };
    const ai = body.ai;

    if (body.action === 'revise') {
      const samples = Array.isArray(body.samples)
        ? (body.samples as unknown[]).map((s) => clip(s, 8_000)).filter((s) => s.trim())
        : [];
      if (!samples.length) {
        return NextResponse.json({ error: '请至少提供一条范文样本' }, { status: 400 });
      }
      const history: ChatMessage[] = Array.isArray(body.history)
        ? (body.history as unknown[])
            .filter((m): m is ChatMessage =>
              Boolean(m) &&
              ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
              typeof (m as ChatMessage).content === 'string')
            .map((m) => ({ role: m.role, content: m.content.slice(0, 2_000) }))
            .slice(-12)
        : [];
      const draftDirective = clip(body.draftDirective, 4_000);
      const userPrompt = [
        '## 范文样本',
        ...samples.map((s, i) => `### 样本 ${i + 1}\n${s}`),
        draftDirective ? `\n## 当前指令（在此基础上修订）\n${draftDirective}` : '\n## 当前指令\n（还没有，请从样本提炼第一版）',
      ].join('\n\n');
      const msg = await getClient(ai).messages.create(
        {
          model: MODEL,
          max_tokens: 2000,
          system: REVISE_SYSTEM,
          messages: [...history, { role: 'user' as const, content: userPrompt }],
        },
        { signal: req.signal },
      );
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      const { directive, reply, suggestion } = parseReviseOutput(text);
      if (!directive) {
        return NextResponse.json({ error: '这次没有提炼出指令，请换一批样本或补充反馈再试' }, { status: 502 });
      }
      return NextResponse.json({ directive, reply: reply || '已更新写作指令。', suggestion });
    }

    if (body.action === 'trial') {
      const directive = clip(body.directive, 4_000).trim();
      const material = clip(body.material, 12_000).trim();
      if (!directive) {
        return NextResponse.json({ error: '请先提炼出写作指令再试写' }, { status: 400 });
      }
      if (!material) {
        return NextResponse.json({ error: '请提供测试素材' }, { status: 400 });
      }
      // 最小 Brief：试写只验证指令效果，平台分发留给正式创作
      const brief: Brief = {
        material,
        materialType: 'topic',
        angle: '',
        voice: 'relaxed',
        length: 'medium',
        bilingual: false,
        platforms: [],
      };
      const article = await generateMasterStream(brief, material, directive, ai, { signal: req.signal });
      return NextResponse.json({ article });
    }

    return NextResponse.json({ error: '未知的 action' }, { status: 400 });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return NextResponse.json({ error: '本次请求已取消' }, { status: 504 });
    }
    return NextResponse.json({ error: (error as Error).message || '操作失败' }, { status: 500 });
  }
}
