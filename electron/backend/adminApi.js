// 管理 REST API + Web Admin 静态托管 + 鉴权。
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { probeChannel, fetchChannelModels } from './channels.js';
import { PROTOCOL_LABELS, PROTOCOLS } from './types.js';

export function createAdminApp({ store, resilience, router, logstore, session, desktopMode }) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

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
      settings: store.settings,
      channels: store.listChannels(),
      models: store.listModels(),
      routes: store.listRoutes(),
      groups: store.listGroups(),
      tokens: store.listTokens(),
      protocolLabels: PROTOCOL_LABELS,
    });
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
    res.json(await fetchChannelModels(c));
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

  // ---- App 连接器：生成常见 AI 工具的配置片段 ----
  app.get('/api/connectors/:tool', (req, res) => {
    const proxy = `http://127.0.0.1:${store.settings.proxyPort}`;
    const tool = req.params.tool;
    const snippets = {
      claude: { env: { ANTHROPIC_BASE_URL: `${proxy}/v1`, ANTHROPIC_AUTH_TOKEN: 'any' }, note: '把 ANTHROPIC_BASE_URL 指向网关的 /v1（Claude Messages 端点）。' },
      opencode: { config: { provider: { base_url: `${proxy}/v1`, api_key: 'any' } }, note: 'OpenCode 的 provider.base_url 指向网关 /v1。' },
      codex: { env: { OPENAI_BASE_URL: `${proxy}/v1`, OPENAI_API_KEY: 'any' }, note: 'Codex 用 OPENAI_BASE_URL 指向网关 /v1。' },
      zed: { config: { "language_models": { "openai": { "api_url": `${proxy}/v1`, "available_models": ["auto"] } } }, note: 'Zed 设置里把 openai.api_url 指向网关 /v1。' },
    };
    res.json(snippets[tool] || { error: 'unknown tool', supported: Object.keys(snippets) });
  });

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
