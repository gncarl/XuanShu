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
  emptyStreamTimeoutMs: 60000,     // 空流保护：首个 token 多久没来才视为上游无响应（推理模型首 token 常超 8s，故放宽到 60s）
  streamIdleTimeoutMs: 600000,     // 流已开始后，两次数据之间的空闲上限，仅用于兜底「僵尸连接」；不短设，避免长思考被掐断
  connectTimeoutMs: 10000,         // 0.2.6：连接建立超时（DNS+TCP+TLS 整体），超时立即 failover，消灭「不可达候选卡 30s」
  responseTimeoutMs: 20000,        // 0.2.6：非流式响应超时（连接成功后到收完响应），超时立即 failover，解决非流式挂起卡 600s
  enableWarmUp: true,              // 0.2.6：启动预热 + 空闲保活
  warmUpIntervalMs: 300000,        // 0.2.6：预热/保活周期（默认 5 分钟）
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
  negativeCacheMs: 600000,             // AUTO 负缓存：命中「模型不存在」类 4xx 后短期跳过该候选（0=禁用），默认 10 分钟
  latencyBuffer: 0.5,                  // 最快优先（orderMode=fastest）：EWMA 在「最快者 ×(1+buffer)」内算同档，按优先级排，防最快单点吸流
};

export const STORE_VERSION = 1;
