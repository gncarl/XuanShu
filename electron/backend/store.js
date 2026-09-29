// 配置存储：所有频道/模型/分组/令牌/设置都落在本地 JSON 文件。
// 关键点：不备份、不复制整库 —— 修改即原地写回，从根本上杜绝 30G 备份膨胀。
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, STORE_VERSION, PROTOCOLS } from './types.js';
import { uid, deepMerge, nowMs } from './util.js';

// 路由策略白名单
export const ROUTE_STRATEGIES = ['failover', 'roundrobin', 'weighted'];

// 归一化路由目标：去重、权重取整且 >=1。
function normalizeTargets(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const modelId = (t && t.modelId) || '';
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);
    out.push({ modelId, weight: Math.max(1, Math.floor(Number(t?.weight) || 1)) });
  }
  return out;
}

export class DataStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.configPath = path.join(dataDir, 'config.json');
    this.data = null;
    this._saveTimer = null;
  }

  init() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (fs.existsSync(this.configPath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      } catch {
        this.data = null;
      }
    }
    if (!this.data || typeof this.data !== 'object') {
      this.data = {};
    }
    // 补齐缺省结构
    this.data.version = STORE_VERSION;
    this.data.settings = deepMerge({ ...DEFAULT_SETTINGS }, this.data.settings || {});
    if (!this.data.settings.adminToken) this.data.settings.adminToken = '';
    this.data.channels = this.data.channels || [];
    this.data.models = this.data.models || [];
    this.data.groups = this.data.groups || [{ name: 'AUTO', description: '自动组：未命中具体模型时回退至此' }];
    this.data.tokens = this.data.tokens || [];
    this.data.routes = this.data.routes || [];
    // 首次启动放一个示例频道占位，方便上手（用户可删除）
    if (this.data.channels.length === 0) {
      this._seedDemo();
    }
    this.saveNow();
    return this;
  }

  _seedDemo() {
    const ch = {
      id: uid('ch'),
      name: '示例-OpenAI兼容',
      baseUrl: 'https://api.openai.com',
      apiKey: '',
      protocol: PROTOCOLS.OPENAI,
      enabled: false,
      priority: 100,
      createdAt: nowMs(),
      frozenUntil: 0,
    };
    this.data.channels.push(ch);
  }

  // ---- 持久化（防抖写盘）----
  save() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => this.saveNow(), 150);
  }
  saveNow() {
    this._saveTimer = null;
    fs.writeFileSync(this.configPath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  // ---- 设置 ----
  get settings() { return this.data.settings; }
  updateSettings(patch) {
    this.data.settings = deepMerge(this.data.settings, patch);
    this.save();
    return this.data.settings;
  }

  // ---- 频道 ----
  listChannels() { return this.data.channels; }
  getChannel(id) { return this.data.channels.find((c) => c.id === id) || null; }
  addChannel(ch) {
    const c = {
      id: uid('ch'),
      name: ch.name || '未命名频道',
      baseUrl: ch.baseUrl || '',
      apiKey: ch.apiKey || '',
      protocol: ch.protocol || PROTOCOLS.OPENAI,
      enabled: ch.enabled !== false,
      priority: ch.priority ?? 100,
      deployment: ch.deployment || '',
      extraHeaders: ch.extraHeaders || {},
      createdAt: nowMs(),
      frozenUntil: 0,
      note: ch.note || '',
    };
    this.data.channels.push(c);
    this.save();
    return c;
  }
  updateChannel(id, patch) {
    const c = this.getChannel(id);
    if (!c) return null;
    Object.assign(c, patch);
    this.save();
    return c;
  }
  removeChannel(id) {
    this.data.channels = this.data.channels.filter((c) => c.id !== id);
    // 同时移除该频道下的模型
    this.data.models = this.data.models.filter((m) => m.channelId !== id);
    this._pruneRoutes();
    this.save();
  }

  // ---- 模型池 ----
  listModels() { return this.data.models; }
  getModel(id) { return this.data.models.find((m) => m.id === id) || null; }
  addModel(m) {
    const model = {
      id: uid('md'),
      name: m.name || '',
      channelId: m.channelId || '',
      upstreamModel: m.upstreamModel || m.name || '',
      enabled: m.enabled !== false,
      group: m.group || 'AUTO',
      alias: m.alias || '',
      priority: m.priority ?? 100,
      cooldownUntil: 0,
      disabled: false,
      note: m.note || '',
    };
    this.data.models.push(model);
    this.save();
    return model;
  }
  updateModel(id, patch) {
    const m = this.getModel(id);
    if (!m) return null;
    Object.assign(m, patch);
    this.save();
    return m;
  }
  removeModel(id) {
    this.data.models = this.data.models.filter((m) => m.id !== id);
    this._pruneRoutes();
    this.save();
  }
  setModelCooldown(id, until) {
    const m = this.getModel(id);
    if (m) { m.cooldownUntil = until; this.save(); }
  }
  setModelDisabled(id, disabled) {
    const m = this.getModel(id);
    if (m) { m.disabled = !!disabled; this.save(); }
  }

  // ---- 分组 ----
  listGroups() { return this.data.groups; }
  addGroup(g) {
    if (this.data.groups.find((x) => x.name === g.name)) return null;
    const grp = { name: g.name, description: g.description || '' };
    this.data.groups.push(grp);
    this.save();
    return grp;
  }
  removeGroup(name) {
    this.data.groups = this.data.groups.filter((g) => g.name !== name);
    this.save();
  }

  // ---- 路由规则（虚拟模型）----
  // 一个客户端模型名（如 auto / local）→ 一组上游目标 + 路由策略。
  // target.modelId 指向本文件模型池里的条目；删除模型/频道时自动清理悬空目标。
  listRoutes() { return this.data.routes; }
  getRoute(id) { return this.data.routes.find((r) => r.id === id) || null; }
  addRoute(r) {
    const route = {
      id: uid('rt'),
      name: (r.name || '').trim(),
      strategy: ROUTE_STRATEGIES.includes(r.strategy) ? r.strategy : 'failover',
      enabled: r.enabled !== false,
      targets: normalizeTargets(r.targets),
      createdAt: nowMs(),
      note: r.note || '',
    };
    this.data.routes.push(route);
    this.save();
    return route;
  }
  updateRoute(id, patch) {
    const r = this.getRoute(id);
    if (!r) return null;
    const next = { ...patch };
    if ('targets' in next) next.targets = normalizeTargets(next.targets);
    if ('strategy' in next && !ROUTE_STRATEGIES.includes(next.strategy)) delete next.strategy;
    if ('name' in next) next.name = String(next.name || '').trim();
    Object.assign(r, next);
    this.save();
    return r;
  }
  removeRoute(id) {
    this.data.routes = this.data.routes.filter((r) => r.id !== id);
    this.save();
  }
  // 清理指向已不存在模型的路由目标（模型/频道被删后调用）
  _pruneRoutes() {
    const ids = new Set(this.data.models.map((m) => m.id));
    for (const r of this.data.routes) {
      const before = r.targets.length;
      r.targets = r.targets.filter((t) => ids.has(t.modelId));
      if (r.targets.length !== before) r.updatedAt = nowMs();
    }
  }

  // ---- 令牌（客户端 Access Key）----
  listTokens() { return this.data.tokens; }
  addToken(t) {
    const tok = {
      id: uid('tk'),
      name: t.name || 'token',
      key: t.key || uid('sk').replace('id_', 'sk-'),
      enabled: t.enabled !== false,
      createdAt: nowMs(),
    };
    this.data.tokens.push(tok);
    this.save();
    return tok;
  }
  removeToken(id) {
    this.data.tokens = this.data.tokens.filter((t) => t.id !== id);
    this.save();
  }
  findToken(key) {
    return this.data.tokens.find((t) => t.enabled && t.key === key) || null;
  }
}
