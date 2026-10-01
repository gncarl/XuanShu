// 代理服务器：统一 OpenAI 兼容端点 + Claude Messages 端点。
// 负责鉴权、路由、多级容错、流式回流、空流保护、请求日志。
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { prepareRequest, makeResponseMapper, transformNonStream, makeOpenAIToClaudeMapper, openaiChatToClaude } from './protocols.js';
import { nowMs } from './util.js';

const MAX_RETRIES = 6;

// 解析可重试状态码列表（设置里的 "500,502,503,504" → Set）
function parseRetryCodes(s) {
  const out = new Set();
  for (const part of String(s || '').split(/[^0-9]+/)) {
    const n = parseInt(part, 10);
    if (n >= 100 && n <= 599) out.add(n);
  }
  return out;
}

export class ProxyServer {
  constructor({ store, resilience, router, logstore, settings }) {
    this.store = store;
    this.res = resilience;
    this.router = router;
    this.log = logstore;
    this.server = null;
  }

  get settings() { return this.store.settings; }

  createServer() {
    return http.createServer((req, res) => this._onRequest(req, res));
  }

  close() { this.server?.close(); }

  _clientToken(req) {
    const auth = req.headers['authorization'] || '';
    const xkey = req.headers['x-api-key'] || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    return (m ? m[1] : xkey || '').trim();
  }

  _authed(req) {
    if (!this.settings.enforceToken) return true;
    const tok = this._clientToken(req);
    return !!this.store.findToken(tok);
  }

  async _onRequest(req, res) {
    const url = new URL(req.url, `http://127.0.0.1`);
    const path = url.pathname;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    try {
      if (req.method === 'GET' && path === '/v1/models') {
        return this._serveModels(res);
      }
      if (req.method === 'POST' && (path === '/v1/chat/completions' || path === '/v1/responses' || path === '/v1/messages')) {
        const body = await readJson(req);
        if (!body) { return sendJson(res, 400, { error: 'invalid JSON body' }); }
        if (!this._authed(req)) { return sendJson(res, 401, { error: 'Access Key required' }); }
        const clientProtocol = path === '/v1/messages' ? 'claude' : (path === '/v1/responses' ? 'responses' : 'openai');
        return await this._handleChat(req, res, { body, clientProtocol });
      }
      sendJson(res, 404, { error: `unknown path ${path}` });
    } catch (e) {
      sendJson(res, 500, { error: String(e.message || e) });
    }
  }

  _serveModels(res) {
    const data = this.store.listModels().filter((m) => m.enabled).map((m) => ({
      id: m.name,
      object: 'model',
      created: Math.floor((m.createdAt || nowMs()) / 1000),
      owned_by: 'xuanshu',
      _upstream: m.upstreamModel,
      _channel: this.store.getChannel(m.channelId)?.name,
    }));
    // 路由规则（虚拟模型）也算可选模型，且同名时覆盖普通模型（解析时路由优先）
    const map = new Map();
    for (const m of data) map.set(m.id, m);
    for (const r of this.store.listRoutes()) {
      if (!r.enabled || !r.name) continue;
      map.set(r.name, {
        id: r.name,
        object: 'model',
        created: Math.floor((r.createdAt || nowMs()) / 1000),
        owned_by: 'xuanshu',
        _route: r.strategy,
        _targets: (r.targets || []).length,
      });
    }
    sendJson(res, 200, { object: 'list', data: [...map.values()] });
  }

