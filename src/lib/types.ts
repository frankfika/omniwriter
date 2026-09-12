export type Voice =
  | 'relaxed'
  | 'editorial'
  | 'technical'
  | 'market'
  | 'newswire'
  | 'explainer'
  | 'essay'
  | 'maker'
  | 'research'
  | 'social'
  | 'script';

export type MaterialType = 'news' | 'project-own' | 'project-third' | 'topic' | 'copy';

export type PlatformId =
  | 'wechat'
  | 'x'
  | 'reddit'
  | 'hacker-news'
  | 'zhihu'
  | 'csdn'
  | 'product-hunt'
  | 'bilibili'
  | 'xiaohongshu';

export interface Brief {
  material: string;          // URL / 文本 / 主题
  materialType: MaterialType;
  angle: string;             // 角度 / 立场
  voice: Voice;
  length: 'short' | 'medium' | 'long';
  platforms: PlatformId[];
  bilingual: boolean;
  titleHint?: string;
  cta?: string;
  agentId?: string; // 来自 Agent 市场；缺省为手动模式（旧文章向后兼容）
  scene?: string;   // 选中的发布场景 id
  templateId?: string; // 用户选择的排版模板；缺省时由 store 回退到全局默认
}

export interface Article {
  id: string;
  title: string;
  brief: Brief;
  content: string;           // Markdown 母稿
  platformDrafts: Partial<Record<PlatformId, string>>;
  templateId?: string;       // 公众号排版模板；缺省时使用当前默认模板（兼容旧文章）
  conversation?: CreatorMessage[];
  createdAt: number;
  updatedAt: number;
}

export type CreatorAgentId =
  | 'chief-editor'
  | 'researcher'
  | 'visual-editor'
  | 'layout-editor'
  | 'distribution-editor'
  | 'qa-editor';

export interface CreatorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  agentId?: CreatorAgentId;
}

// 用户在能力市场对单个 Agent 的定制：directive 会随生成请求发给服务端，
// defaults 在建稿时 merge 进 Brief（只存与内置预设不同的字段）。
export interface AgentOverride {
  directive?: string;
  defaults?: {
    voice?: Voice;
    length?: Brief['length'];
    platforms?: PlatformId[];
    bilingual?: boolean;
  };
}

export interface CreatorConfig {
  defaultPlatforms: PlatformId[];
  bilingual: boolean;
  voice: Voice;
  seriesTitle: string;
  authorSignature: string;
  wechatEyebrow: string;
  newsEyebrow: string;
  defaultTemplateId: string;
  marketStyleId?: Voice; // 用户在能力市场主动选择的跨 Agent 风格；缺省时由 Agent 自己决定
  agentOverrides?: Record<string, AgentOverride>; // 按 Agent id 存放的用户定制
}
