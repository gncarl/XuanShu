// 全局常量与协议枚举。无运行时依赖。

export const PROTOCOLS = {
  OPENAI: 'openai',       // OpenAI 兼容（Bearer Token）
  RESPONSES: 'responses', // OpenAI Responses 兼容层
  CLAUDE: 'claude',       // Anthropic Claude Messages（x-api-key）
  GEMINI: 'gemini',       // Google Gemini（key 查询参数 / OpenAI 兼容）
  AZURE: 'azure',         // Azure OpenAI（api-key 头 + 部署名路由）
};

export const PROTOCOL_LABELS = {
  openai: 'OpenAI 兼容',
  responses: 'OpenAI Responses',
  claude: 'Claude Messages',
  gemini: 'Gemini',
  azure: 'Azure OpenAI',
};

export const DEFAULT_SETTINGS = {
  proxyPort: 9090,
  adminPort: 8787,
  enforceToken: false,     // 是否强制客户端携带 Access Key
  cooldownMs: 5 * 60 * 1000,       // L1：模型冷却时长
  breakerThreshold: 5,             // L2：连续失败多少次打开熔断
  breakerResetMs: 60 * 1000,       // L2：多久后进入半开探测
  channelFreezeMs: 10 * 60 * 1000, // L3：频道整体冻结时长
  emptyStreamTimeoutMs: 8000,      // 空流保护：多久没数据视为失败
  logCapBytes: 50 * 1024 * 1024,   // 日志上限 50MB（取代 30G 备份）
  logCapLines: 200000,
  theme: 'light',
  language: 'zh',
  webAdminEnabled: true,
  adminToken: '',
  autoGroup: 'AUTO',
};

export const STORE_VERSION = 1;