  async _handleChat(req, res, { body, clientProtocol }) {
    // Claude 端点：先把 Anthropic 请求转成内部 OpenAI Chat
    let innerBody = body;
    if (clientProtocol === 'claude') {
      const { chatToClaude } = await import('./protocols.js');
      innerBody = chatToClaude(body, body.model);
    }
    const requested = innerBody.model || this.settings.autoGroup;
    const { candidates, usedAuto, route, strategy } = this.router.resolve(requested);
    if (!candidates.length) {
      return sendJson(res, 503, { error: 'no available channel/model', note: '请先在频道与模型池中添加并启用上游' });
    }

    const attempts = [];
    const stream = !!innerBody.stream;
    let committed = false;

    // 接口重试配置：上游返回可重试状态码时，同一目标先原地重试，再切换下一个
    const retryCodes = this.settings.retryEnabled ? parseRetryCodes(this.settings.retryStatusCodes) : new Set();
    const maxRetries = Math.max(0, Math.min(10, Math.floor(Number(this.settings.maxRetries) || 0)));
    const retryIntervalMs = Math.max(0, (Number(this.settings.retryIntervalSec) || 0) * 1000);

    for (const cand of candidates.slice(0, MAX_RETRIES)) {
      const { model, channel } = cand;
      // 尝试前再次确认可用性（状态可能在解析后变化）
      if (this.res.isModelCooled(model) || this.res.isChannelFrozen(channel.id) || this.res.isBreakerOpen(channel.id, model.upstreamModel)) {
        attempts.push({ channel: channel.name, model: model.upstreamModel, skipped: true, reason: 'resilience-unavailable' });
        continue;
      }
      const started = nowMs();
      let outcome = null;
      let sameTargetTry = 0;
      while (true) {
        sameTargetTry++;
        const spec = prepareRequest(channel, model.upstreamModel, innerBody);
        try {
          outcome = await this._forwardOnce(spec, { stream, clientProtocol, model, channel, res, requested });
        } catch (e) {
          outcome = { type: 'fail', status: 0, empty: false, error: String(e.message || e) };
        }
        if (outcome.type === 'commit') break;

        // 可重试状态码 → 同一目标原地重试（重试不记容错，避免一次抖动就冷却模型）
        if (outcome.status > 0 && retryCodes.has(outcome.status) && sameTargetTry <= maxRetries) {
          attempts.push({ channel: channel.name, model: model.upstreamModel, status: outcome.status, retry: sameTargetTry });
          if (retryIntervalMs > 0) await new Promise((r) => setTimeout(r, retryIntervalMs));
          continue;
        }
        break;
      }

      if (outcome.type === 'commit') {
        committed = true;
        // 等待流结束，再记录日志
        const latency = nowMs() - started;
        await outcome.done;
        this.log.append({
          ts: nowMs(), success: true, model: requested, usedAuto, route: route || '', strategy: strategy || '',
          channelId: channel.id, channelName: channel.name, upstreamModel: model.upstreamModel,
          protocol: channel.protocol, status: outcome.status, latencyMs: latency,
          promptTokens: outcome.usage?.prompt_tokens || 0,
          completionTokens: outcome.usage?.completion_tokens || 0,
          totalTokens: outcome.usage?.total_tokens || 0,
          attempts,
        });
        return; // 已完成
      }

      // 失败：应用容错
      const latency = nowMs() - started;
      this.res.recordFailure(channel.id, model.upstreamModel);
      if (outcome.status === 0) {
        // 网络错误 / 空流：冷却该模型 + 必要时冻结频道
        this.res.coolModel(model);
        if (outcome.empty) this.res.freezeChannel(channel.id);
        attempts.push({ channel: channel.name, model: model.upstreamModel, status: 0, empty: outcome.empty, error: outcome.error, latencyMs: latency });
      } else if (this.res.isFatalStatus(outcome.status)) {
        this.res.disableModel(model);
        attempts.push({ channel: channel.name, model: model.upstreamModel, status: outcome.status, fatal: true, latencyMs: latency });
      } else {
        this.res.coolModel(model);
        attempts.push({ channel: channel.name, model: model.upstreamModel, status: outcome.status, latencyMs: latency });
      }
    }

    if (!committed) {
      this.log.append({
        ts: nowMs(), success: false, model: requested, usedAuto, route: route || '', strategy: strategy || '',
        channelId: '', channelName: '', upstreamModel: '', protocol: '', status: 502,
        latencyMs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, attempts,
      });
      if (stream) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'all upstreams failed', attempts }));
      } else {
        sendJson(res, 502, { error: 'all upstreams failed', attempts });
      }
    }
  }

  // 向上游发一次请求；返回 {type:'commit'|'fail', status, done?, empty?, error?, usage?}
  _forwardOnce(spec, { stream, clientProtocol, model, channel, res, requested }) {
    return new Promise((resolve) => {
      const u = new URL(spec.url);
      const lib = u.protocol === 'https:' ? https : http;
      const headers = { ...spec.headers, host: u.host };
      const bodyStr = typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body);

      const req = lib.request({
        hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search, method: spec.method, headers,
      }, (upstream) => {
        const status = upstream.statusCode || 0;

        // 非流式：直接收完
        if (!stream) {
          const chunks = [];
          upstream.on('data', (c) => chunks.push(c));
          upstream.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (status < 200 || status >= 300) { resolve({ type: 'fail', status }); return; }
            let json = null; try { json = JSON.parse(text); } catch { json = { raw: text }; }
            let out = transformNonStream(channel.protocol, json, model.upstreamModel);
            if (clientProtocol === 'claude') out = openaiChatToClaude(out);
            sendJson(res, 200, out);
            const usage = out?.usage || json?.usage || {};
            resolve({ type: 'commit', status, usage, done: Promise.resolve() });
          });
          return;
        }

        // 流式下若上游直接返回错误状态码，立即判失败并切下一个候选（不向客户端写任何内容）
        if (status < 200 || status >= 300) {
          try { upstream.destroy(); } catch {}
          return resolve({ type: 'fail', status });
        }

        // 流式：先等首个字节（空流保护），再决定是否提交给客户端
        const usageBox = {};
        // 二级映射：把上游归一化后的 OpenAI SSE 转成客户端需要的格式
        let claudeClient = null;
        const clientOut = clientProtocol === 'claude'
          ? (s) => {
              claudeClient = claudeClient || makeOpenAIToClaudeMapper({ out: (x) => res.write(x) });
              for (const line of s.split('\n')) { const t = line.trim(); if (t.startsWith('data:')) claudeClient.handleLine(t); }
            }
          : (s) => res.write(s);
        const mapper = makeResponseMapper(channel.protocol, { out: clientOut, model: model.upstreamModel, requestedModel: requested, usageBox });
        const identity = { handleLine: (l) => clientOut(l + '\n\n'), finish: () => {} };
        const useMapper = mapper || identity;
        let firstByte = false;
        let committedHeaders = false;
        const timeoutMs = this.settings.emptyStreamTimeoutMs || 8000;
        const timer = setTimeout(() => {
          if (!firstByte) { req.destroy(); resolve({ type: 'fail', status: 0, empty: true, error: 'empty stream timeout' }); }
        }, timeoutMs);

        const buf = { text: '' };
        upstream.on('data', (c) => {
          if (!firstByte) {
            firstByte = true; clearTimeout(timer);
            if (!committedHeaders) {
              committedHeaders = true;
              res.writeHead(200, {
                'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store',
                'Connection': 'keep-alive', 'X-Accel-Buffering': 'no',
              });
            }
          }
          buf.text += c.toString('utf8');
          for (const line of c.toString('utf8').split('\n')) {
            const l = line.replace(/\r$/, '');
            if (l) useMapper.handleLine(l);
          }
        });
        upstream.on('end', () => {
          clearTimeout(timer);
          if (!committedHeaders) {
            // 整个流为空（无任何数据）
            resolve({ type: 'fail', status: 0, empty: true, error: 'empty upstream response' });
            return;
          }
          if (channel.protocol !== 'openai' && channel.protocol !== 'azure') useMapper.finish();
          if (claudeClient) claudeClient.finish(usageBox.usage || extractUsage(buf.text));
          res.end();
          const usage = usageBox.usage || extractUsage(buf.text);
          resolve({ type: 'commit', status, usage, done: Promise.resolve() });
        });
        upstream.on('error', (e) => {
          clearTimeout(timer);
          try { res.end(); } catch {}
          resolve({ type: 'fail', status: 0, empty: !firstByte, error: String(e.message || e) });
        });
      });

      req.on('error', (e) => {
        resolve({ type: 'fail', status: 0, empty: false, error: String(e.message || e) });
      });
      req.setTimeout(60000, () => req.destroy(new Error('upstream timeout')));
      req.write(bodyStr);
      req.end();
    });
  }
}

// ---------- 工具 ----------
function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

function sendJson(res, status, obj) {
  const text = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(text);
}

function extractUsage(text) {
  // 从透传的 openai SSE 中抓最后一个带 usage 的块
  const blocks = text.split('\n').filter((l) => l.startsWith('data:'));
  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      const o = JSON.parse(blocks[i].slice(5).trim());
      if (o.usage) return o.usage;
    } catch {}
  }
  return {};
}
