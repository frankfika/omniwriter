import type { WriterAgent } from './agents';

// ===== 自定义 Agent（市场「孵化」产物）=====
// 结构同 WriterAgent，另带创建时间；持久化在 localStorage。
// 服务端 resolveAgent 查不到自定义 id，生成时 directive 由客户端随请求直传。

export interface CustomAgent extends WriterAgent {
  createdAt: number;
}

const STORAGE_KEY = 'omniwriter-custom-agents';

// 解析存储内容：损坏 JSON / 非数组 / 缺关键字段都容错，返回干净的数组而不抛错。
export function parseCustomAgents(raw: string | null): CustomAgent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is CustomAgent =>
        Boolean(item) &&
        typeof (item as CustomAgent).id === 'string' &&
        typeof (item as CustomAgent).name === 'string' &&
        typeof (item as CustomAgent).directive === 'string',
    );
  } catch {
    return [];
  }
}

export function listCustomAgents(): CustomAgent[] {
  if (typeof window === 'undefined') return [];
  return parseCustomAgents(window.localStorage.getItem(STORAGE_KEY));
}

export function getCustomAgent(id?: string): CustomAgent | undefined {
  if (!id) return undefined;
  return listCustomAgents().find((agent) => agent.id === id);
}

export function saveCustomAgent(agent: CustomAgent) {
  if (typeof window === 'undefined') return;
  const rest = listCustomAgents().filter((item) => item.id !== agent.id);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([agent, ...rest]));
}

export function removeCustomAgent(id: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(listCustomAgents().filter((item) => item.id !== id)));
}

// 自定义排在内置前面，方便用户先看到自己的 Agent。
export function mergeCustomAgents(builtin: WriterAgent[], custom: CustomAgent[]): WriterAgent[] {
  return [...custom, ...builtin];
}
