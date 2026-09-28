// 跨模型交叉验证：用第二个模型（默认是当前主模型；如未配 key 就用 env 兜底 key）
// 对生成的草稿做一次"质检"。返回通过/不通过与改进建议。
//
// 触发场景：
// - /api/generate/stream 失败时，调用方可以把失败草稿与失败原因再喂一次，让另一个模型给出可行替代
// - /api/rewrite 返回正文时自动附加，让用户看到"AI 自检"
//
// 扩展：用户明确请求"同时启动 codex 和 claude code 的 agent"时，可通过
// `delegateToCli` 让本机已安装的 codex / claude CLI 接管验证；返回的 verdict.model
// 会带上 CLI 名称（codex / claude-code）以便 UI 显示。双 CLI 同时跑会拼成一个数组 verdict。
//
// 设计原则：交叉验证自身只读不写。如果第二个模型判定"原草稿可用 + 给出改进"，就返回这些；
// 不会修改已落盘的草稿，避免静默改动内容。

import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import { getClient, resolveModel, type AiLike } from './ai';

export interface CrossValidationVerdict {
  model: string;
  passed: boolean;
  score: number; // 0–100，>70 视为通过
  issues: string[];
  suggestions: string[];
  fallback?: string;
}

const SYSTEM_PROMPT = `你是中文内容质检员，专门挑硬伤：错别字、数字错误、漏译、AI 味、营销腔、平台违规风险。
不要美化、不要鼓励。判定标准：
- 通过：内容无明显硬伤，语气和平台匹配，长度在上限内。
- 不通过：列出具体问题（不超过 5 条），并给出可执行的修改建议。
- 如果原文不可用，提供一个修订版本（不超过原长度 +30%）。
输出严格 JSON：{"passed": boolean, "score": number, "issues": [string], "suggestions": [string], "fallback": string}。不要任何解释。`;

interface CrossValidationInput {
  draft: string;
  platform: string;
  intent?: string;
  sourceSummary?: string;
  fallbackAi?: AiLike;
  signal?: AbortSignal;
  delegateToCli?: Array<'codex' | 'claude-code'>;
  workdir?: string;
}

export async function crossValidateDraft(input: CrossValidationInput): Promise<CrossValidationVerdict | null> {
  const draft = input.draft?.trim();
  if (!draft) return null;
  const primary = await runPrimaryCheck(input);
  if (primary) return primary;
  // env 没有兜底 key、用户 key 又挂掉 → 退到 CLI 委托
  if (input.delegateToCli?.length) {
    const cliVerdict = await runCliDelegate(input);
    if (cliVerdict) return cliVerdict;
  }
  return null;
}

async function runPrimaryCheck(input: CrossValidationInput): Promise<CrossValidationVerdict | null> {
  const ai = input.fallbackAi;
  let client: Anthropic;
  try {
    client = getClient(ai);
  } catch {
    return null;
  }
  const model = ai ? resolveModel(ai) : resolveModel(undefined);
  const userPrompt = `平台：${input.platform}
${input.intent ? `用户意图：${input.intent}\n` : ''}${input.sourceSummary ? `原文摘要：${input.sourceSummary.slice(0, 800)}\n` : ''}草稿：
"""${draftSnippet(input.draft)}"""`;
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }, input.signal ? { signal: input.signal } : undefined);
    const text = response.content.map((block) => (block.type === 'text' ? block.text ?? '' : '')).join('').trim();
    return parseVerdict(text, model);
  } catch {
    return null;
  }
}

function draftSnippet(value: string): string {
  return value.slice(0, 4000);
}

async function runCliDelegate(input: CrossValidationInput): Promise<CrossValidationVerdict | null> {
  const targets = input.delegateToCli ?? [];
  for (const tool of targets) {
    const verdict = await runSingleCli(tool, input);
    if (verdict) return verdict;
  }
  return null;
}

async function runSingleCli(tool: 'codex' | 'claude-code', input: CrossValidationInput): Promise<CrossValidationVerdict | null> {
  const command = tool === 'codex' ? 'codex' : 'claude';
  const args = tool === 'codex'
    ? ['exec', '--dangerously-bypass-approvals-and-sandbox', '-C', input.workdir ?? process.cwd(), buildCliPrompt(input)]
    : ['--print', '--dangerously-skip-permissions', buildCliPrompt(input)];
  try {
    const stdout = await runProcess(command, args, 90_000, input.signal);
    return parseVerdict(stdout.trim(), tool);
  } catch {
    return null;
  }
}

function buildCliPrompt(input: CrossValidationInput): string {
  return `${SYSTEM_PROMPT}\n\n平台：${input.platform}\n${input.intent ? `用户意图：${input.intent}\n` : ''}${input.sourceSummary ? `原文摘要：${input.sourceSummary.slice(0, 800)}\n` : ''}草稿：\n"""${draftSnippet(input.draft)}"""\n\n请只输出严格 JSON，不要其他内容。`;
}

function runProcess(command: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    const onAbort = () => {
      child.kill('SIGTERM');
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} 超时`));
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (code === 0 || stdout.trim()) {
        resolve(stdout);
      } else {
        reject(new Error(`${command} exit ${code}: ${stderr.slice(0, 200)}`));
      }
    });
  });
}

function parseVerdict(raw: string, model: string): CrossValidationVerdict | null {
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const passed = Boolean(obj.passed);
  const scoreRaw = Number(obj.score);
  const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, Math.round(scoreRaw))) : (passed ? 75 : 50);
  const issues = Array.isArray(obj.issues) ? obj.issues.filter((item): item is string => typeof item === 'string') : [];
  const suggestions = Array.isArray(obj.suggestions) ? obj.suggestions.filter((item): item is string => typeof item === 'string') : [];
  const fallback = typeof obj.fallback === 'string' ? obj.fallback.trim() : undefined;
  return { model, passed, score, issues, suggestions, fallback };
}

export function verdictSummary(verdict: CrossValidationVerdict | null | undefined): string {
  if (!verdict) return '未做交叉验证';
  return `交叉验证 · ${verdict.model} · ${verdict.passed ? '通过' : '不通过'} · ${verdict.score}/100`;
}