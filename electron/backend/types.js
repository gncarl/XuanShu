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
  autoLaunch: false,                    // 开机启动（桌面端）
  retryEnabled: true,                   // 接口重试：上游返回可重试状态码时，同一目标自动重试
  retryStatusCodes: '500,502,503,504',  // 可重试的状态码（429 欠费/限流不建议加入）
  maxRetries: 3,                        // 同一目标最大重试次数
  retryIntervalSec: 2,                  // 重试间隔（秒）
};

export const STORE_VERSION = 1;
