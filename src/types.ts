export type Protocol = 'openai' | 'responses' | 'claude' | 'gemini' | 'azure';

export interface Channel {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  protocol: Protocol;
  enabled: boolean;
  priority: number;
  deployment?: string;
  apiVersion?: string;
  extraHeaders?: Record<string, string>;
  createdAt: number;
  frozenUntil: number;
  note?: string;
}

export interface ModelEntry {
  id: string;
  name: string;
  channelId: string;
  upstreamModel: string;
  enabled: boolean;
  group: string;
  alias: string;
  priority: number;
  cooldownUntil: number;
  disabled: boolean;
  note?: string;
  // 用户手动修正的模型属性（覆盖本地注册表推断）；不设则按名字推断
  meta?: { caps?: string[]; context?: number | null; maxOutput?: number | null };
}

export interface Group { name: string; description: string; }
export interface Token { id: string; name: string; key: string; enabled: boolean; createdAt: number; }

// 路由规则（虚拟模型）：客户端模型名 → 一组上游目标 + 策略
export type RouteStrategy = 'failover' | 'roundrobin' | 'weighted';
export interface RouteTarget { modelId: string; weight: number; }
export interface RouteRule {
  id: string;
  name: string;
  strategy: RouteStrategy;
  enabled: boolean;
  targets: RouteTarget[];
  createdAt: number;
  note?: string;
}

export interface Settings {
  proxyPort: number;
  adminPort: number;
  enforceToken: boolean;
  cooldownMs: number;
  breakerThreshold: number;
  breakerResetMs: number;
  channelFreezeMs: number;
  emptyStreamTimeoutMs: number;
  logCapBytes: number;
  logCapLines: number;
  theme: 'light' | 'dark' | 'auto';
  language: 'zh' | 'en';
  webAdminEnabled: boolean;
  adminToken: string;
  orderMode: 'custom' | 'newest' | 'fastest';
  autoGroup: string;
  autoLaunch: boolean;
  retryEnabled: boolean;
  retryStatusCodes: string;
  maxRetries: number;
  retryIntervalSec: number;
  negativeCacheMs: number;
  latencyBuffer: number;
}

export interface State {
  version?: string;
  settings: Settings;
  channels: Channel[];
  models: ModelEntry[];
  routes: RouteRule[];
  groups: Group[];
  tokens: Token[];
  protocolLabels: Record<string, string>;
}

export interface LogRow {
  ts: number; success: boolean; model: string; usedAuto: boolean;
  channelId: string; channelName: string; upstreamModel: string;
  protocol: string; status: number; latencyMs: number;
  promptTokens: number; completionTokens: number; totalTokens: number;
  attempts?: any[];
}
