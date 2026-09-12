import type { AgentOverride, CreatorConfig } from './types';
import { DEFAULT_WECHAT_TEMPLATE_ID } from './templates';

export const DEFAULT_CONFIG: CreatorConfig = {
  defaultPlatforms: ['wechat', 'x', 'zhihu', 'xiaohongshu'],
  bilingual: false,
  voice: 'relaxed',
  seriesTitle: '',
  authorSignature: '',
  wechatEyebrow: "FRANK'S AI NOTES / TOPIC",
  newsEyebrow: 'FIELD NOTES / NEWS',
  defaultTemplateId: DEFAULT_WECHAT_TEMPLATE_ID,
};

const STORAGE_KEY = 'omniwriter:config:v1';
const LEGACY_STORAGE_KEYS = ['pencil:config:v1'];

function migrateConfigKey() {
  if (typeof window === 'undefined') return;
  if (window.localStorage.getItem(STORAGE_KEY) !== null) return;
  for (const legacy of LEGACY_STORAGE_KEYS) {
    const value = window.localStorage.getItem(legacy);
    if (value !== null) {
      window.localStorage.setItem(STORAGE_KEY, value);
      window.localStorage.removeItem(legacy);
      break;
    }
  }
}

export function loadConfig(): CreatorConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    migrateConfigKey();
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<CreatorConfig>) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(cfg: CreatorConfig) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

// ===== Agent 定制（能力市场「配置」）=====

// 纯合并：patch 覆盖 current 的对应字段；空对象视为无定制。
export function mergeAgentOverride(current: AgentOverride | undefined, patch: AgentOverride): AgentOverride {
  return {
    directive: patch.directive !== undefined ? patch.directive : current?.directive,
    defaults: {
      ...current?.defaults,
      ...patch.defaults,
    },
  };
}

export function getAgentOverride(agentId?: string): AgentOverride | undefined {
  if (!agentId) return undefined;
  return loadConfig().agentOverrides?.[agentId];
}

export function saveAgentOverride(agentId: string, patch: AgentOverride) {
  const config = loadConfig();
  saveConfig({
    ...config,
    agentOverrides: {
      ...config.agentOverrides,
      [agentId]: mergeAgentOverride(config.agentOverrides?.[agentId], patch),
    },
  });
}

export function clearAgentOverride(agentId: string) {
  const config = loadConfig();
  if (!config.agentOverrides?.[agentId]) return;
  const { [agentId]: _removed, ...rest } = config.agentOverrides;
  saveConfig({ ...config, agentOverrides: rest });
}
