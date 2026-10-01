// 与本地管理 API 通信（同源 /api）。
const BASE = '/api';

async function req(method: string, url: string, body?: any) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

// 桌面端自动带 adminToken 免登录（headless/web-admin 未设则不带）
function authHeader(): Record<string, string> {
  try {
    const t = localStorage.getItem('adminToken') || '';
    return t ? { 'X-Admin-Token': t } : {};
  } catch { return {}; }
}

export const api = {
  health: () => req('GET', '/health'),
  login: (token: string) => req('POST', '/auth/login', { token }),
  state: () => req('GET', '/state'),
  saveSettings: (patch: any) => req('PUT', '/settings', patch),

  listChannels: () => req('GET', '/channels'),
  addChannel: (c: any) => req('POST', '/channels', c),
  updateChannel: (id: string, c: any) => req('PUT', `/channels/${id}`, c),
  deleteChannel: (id: string) => req('DELETE', `/channels/${id}`),
  probeChannel: (id: string) => req('POST', `/channels/${id}/probe`),
  fetchModels: (id: string) => req('POST', `/channels/${id}/fetchModels`),
  speedtest: (id: string) => req('POST', `/channels/${id}/speedtest`),

  listModels: () => req('GET', '/models'),
  addModel: (m: any) => req('POST', '/models', m),
  updateModel: (id: string, m: any) => req('PUT', `/models/${id}`, m),
  deleteModel: (id: string) => req('DELETE', `/models/${id}`),
  resetModel: (id: string) => req('POST', `/models/${id}/reset`),

  listRoutes: () => req('GET', '/routes'),
  addRoute: (r: any) => req('POST', '/routes', r),
  updateRoute: (id: string, r: any) => req('PUT', `/routes/${id}`, r),
  deleteRoute: (id: string) => req('DELETE', `/routes/${id}`),

  listGroups: () => req('GET', '/groups'),
  addGroup: (g: any) => req('POST', '/groups', g),
  deleteGroup: (name: string) => req('DELETE', `/groups/${encodeURIComponent(name)}`),

  listTokens: () => req('GET', '/tokens'),
  addToken: (t: any) => req('POST', '/tokens', t),
  deleteToken: (id: string) => req('DELETE', `/tokens/${id}`),

  logs: (q: any) => req('GET', '/logs?' + new URLSearchParams(
    Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]),
  ).toString()),
  logStats: () => req('GET', '/logs/stats'),
  clearLogs: () => req('DELETE', '/logs'),
};
