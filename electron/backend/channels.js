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

export async function probeChannel(channel) {
  const headers = channel.apiKey ? { Authorization: `Bearer ${channel.apiKey}` } : {};
  const url = `${withVersion(channel.baseUrl)}/models`;
  const start = Date.now();
  try {
    const r = await fetchJson(url, headers, 8000);
    return { ok: r.status < 500, status: r.status, latencyMs: Date.now() - start, error: r.ok ? null : `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, status: 0, latencyMs: Date.now() - start, error: String(e.message || e) };
  }
}

// 从上游 /v1/models 解析模型 id 列表
// 注意：必须自己兜住异常。这个函数被 Express 路由直接 await，
// 一旦抛错（例如上游超时抛 AbortError）就会变成未捕获的 Promise 拒绝，
// 在 Node 22 下默认会让整个网关进程退出——整个应用就"死"了。
export async function fetchChannelModels(channel) {
  const headers = channel.apiKey ? { Authorization: `Bearer ${channel.apiKey}` } : {};
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
  if (!r.ok || !r.json || !Array.isArray(r.json.data)) {
    return { ok: false, models: [], error: r.json?.error?.message || `HTTP ${r.status}` };
  }
  const models = r.json.data.map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean);
  return { ok: true, models, error: null };
}
