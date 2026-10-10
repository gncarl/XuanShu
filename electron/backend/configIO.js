// 配置导入 / 导出。
// 导出：把「频道（provider）+ 模型池 + 分组 + 令牌 + 路由」打包成 JSON。
// 导入：支持两种格式
//   1) 玄枢原生导出（app === 'xuanshu'）——全量恢复（replace）
//   2) One API / New API 的频道导出（channels[].key / base_url / models）——转换后追加（merge）
//
// 注意：本项目刻意「不生成随时间膨胀的备份」。导入前只做一次滚动备份，
// 固定覆盖同一个 config.json.bak，既能回滚又不会撑爆磁盘。
import fs from 'node:fs';
import { uid, nowMs } from './util.js';

const APP_TAG = 'xuanshu';

// ---- 导出 ----
export function buildExport(store, { version = '' } = {}) {
  const d = store.data;
  return {
    app: APP_TAG,
    kind: 'config',
    version,
    exportedAt: nowMs(),
    note: '包含频道 API Key 等敏感信息，请妥善保管，勿公开分享。',
    channels: d.channels || [],
    models: d.models || [],
    groups: d.groups || [],
    tokens: d.tokens || [],
    routes: d.routes || [],
  };
}

// ---- 格式识别 ----
function pickChannelArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;
  if (Array.isArray(payload.channels)) return payload.channels;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.channel)) return payload.channel;
  return null;
}

export function detectFormat(payload) {
  if (!payload || typeof payload !== 'object') return 'unknown';
  if (payload.app === APP_TAG || payload.kind === 'config') return APP_TAG;
  const chs = pickChannelArray(payload);
  if (chs && chs.length) {
    const s = chs[0] || {};
    // 玄枢原生：有 protocol + baseUrl（驼峰）
    if ('protocol' in s && ('baseUrl' in s)) return APP_TAG;
    // One API / New API：key / base_url / type(数字)
    if ('key' in s || 'base_url' in s || 'baseurl' in s || 'api_key' in s || typeof s.type === 'number') return 'oneapi';
  }
  if (payload.app === APP_TAG) return APP_TAG;
  if (Array.isArray(payload.channels)) return APP_TAG;
  return 'unknown';
}

// ---- One API / New API → 玄枢 字段映射 ----
// One API 的 type 是数字枚举，各分支略有差异，这里只做「够用」的近似映射。
const ONEAPI_TYPE_MAP = {
  1: 'openai', 2: 'openai', 3: 'azure', 4: 'openai', 5: 'openai', 6: 'openai',
  7: 'openai', 8: 'openai', 11: 'openai', 12: 'openai', 13: 'openai',
  14: 'claude', 15: 'claude', 16: 'claude',
  24: 'gemini', 25: 'gemini', 26: 'gemini', 27: 'gemini',
};

function mapProtocol(t) {
  if (t === undefined || t === null || t === '') return 'openai';
  if (typeof t === 'number') return ONEAPI_TYPE_MAP[t] || 'openai';
  const s = String(t).toLowerCase();
  if (s.includes('azure')) return 'azure';
  if (s.includes('claude') || s.includes('anthropic')) return 'claude';
  if (s.includes('gemini') || s.includes('google') || s.includes('vertex') || s.includes('palm')) return 'gemini';
  if (s.startsWith('responses')) return 'responses';
  return 'openai';
}

function parseModels(m) {
  if (!m) return [];
  if (Array.isArray(m)) return m.map((x) => (typeof x === 'string' ? x : x?.id)).filter(Boolean);
  return String(m).split(',').map((s) => s.trim()).filter(Boolean);
}

function parseHeaders(ch) {
  const out = {};
  const tryObj = (v) => {
    if (!v) return;
    let o = v;
    if (typeof v === 'string') { try { o = JSON.parse(v); } catch { return; } }
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      for (const [k, val] of Object.entries(o)) if (k && val != null && String(val) !== '') out[k] = String(val);
    }
  };
  tryObj(ch.extraHeaders || ch.headers || ch.header_override || ch.headerOverride);
  // One API 的 other 字段里可能塞了 headers
  if (typeof ch.other === 'string' && ch.other.trim().startsWith('{')) {
    try {
      const o = JSON.parse(ch.other);
      if (o && o.headers) tryObj(o.headers);
    } catch { /* ignore */ }
  }
  return out;
}

// 单个 One API 频道 → 玄枢频道对象
function convertOneApiChannel(raw) {
  return {
    name: raw.name || raw.channel_name || '导入频道',
    baseUrl: raw.base_url || raw.baseUrl || raw.baseurl || raw.url || '',
    apiKey: raw.key || raw.api_key || raw.apiKey || raw.apikey || '',
    protocol: mapProtocol(raw.type ?? raw.protocol),
    enabled: raw.enabled !== false && raw.status !== 2,
    priority: Number.isFinite(+raw.priority) ? +raw.priority : Number.isFinite(+raw.weight) ? +raw.weight : 100,
    extraHeaders: parseHeaders(raw),
    note: '由 One API / New API 导入',
  };
}

