// 频道辅助：探测可达性、向上游拉取模型列表。供管理 API 调用。
import { withVersion } from './util.js';

async function fetchJson(url, headers, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return { status: res.status, ok: res.ok, json, raw: text };
  } finally {
    clearTimeout(t);
  }
}

// 组装请求头：标准 Bearer + 频道自定义头（extraHeaders）。
// 很多中转站（如 Modal / One API 系）要求自定义转发密钥头，
// 只靠 Authorization 会一直 401「missing forward secret」。
// 自定义头后写，允许覆盖 Authorization。
function buildHeaders(channel) {
  const headers = {};
  if (channel.apiKey) headers.Authorization = `Bearer ${channel.apiKey}`;
  const extra = channel.extraHeaders;
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    for (const [k, v] of Object.entries(extra)) {
      const key = String(k || '').trim();
      if (key && v !== undefined && v !== null && String(v) !== '') headers[key] = String(v);
    }
  }
  return headers;
}

// 从上游响应里尽量提取一段人类可读的错误文本。
function extractUpstreamError(r) {
  const e = r?.json?.error;
  let msg = '';
  if (typeof e === 'string') msg = e;
  else if (e && typeof e === 'object') msg = e.message || JSON.stringify(e);
  if (!msg && r?.json?.message) msg = String(r.json.message);
  if (!msg && r?.raw) msg = String(r.raw).slice(0, 200).replace(/\s+/g, ' ').trim();
  return msg;
}

// 401/403 → 鉴权失败：链接本身通常没问题，是缺密钥/密钥头。
function isAuthStatus(status) {
  return status === 401 || status === 403;
}

export async function probeChannel(channel) {
  const headers = buildHeaders(channel);
  const url = `${withVersion(channel.baseUrl)}/models`;
  const start = Date.now();
  try {
    const r = await fetchJson(url, headers, 8000);
    const authFail = isAuthStatus(r.status);
    // 只有 2xx/3xx 才算真的「通」。此前的 `status < 500` 会把 401/403 也判成通，
    // 于是 US 这种需要转发密钥的频道会出现「绿灯 889ms + 拉不到模型」的假象。
    const reachable = r.status >= 200 && r.status < 400;
    let error = null;
    let hint = null;
    if (!reachable) {
      const upstream = extractUpstreamError(r);
      if (authFail) {
        error = `鉴权失败（HTTP ${r.status}）`;
        hint = upstream
          ? `上游返回「${upstream}」，该中转站通常要求在频道里补一个自定义转发密钥头（extraHeaders）。`
          : '该中转站可能要求在频道里补充自定义转发密钥头（extraHeaders）。';
      } else if (r.status >= 500) {
        error = `上游服务异常（HTTP ${r.status}）`;
      } else if (r.status === 404) {
        error = 'HTTP 404：Base URL 里的版本段可能不对（/v1 等）';
      } else {
        error = upstream ? `HTTP ${r.status}：${upstream}` : `HTTP ${r.status}`;
      }
    }
    return { ok: reachable, authFail, status: r.status, latencyMs: Date.now() - start, error, hint };
  } catch (e) {
    const aborted = e?.name === 'AbortError';
    return {
      ok: false,
      authFail: false,
      status: 0,
      latencyMs: Date.now() - start,
      error: aborted ? '请求超时（8 秒）：Base URL 可能不通或需要代理' : String(e?.message || e),
      hint: null,
    };
  }
}

// 从上游 /v1/models 解析模型 id 列表
// 注意：必须自己兜住异常。这个函数被 Express 路由直接 await，
// 一旦抛错（例如上游超时抛 AbortError）就会变成未捕获的 Promise 拒绝，
// 在 Node 22 下默认会让整个网关进程退出——整个应用就"死"了。
export async function fetchChannelModels(channel) {
  const headers = buildHeaders(channel);
  const url = `${withVersion(channel.baseUrl)}/models`;
  let r;
  try {
    r = await fetchJson(url, headers, 10000);
  } catch (e) {
    const aborted = e?.name === 'AbortError';
    return {
      ok: false,
      models: [],
      error: aborted ? '请求超时（10 秒）：Base URL 可能不通或需要代理' : `连接失败：${e?.message || e}`,
    };
  }
  // 鉴权失败单独说清楚，并把上游原文带出来（例如 missing forward secret）
  if (isAuthStatus(r.status)) {
    const upstream = extractUpstreamError(r);
    return {
      ok: false,
      authFail: true,
      upstreamError: upstream || null,
      models: [],
      error: `鉴权失败（HTTP ${r.status}），拉不到模型。`
        + (upstream ? `上游返回「${upstream}」；该中转站通常要求在频道里补一个自定义转发密钥头（extraHeaders）。`
          : '该中转站可能要求在频道里补充自定义转发密钥头（extraHeaders）。'),
    };
  }
  if (!r.ok || !r.json || !Array.isArray(r.json.data)) {
    const upstream = extractUpstreamError(r);
    return {
      ok: false,
      upstreamError: upstream || null,
      models: [],
      error: upstream ? `上游返回「${upstream}」（HTTP ${r.status}）` : `HTTP ${r.status}`,
    };
  }
  const models = r.json.data.map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean);
  // 原始条目也带回去：部分上游会在项里带 context_length / capabilities 等扩展字段，供模型属性推断使用
  const raw = {};
  for (const m of r.json.data) {
    if (m && typeof m === 'object' && m.id) raw[m.id] = m;
  }
  return { ok: true, models, raw, error: null };
}
