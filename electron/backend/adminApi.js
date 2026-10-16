// 管理 REST API + Web Admin 静态托管 + 鉴权。
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { probeChannel, fetchChannelModels } from './channels.js';
import { buildExport, applyImport } from './configIO.js';
import { compareVersion } from './util.js';
import { modelMeta } from './modelMeta.js';
import { PROTOCOL_LABELS, PROTOCOLS } from './types.js';

// 项目主页 / 发布页（「关于」面板与「检查更新」用）
const REPO_URL = 'https://github.com/gncarl/XuanShu';
const RELEASES_URL = `${REPO_URL}/releases`;
const LATEST_RELEASE_API = 'https://api.github.com/repos/gncarl/XuanShu/releases/latest';

export function createAdminApp({ store, resilience, router, logstore, session, desktopMode, version = '' }) {
  const app = express();
  // 配置导入可能是个较大的 JSON，放宽到 8mb
  app.use(express.json({ limit: '8mb' }));

  // 鉴权中间件（桌面端免登录；headless/web-admin 若设了 adminToken 则需登录）
  app.use((req, res, next) => {
    if (req.path === '/api/health' || req.path === '/api/auth/login') return next();
    if (desktopMode) return next();
    if (!store.settings.adminToken) return next();
    const h = req.headers['x-admin-token'] || req.headers['authorization'] || '';
    if (session.authorize(store.settings.adminToken, h)) return next();
    return res.status(401).json({ error: 'unauthorized' });
  });

  app.get('/api/health', (req, res) => res.json({ ok: true, proxyPort: store.settings.proxyPort }));

  app.post('/api/auth/login', (req, res) => {
    const r = session.login(store.settings.adminToken, req.body?.token || '');
    if (r.ok) return res.json({ ok: true, token: r.token });
    res.status(401).json({ ok: false, error: 'wrong admin token' });
  });

  // 一次性把面板所需状态全部拉回
  app.get('/api/state', (req, res) => {
    res.json({
      version,
      settings: store.settings,
      channels: store.listChannels(),
      models: store.listModels(),
      routes: store.listRoutes(),
      groups: store.listGroups(),
      tokens: store.listTokens(),
      protocolLabels: PROTOCOL_LABELS,
    });
  });

  // ---- 关于 / 检查更新 ----
  app.get('/api/about', (req, res) => {
    res.json({
      app: '玄枢',
      name: 'XuanShu',
      version,
      repo: REPO_URL,
      releases: RELEASES_URL,
      latestReleaseApi: LATEST_RELEASE_API,
    });
  });

  // 检查更新：查 GitHub 最近一个已发布的 Release，和本地版本比大小。
  app.get('/api/check-update', async (req, res) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      let r;
      try {
        r = await fetch(LATEST_RELEASE_API, {
          signal: ctrl.signal,
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'XuanShu-Gateway' },
        });
      } finally {
        clearTimeout(timer);
      }
      if (r.status === 404) {
        return res.json({ ok: true, current: version, latest: version, hasUpdate: false, note: '仓库暂无已发布的 Release。' });
      }
      if (!r.ok) return res.json({ ok: false, error: `GitHub API 返回 HTTP ${r.status}` });
      const j = await r.json();
      const tag = String(j.tag_name || '');
      const latest = tag.replace(/^v/i, '');
      res.json({
        ok: true,
        current: version,
        latest,
        tag,
        hasUpdate: !!(latest && compareVersion(version, latest) < 0),
        url: j.html_url || RELEASES_URL,
        name: j.name || tag,
        publishedAt: j.published_at || null,
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted = e?.name === 'AbortError';
      res.json({ ok: false, error: aborted ? '检查超时：网络不通或需要代理' : String(e?.message || e) });
    }
  });

  // ---- 配置导出 / 导入 ----
  app.get('/api/config/export', (req, res) => {
    res.json(buildExport(store, { version }));
  });
  app.post('/api/config/import', (req, res) => {
    try {
      const result = applyImport(store, req.body);
      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.put('/api/settings', (req, res) => {
    const s = store.updateSettings(req.body || {});
    logstore.setSettings(s);
    res.json({ ok: true, settings: s });
  });

  // ---- 频道 ----
  app.get('/api/channels', (req, res) => res.json(store.listChannels()));
  app.post('/api/channels', (req, res) => res.json(store.addChannel(req.body || {})));
  app.put('/api/channels/:id', (req, res) => {
    const c = store.updateChannel(req.params.id, req.body || {});
    if (!c) return res.status(404).json({ error: 'not found' });
    res.json(c);
  });
  app.delete('/api/channels/:id', (req, res) => { store.removeChannel(req.params.id); res.json({ ok: true }); });
  app.post('/api/channels/:id/probe', async (req, res) => {
    const c = store.getChannel(req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    res.json(await probeChannel(c));
  });
  app.post('/api/channels/:id/fetchModels', async (req, res) => {
    const c = store.getChannel(req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    const r = await fetchChannelModels(c);
    // 附带每个模型的属性元数据（能力/上下文），供前端打小标签
    if (r && r.ok && Array.isArray(r.models)) {
      const poolMeta = new Map();
      for (const m of store.listModels()) {
        if (m.channelId === c.id && m.meta) poolMeta.set(m.upstreamModel || m.name, m.meta);
      }
      r.metas = Object.fromEntries(
        r.models.map((name) => [name, modelMeta(name, { upstream: r.raw?.[name], userMeta: poolMeta.get(name) })]),
      );
    }
    res.json(r);
  });

  // 批量查询模型属性（模型池表格用）：?names=a,b,c
  app.get('/api/model-meta', (req, res) => {
    const names = String(req.query.names || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 500);
    const poolMeta = new Map();
    for (const m of store.listModels()) {
      if (m.meta) poolMeta.set(m.upstreamModel || m.name, m.meta);
    }
    const out = {};
    for (const n of names) out[n] = modelMeta(n, { userMeta: poolMeta.get(n) });
    res.json(out);
  });
  app.post('/api/channels/:id/speedtest', async (req, res) => {
    const c = store.getChannel(req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    const r = await probeChannel(c);
    res.json({ latencyMs: r.latencyMs, ok: r.ok });
  });

  // ---- 模型池 ----
  app.get('/api/models', (req, res) => res.json(store.listModels()));
  app.post('/api/models', (req, res) => res.json(store.addModel(req.body || {})));
  app.put('/api/models/:id', (req, res) => {
    const m = store.updateModel(req.params.id, req.body || {});
    if (!m) return res.status(404).json({ error: 'not found' });
    res.json(m);
  });
  app.delete('/api/models/:id', (req, res) => { store.removeModel(req.params.id); res.json({ ok: true }); });
  // 手动重置某模型的冷却/禁用（解除熔断需等待，这里直接清冷却与禁用）
  app.post('/api/models/:id/reset', (req, res) => {
    const m = store.getModel(req.params.id);
    if (!m) return res.status(404).json({ error: 'not found' });
    store.updateModel(req.params.id, { cooldownUntil: 0, disabled: false });
    resilience.breakers.delete(`${m.channelId}:${m.upstreamModel}`);
    res.json({ ok: true });
  });

  // ---- 路由规则（虚拟模型）----
  app.get('/api/routes', (req, res) => res.json(store.listRoutes()));
  app.post('/api/routes', (req, res) => res.json(store.addRoute(req.body || {})));
  app.put('/api/routes/:id', (req, res) => {
    const r = store.updateRoute(req.params.id, req.body || {});
    if (!r) return res.status(404).json({ error: 'not found' });
    res.json(r);
  });
  app.delete('/api/routes/:id', (req, res) => { store.removeRoute(req.params.id); res.json({ ok: true }); });

  // ---- 分组 ----
  app.get('/api/groups', (req, res) => res.json(store.listGroups()));
  app.post('/api/groups', (req, res) => {
    const g = store.addGroup(req.body || {});
    if (!g) return res.status(409).json({ error: 'exists' });
    res.json(g);
  });
  app.delete('/api/groups/:name', (req, res) => { store.removeGroup(decodeURIComponent(req.params.name)); res.json({ ok: true }); });

  // ---- 令牌 ----
  app.get('/api/tokens', (req, res) => res.json(store.listTokens()));
  app.post('/api/tokens', (req, res) => res.json(store.addToken(req.body || {})));
  app.delete('/api/tokens/:id', (req, res) => { store.removeToken(req.params.id); res.json({ ok: true }); });

  // ---- 日志 ----
  app.get('/api/logs', (req, res) => {
    const q = {
      page: +(req.query.page || 1),
      pageSize: +(req.query.pageSize || 30),
      success: req.query.success === '' || req.query.success === undefined ? undefined : req.query.success === 'true',
      model: req.query.model || undefined,
      channelId: req.query.channelId || undefined,
    };
    res.json(logstore.query(q));
  });
  app.get('/api/logs/stats', (req, res) => res.json(logstore.stats()));
  app.delete('/api/logs', (req, res) => { logstore.clear(); res.json({ ok: true }); });

  // ---- 静态托管前端（Web Admin）----
  const distDir = path.join(import.meta.dirname, '..', '..', 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api')) return res.status(404).json({ error: 'not found' });
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}