// ---- 玄枢原生对象的规整（补齐字段，防止脏数据）----
function normalizeChannel(c) {
  return {
    id: c.id || uid('ch'),
    name: c.name || '未命名频道',
    baseUrl: c.baseUrl || '',
    apiKey: c.apiKey || '',
    protocol: c.protocol || 'openai',
    enabled: c.enabled !== false,
    priority: Number.isFinite(+c.priority) ? +c.priority : 100,
    deployment: c.deployment || '',
    apiVersion: c.apiVersion || '',
    extraHeaders: c.extraHeaders && typeof c.extraHeaders === 'object' ? c.extraHeaders : {},
    createdAt: c.createdAt || nowMs(),
    frozenUntil: 0,
    note: c.note || '',
  };
}
function normalizeModel(m) {
  return {
    id: m.id || uid('md'),
    name: m.name || m.upstreamModel || '',
    channelId: m.channelId || '',
    upstreamModel: m.upstreamModel || m.name || '',
    enabled: m.enabled !== false,
    group: m.group || 'AUTO',
    alias: m.alias || '',
    priority: Number.isFinite(+m.priority) ? +m.priority : 100,
    cooldownUntil: 0,
    disabled: false,
    note: m.note || '',
  };
}
function normalizeToken(t) {
  return {
    id: t.id || uid('tk'),
    name: t.name || 'token',
    key: t.key || uid('sk').replace('id_', 'sk-'),
    enabled: t.enabled !== false,
    createdAt: t.createdAt || nowMs(),
  };
}
function normalizeRoute(r) {
  return {
    id: r.id || uid('rt'),
    name: (r.name || '').trim(),
    strategy: ['failover', 'roundrobin', 'weighted'].includes(r.strategy) ? r.strategy : 'failover',
    enabled: r.enabled !== false,
    targets: Array.isArray(r.targets) ? r.targets.map((t) => ({ modelId: t.modelId, weight: Math.max(1, Math.floor(+t.weight) || 1) })).filter((t) => t.modelId) : [],
    createdAt: r.createdAt || nowMs(),
    note: r.note || '',
  };
}

// 单文件滚动备份（固定覆盖 config.json.bak，不随时间增长）
function backupConfig(store) {
  try {
    if (!fs.existsSync(store.configPath)) return null;
    const dst = `${store.configPath}.bak`;
    fs.copyFileSync(store.configPath, dst);
    return dst;
  } catch { return null; }
}

// ---- 导入 ----
export function applyImport(store, payload) {
  const format = detectFormat(payload);
  if (format === 'unknown') {
    return { ok: false, error: '无法识别配置格式：既不是玄枢导出的 JSON，也不是 One API / New API 的频道导出。' };
  }
  const backupPath = backupConfig(store);

  if (format === APP_TAG) {
    const src = Array.isArray(payload) ? { channels: payload } : payload;
    const counts = {};
    if (Array.isArray(src.channels)) { store.data.channels = src.channels.map(normalizeChannel); counts.channels = store.data.channels.length; }
    if (Array.isArray(src.models)) { store.data.models = src.models.map(normalizeModel); counts.models = store.data.models.length; }
    if (Array.isArray(src.groups) && src.groups.length) { store.data.groups = src.groups.map((g) => ({ name: g.name, description: g.description || '' })).filter((g) => g.name); counts.groups = store.data.groups.length; }
    if (Array.isArray(src.tokens)) { store.data.tokens = src.tokens.map(normalizeToken); counts.tokens = store.data.tokens.length; }
    if (Array.isArray(src.routes)) { store.data.routes = src.routes.map(normalizeRoute); counts.routes = store.data.routes.length; }
    store.saveNow();
    return { ok: true, format, mode: 'replace', backupPath, counts };
  }

  // oneapi → 追加
  const list = pickChannelArray(payload) || [];
  if (!list.length) return { ok: false, error: '没有找到任何频道数据。' };
  let addedChannels = 0;
  let addedModels = 0;
  for (const raw of list) {
    const conv = convertOneApiChannel(raw || {});
    if (!conv.baseUrl && !conv.apiKey && !conv.name) continue;
    const ch = store.addChannel(conv);
    addedChannels++;
    for (const m of parseModels(raw.models || raw.model)) {
      store.addModel({
        name: m, channelId: ch.id, upstreamModel: m,
        group: raw.group || store.settings.autoGroup, enabled: true, priority: ch.priority,
      });
      addedModels++;
    }
  }
  store.saveNow();
  return { ok: true, format, mode: 'merge', backupPath, counts: { channels: addedChannels, models: addedModels } };
}
