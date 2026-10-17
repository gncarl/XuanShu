// 端到端验证：起一个 mock 上游 + 网关后端，验证路由/容错/五协议转换/空流保护。
// 不需要任何真实 API Key。
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { startBackend } from '../electron/backend/index.js';
import { fetchChannelModels, probeChannel } from '../electron/backend/channels.js';
import { buildExport, applyImport, detectFormat } from '../electron/backend/configIO.js';
import { modelMeta } from '../electron/backend/modelMeta.js';
import { withVersion } from '../electron/backend/util.js';

const results = [];
function check(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
}

// ---------- mock 上游 ----------
const recorded = []; // 记录每个请求的原始 path，用于验证上游 URL 拼接是否正确
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let json = {};
    try { json = JSON.parse(body || '{}'); } catch {}
    const model = json.model;
    const url = req.url;
    recorded.push(url);

    if (req.method === 'GET' && url.includes('/secure/') && url.endsWith('/models')) {
      // 模拟「要求自定义转发密钥头」的中转站（如 Modal）
      if (req.headers['x-forward-secret'] !== 'sec-123') {
        return end(res, 401, { error: 'missing forward secret' });
      }
      return end(res, 200, { object: 'list', data: [{ id: 'secure-model' }] });
    }
    if (req.method === 'GET' && url.includes('/v1/models')) {
      return end(res, 200, { object: 'list', data: [
        { id: 'mock-gpt' }, { id: 'fail-model' }, { id: 'empty-model' },
        { id: 'glm-4-flash', context_length: 128000 },                 // 上游带扩展字段
        { id: 'mystery-model-9000', context_length: 9000 },            // 注册表没有，仅上游有上下文
      ] });
    }
    if (url.includes('/v1beta/models/') && url.includes('streamGenerateContent')) {
      if (!json.stream) {
        return end(res, 200, { candidates: [{ content: { parts: [{ text: 'hi-from-gemini' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 } });
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi-from-gemini' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 } }) + '\n\n');
      return res.end();
    }
    if (url.includes('/v1/messages')) {
      if (!json.stream) {
        return end(res, 200, { id: 'm1', type: 'message', role: 'assistant', model: 'claude', content: [{ type: 'text', text: 'hi-from-claude' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 2 } });
      }
      // Claude 原生 SSE 响应
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      ev('message_start', { type: 'message_start', message: { id: 'm1', role: 'assistant' } });
      ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text' } });
      ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi-from-claude' } });
      ev('content_block_stop', { type: 'content_block_stop', index: 0 });
      ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 3, output_tokens: 2 } });
      ev('message_stop', { type: 'message_stop' });
      return res.end();
    }
    if (url.includes('/chat/completions')) {
      if (model === 'missing-model') return end(res, 404, { error: 'model not found' });
      if (model === 'fail-model') return end(res, 500, { error: 'upstream boom' });
      if (model === 'ratelimit-model') {
        // 限流并告知多久后恢复：验证网关按 Retry-After 冷却而非固定 cooldownMs
        res.writeHead(429, { 'Retry-After': '2', 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'rate limited' } }));
      }
      if (model === 'empty-model') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); return res.end(); } // 空流
      if (model === 'slow-first') {
        // 首 token 延迟 12s：复现「推理模型慢思考被旧 8s 空流保护腰斩」的回归
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        setTimeout(() => {
          res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'hi-from-openai:slow-first' } }] }) + '\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
        }, 12000);
        return;
      }
      if (model === 'pauses') {
        // 首 token 立即返回，再静默 6s 才出第二段 —— 验证流中空闲不会被误杀
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'part1' } }] }) + '\n\n');
        setTimeout(() => {
          res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'part2' } }] }) + '\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
        }, 6000);
        return;
      }
      if (!json.stream) {
        return end(res, 200, { id: '1', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'hi-from-openai:' + model } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: ' + JSON.stringify({ id: '1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] }) + '\n\n');
      res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'hi-from-openai:' + model } }] }) + '\n\n');
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    end(res, 404, { error: 'mock no route' });
  });
});
function end(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function mockListen(p) { return new Promise((r) => mock.listen(p, '127.0.0.1', () => r(p))); }

// ---------- 客户端请求 ----------
function client(port, path, body, headers = {}) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', (e) => resolve({ status: 0, body: String(e) }));
    req.write(data);
    req.end();
  });
}
function get(port, path) {
  return new Promise((resolve) => {
    http.get({ hostname: '127.0.0.1', port, path }, (res) => {
      let out = ''; res.on('data', (c) => (out += c)); res.on('end', () => resolve({ status: res.statusCode, body: out }));
    }).on('error', (e) => resolve({ status: 0, body: String(e) }));
  });
}

async function main() {
  const mockPort = await mockListen(19899);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigw-'));
  const { proxyPort, adminPort, store, logstore, proxy } = await startBackend({ isDesktop: false, dataDir, version: '0.2.5' });
  const base = `http://127.0.0.1:${proxyPort}`;

  // 清空示例，建立测试数据
  store.data.channels = []; store.data.models = [];
  const mkCh = (proto, upstreamModelNote) => store.addChannel({ name: 'mock-' + proto, baseUrl: `http://127.0.0.1:${mockPort}`, apiKey: 'k', protocol: proto, enabled: true, priority: 1 });
  const chOpen = mkCh('openai');
  const chClaude = mkCh('claude');
  const chGem = mkCh('gemini');
  const chFail = store.addChannel({ name: 'mock-fail', baseUrl: `http://127.0.0.1:${mockPort}`, apiKey: 'k', protocol: 'openai', enabled: true, priority: 1 });
  const chEmpty = store.addChannel({ name: 'mock-empty', baseUrl: `http://127.0.0.1:${mockPort}`, apiKey: 'k', protocol: 'openai', enabled: true, priority: 1 });

  store.addModel({ name: 'gpt-4o', channelId: chOpen.id, upstreamModel: 'mock-gpt', group: 'AUTO', enabled: true });
  store.addModel({ name: 'claude-x', channelId: chClaude.id, upstreamModel: 'mock-claude', group: 'AUTO', enabled: true });
  store.addModel({ name: 'gem-x', channelId: chGem.id, upstreamModel: 'gem-1', group: 'AUTO', enabled: true });
  store.addModel({ name: 'failer', channelId: chFail.id, upstreamModel: 'fail-model', group: 'AUTO', enabled: true });
  store.addModel({ name: 'failer', channelId: chOpen.id, upstreamModel: 'mock-gpt', group: 'AUTO', enabled: true });
  store.addModel({ name: 'emptier', channelId: chEmpty.id, upstreamModel: 'empty-model', group: 'AUTO', enabled: true });

  // T1 OpenAI 流式
  let r = await client(proxyPort, '/v1/chat/completions', { model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] });
  check('T1 OpenAI 流式成功', r.status === 200 && r.body.includes('hi-from-openai') && r.body.includes('[DONE]'));

  // T2 Claude 上游 → 转 OpenAI SSE
  r = await client(proxyPort, '/v1/chat/completions', { model: 'claude-x', stream: true, messages: [{ role: 'user', content: 'hi' }] });
  check('T2 Claude→OpenAI 流式转换', r.status === 200 && r.body.includes('hi-from-claude') && r.body.includes('[DONE]'));

  // T3 Gemini 上游 → 转 OpenAI SSE
  r = await client(proxyPort, '/v1/chat/completions', { model: 'gem-x', stream: true, messages: [{ role: 'user', content: 'hi' }] });
  check('T3 Gemini→OpenAI 流式转换', r.status === 200 && r.body.includes('hi-from-gemini'), `status=${r.status} body=${r.body.slice(0, 240)}`);

  // T4 容错：同优先级候选，先打 500 的频道，自动切到可用频道。
  // 用全新频道/模型：延迟排序会把「已知可用」的候选提前，复用旧数据就无法固定第一个必败。
  const chFail2 = store.addChannel({ name: 'mock-fail2', baseUrl: `http://127.0.0.1:${mockPort}`, apiKey: 'k', protocol: 'openai', enabled: true, priority: 1 });
  const chOk2 = store.addChannel({ name: 'mock-ok2', baseUrl: `http://127.0.0.1:${mockPort}`, apiKey: 'k', protocol: 'openai', enabled: true, priority: 1 });
  const failerA = store.addModel({ name: 'failer-x', channelId: chFail2.id, upstreamModel: 'fail-model', group: 'AUTO', enabled: true });
  store.addModel({ name: 'failer-x', channelId: chOk2.id, upstreamModel: 'mock-gpt', group: 'AUTO', enabled: true });
  r = await client(proxyPort, '/v1/chat/completions', { model: 'failer-x', stream: true, messages: [{ role: 'user', content: 'hi' }] });
  check('T4 失败自动回退到另一频道', r.status === 200 && r.body.includes('hi-from-openai'));

  // T7 容错后失败模型被冷却
  check('T7 失败模型进入冷却', failerA && failerA.cooldownUntil > Date.now());

  // T5 空流保护：仅空流频道 → 502
  r = await client(proxyPort, '/v1/chat/completions', { model: 'emptier', stream: true, messages: [{ role: 'user', content: 'hi' }] });
  check('T5 空流保护触发失败', r.status === 502);

  // T6 /v1/models 返回模型池
  r = await get(proxyPort, '/v1/models');
  const models = JSON.parse(r.body).data.map((m) => m.id);
  check('T6 /v1/models 返回池', models.includes('gpt-4o') && models.includes('claude-x'), models.join(','));

  // T8 非流式 OpenAI
  r = await client(proxyPort, '/v1/chat/completions', { model: 'gpt-4o', stream: false, messages: [{ role: 'user', content: 'hi' }] });
  check('T8 非流式 OpenAI', r.status === 200 && r.body.includes('hi-from-openai'));

  // T9 非流式 Claude→OpenAI
  r = await client(proxyPort, '/v1/chat/completions', { model: 'claude-x', stream: false, messages: [{ role: 'user', content: 'hi' }] });
  const j9 = JSON.parse(r.body);
  check('T9 非流式 Claude→OpenAI JSON', r.status === 200 && j9.choices?.[0]?.message?.content === 'hi-from-claude');

  // ---------- 路由规则（虚拟模型：一个客户端名 → 多个上游 + 策略）----------
  const mUpA = store.addModel({ name: 'up-a', channelId: chOpen.id, upstreamModel: 'mock-a', group: 'AUTO', enabled: true });
  const mUpB = store.addModel({ name: 'up-b', channelId: chOpen.id, upstreamModel: 'mock-b', group: 'AUTO', enabled: true });
  const mUpFail = store.addModel({ name: 'up-fail', channelId: chFail.id, upstreamModel: 'fail-model', group: 'AUTO', enabled: true });

  // T10 failover：第一个目标失败 → 自动切到第二个
  store.addRoute({ name: 'route-fo', strategy: 'failover', targets: [{ modelId: mUpFail.id }, { modelId: mUpA.id }] });
  r = await client(proxyPort, '/v1/chat/completions', { model: 'route-fo', stream: false, messages: [{ role: 'user', content: 'hi' }] });
  check('T10 路由 failover 自动切换', r.status === 200 && r.body.includes('hi-from-openai:mock-a'), `status=${r.status} body=${r.body.slice(0, 200)}`);

  // T11 roundrobin：连续两次命中不同上游
  store.addRoute({ name: 'route-rr', strategy: 'roundrobin', targets: [{ modelId: mUpA.id }, { modelId: mUpB.id }] });
  const rrHits = [];
  for (let i = 0; i < 2; i++) {
    const rr = await client(proxyPort, '/v1/chat/completions', { model: 'route-rr', stream: false, messages: [{ role: 'user', content: 'hi' }] });
    rrHits.push(JSON.parse(rr.body).choices?.[0]?.message?.content || '');
  }
  check('T11 路由轮询依次命中不同上游', rrHits[0] !== rrHits[1] && rrHits.every((s) => s.includes('mock-')), rrHits.join(' | '));

  // T12 weighted：权重 9:1，且低权重项放在最前 —— 若实现退化成「按定义顺序」
  // 就会永远命中排第一的 mock-b，断言失败；正常加权则应偏向高权重。
  store.addRoute({ name: 'route-w', strategy: 'weighted', targets: [{ modelId: mUpB.id, weight: 1 }, { modelId: mUpA.id, weight: 9 }] });
  let hitA = 0, hitB = 0;
  for (let i = 0; i < 30; i++) {
    const rr = await client(proxyPort, '/v1/chat/completions', { model: 'route-w', stream: false, messages: [{ role: 'user', content: 'hi' }] });
    const c = JSON.parse(rr.body).choices?.[0]?.message?.content || '';
    if (c.endsWith('mock-a')) hitA++; else if (c.endsWith('mock-b')) hitB++;
  }
  check('T12 路由加权偏向高权重', hitA > hitB, `A(w9)=${hitA} B(w1)=${hitB}`);

  // T13 路由名出现在 /v1/models（供客户端发现）
  r = await get(proxyPort, '/v1/models');
  const routeIds = JSON.parse(r.body).data.map((x) => x.id);
  check('T13 /v1/models 暴露路由名', routeIds.includes('route-fo') && routeIds.includes('route-rr') && routeIds.includes('route-w'), routeIds.join(','));

  // ---------- T14 Base URL 归一化（修复「拉取模型 404」）----------
  // 用户填了带 /v1 的 Base URL 时，旧实现会拼成 /v1/v1/models → 404。
  check('T14a withVersion 归一化（已带版本段不再重复）',
    withVersion('https://api.siliconflow.cn/v1') === 'https://api.siliconflow.cn/v1' &&
    withVersion('https://api.openai.com') === 'https://api.openai.com/v1' &&
    withVersion('https://open.bigmodel.cn/api/paas/v4') === 'https://open.bigmodel.cn/api/paas/v4',
    ['sf=' + withVersion('https://api.siliconflow.cn/v1'), 'oa=' + withVersion('https://api.openai.com'), 'glm=' + withVersion('https://open.bigmodel.cn/api/paas/v4')].join(' '));

  recorded.length = 0;
  const chWithV1 = store.addChannel({ name: 'base-with-v1', baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiKey: 'k', protocol: 'openai', enabled: true, priority: 1 });
  const fmV1 = await fetchChannelModels(chWithV1);
  check('T14b 带 /v1 的 Base URL 拉模型走 /v1/models（无重复）', fmV1.ok && recorded.includes('/v1/models'), `requested=${recorded.join(',')} ok=${fmV1.ok}`);

  recorded.length = 0;
  const chPlain = store.addChannel({ name: 'base-plain', baseUrl: `http://127.0.0.1:${mockPort}`, apiKey: 'k', protocol: 'openai', enabled: true, priority: 1 });
  const fmPlain = await fetchChannelModels(chPlain);
  check('T14c 不带版本段的 Base URL 自动补 /v1', fmPlain.ok && recorded.includes('/v1/models'), `requested=${recorded.join(',')} ok=${fmPlain.ok}`);

  // ---------- T15/T16 慢思考 / 流中静置 不被腰斩（回归：旧 8s 空流保护 + 写死的 60s 空闲超时）----------
  const chSlow = store.addChannel({ name: 'mock-slow', baseUrl: `http://127.0.0.1:${mockPort}`, apiKey: 'k', protocol: 'openai', enabled: true, priority: 1 });
  store.addModel({ name: 'slow-first', channelId: chSlow.id, upstreamModel: 'slow-first', group: 'AUTO', enabled: true });
  store.addModel({ name: 'pauses', channelId: chSlow.id, upstreamModel: 'pauses', group: 'AUTO', enabled: true });

  // T15 首 token 延迟 12s（>旧 8s 阈值，<新 60s 阈值）→ 必须成功。旧实现会返回 502
  r = await client(proxyPort, '/v1/chat/completions', { model: 'slow-first', stream: true, messages: [{ role: 'user', content: 'hi' }] });
  check('T15 慢首 token(12s) 不被空流保护腰斩', r.status === 200 && r.body.includes('slow-first') && r.body.includes('[DONE]'), `status=${r.status} len=${r.body.length}`);

  // T16 流中段静默 6s（远小于 600s 空闲上限）→ 必须完整收到 part2 与 [DONE]
  r = await client(proxyPort, '/v1/chat/completions', { model: 'pauses', stream: true, messages: [{ role: 'user', content: 'hi' }] });
  check('T16 流中静置(6s) 不被空闲超时掐断', r.status === 200 && r.body.includes('part2') && r.body.includes('[DONE]'), `status=${r.status} body=${r.body.slice(0, 160)}`);

  // ---------- T17 AUTO 负缓存：模型不存在(404)后短期跳过，不再重试 ----------
  store.data.channels = []; store.data.models = [];
  const chMissing = store.addChannel({ name: 'mock-missing', baseUrl: `http://127.0.0.1:${mockPort}`, apiKey: 'k', protocol: 'openai', enabled: true, priority: 1 });
  const missModel = store.addModel({ name: 'missing-x', channelId: chMissing.id, upstreamModel: 'missing-model', group: 'AUTO', enabled: true });
  recorded.length = 0;
  r = await client(proxyPort, '/v1/chat/completions', { model: 'AUTO', stream: false, messages: [{ role: 'user', content: 'hi' }] });
  const firstHit = recorded.some((u) => u.includes('/chat/completions'));
  check('T17a AUTO 首次尝试缺失模型并 404→负缓存', r.status === 502 && firstHit, `status=${r.status} hitChat=${firstHit}`);
  store.setModelCooldown(missModel.id, 0); // 清除冷却，让模型重回候选池，专测负缓存跳过
  recorded.length = 0;
  r = await client(proxyPort, '/v1/chat/completions', { model: 'AUTO', stream: false, messages: [{ role: 'user', content: 'hi' }] });
  const secondHit = recorded.some((u) => u.includes('/chat/completions'));
  check('T17b 负缓存命中：第二次 AUTO 不再向该上游发请求', r.status === 502 && !secondHit, `status=${r.status} hitChat=${secondHit}`);

  // ---------- T18 额外请求头透传 + 探测区分鉴权失败（修复「链接通但拉不到模型 / 假绿灯」）----------
  // 模拟 Modal 这类要求自定义转发密钥头的中转站：缺头 → 401 missing forward secret
  const chSecure = store.addChannel({ name: 'secure', baseUrl: `http://127.0.0.1:${mockPort}/secure`, apiKey: 'k', protocol: 'openai', enabled: true, priority: 1 });

  const prNoHdr = await probeChannel(store.getChannel(chSecure.id));
  check('T18a 探测：401 不再误报绿灯（识别为鉴权失败）',
    prNoHdr.ok === false && prNoHdr.authFail === true,
    `ok=${prNoHdr.ok} authFail=${prNoHdr.authFail} status=${prNoHdr.status}`);

  const fmNoHdr = await fetchChannelModels(store.getChannel(chSecure.id));
  check('T18b 缺自定义头时拉模型鉴权失败并透出上游原文',
    fmNoHdr.ok === false && fmNoHdr.authFail === true && /forward secret/i.test(fmNoHdr.error || ''),
    `err=${fmNoHdr.error}`);

  store.updateChannel(chSecure.id, { extraHeaders: { 'x-forward-secret': 'sec-123' } });
  const prHdr = await probeChannel(store.getChannel(chSecure.id));
  check('T18c 补上额外请求头后探测通过', prHdr.ok === true, `ok=${prHdr.ok} status=${prHdr.status}`);

  const fmHdr = await fetchChannelModels(store.getChannel(chSecure.id));
  check('T18d 补上额外请求头后拉模型成功（extraHeaders 已透传）',
    fmHdr.ok === true && fmHdr.models.includes('secure-model'), `models=${(fmHdr.models || []).join(',')}`);

  // ---------- T19 配置导出 / 导入（含 One API / New API 兼容格式）----------
  const exp = buildExport(store, { version: '0.2.5' });
  check('T19a 导出包含频道与模型且带格式标记',
    exp.app === 'xuanshu' && Array.isArray(exp.channels) && exp.channels.length > 0 && Array.isArray(exp.models),
    `channels=${exp.channels.length}`);

  const oneApi = { channels: [{ id: 1, name: 'oa-1', type: 1, key: 'sk-oa', base_url: 'https://api.example.com', models: 'm1,m2', group: 'default' }] };
  check('T19b 识别 One API / New API 格式', detectFormat(oneApi) === 'oneapi');
  check('T19c 识别玄枢原生格式', detectFormat(exp) === 'xuanshu');

  const beforeCh = store.data.channels.length;
  const impMerge = applyImport(store, oneApi);
  const oaCh = store.data.channels.find((c) => c.name === 'oa-1');
  check('T19d One API 追加导入（频道 + 模型已完成字段映射）',
    impMerge.ok && impMerge.mode === 'merge' && store.data.channels.length === beforeCh + 1
      && impMerge.counts.models === 2 && !!oaCh
      && oaCh.baseUrl === 'https://api.example.com' && oaCh.apiKey === 'sk-oa' && oaCh.protocol === 'openai',
    `counts=${JSON.stringify(impMerge.counts)}`);

  const impReplace = applyImport(store, exp);
  check('T19e 玄枢导出全量恢复',
    impReplace.ok && impReplace.mode === 'replace'
      && store.data.channels.length === exp.channels.length && store.data.models.length === exp.models.length,
    `counts=${JSON.stringify(impReplace.counts)}`);
  check('T19f 导入前生成滚动备份 config.json.bak',
    !!impReplace.backupPath && impReplace.backupPath.endsWith('config.json.bak') && fs.existsSync(impReplace.backupPath));

  // ---------- T20 管理端点：关于 / 配置导出 / 配置导入 ----------
  const aboutRes = await get(adminPort, '/api/about');
  const aboutJson = JSON.parse(aboutRes.body || '{}');
  check('T20a /api/about 返回版本与仓库链接',
    aboutRes.status === 200 && aboutJson.version === '0.2.5' && /github\.com\/gncarl\/XuanShu/.test(aboutJson.repo || ''),
    `version=${aboutJson.version}`);

  const expRes = await get(adminPort, '/api/config/export');
  check('T20b /api/config/export 可导出', expRes.status === 200 && JSON.parse(expRes.body).app === 'xuanshu');

  const impRes = await client(adminPort, '/api/config/import', { channels: [{ name: 'api-oa', key: 'sk-2', base_url: 'https://x.example.com', type: 1, models: 'z1' }] });
  check('T20c /api/config/import 可导入（One API 格式）', impRes.status === 200 && JSON.parse(impRes.body).ok === true, `body=${impRes.body.slice(0, 120)}`);

  // ---------- T21 模型属性小标签（注册表 + 上游扩展字段 + 用户修正）----------
  // T21a 本地注册表推断：glm-4-flash（免费+工具）、gpt-4o（视觉+工具）、陌生模型兜底「文本」标推测
  const metaGlm = modelMeta('glm-4-flash');
  const metaGpt = modelMeta('gpt-4o');
  const metaUnknown = modelMeta('some-unknown-xyz-7b');
  check('T21a 注册表推断能力/上下文',
    metaGlm.caps.includes('工具') && metaGlm.caps.includes('免费') && metaGlm.context === 128000
      && metaGpt.caps.includes('视觉') && metaGpt.caps.includes('工具') && metaGpt.context === 128000
      && metaUnknown.caps.includes('文本') && metaUnknown.source === 'guess',
    `glm=${JSON.stringify(metaGlm)} gpt=${JSON.stringify(metaGpt)} unknown=${JSON.stringify(metaUnknown)}`);

  // T21b 上游扩展字段覆盖：mystery-model-9000 注册表没有，但上游返回 context_length
  const metaUp = modelMeta('mystery-model-9000', { upstream: { context_length: 9000 } });
  check('T21b 上游 context_length 合入', metaUp.context === 9000, `ctx=${metaUp.context}`);

  // T21c 用户手动修正优先
  const metaUser = modelMeta('glm-4-flash', { userMeta: { caps: ['文本'], context: 4096 } });
  check('T21c 用户修正优先于推断', metaUser.source === 'user' && metaUser.context === 4096 && metaUser.caps.length === 1, JSON.stringify(metaUser));

  // T21d 拉模型响应附带 metas（含上游扩展字段，经管理 API 端点验证）
  recorded.length = 0;
  const chMeta = store.addChannel({ name: 'mock-meta', baseUrl: `http://127.0.0.1:${mockPort}`, apiKey: 'k', protocol: 'openai', enabled: true, priority: 1 });
  const fmRes = await client(adminPort, `/api/channels/${chMeta.id}/fetchModels`, {});
  const fmMeta = JSON.parse(fmRes.body || '{}');
  check('T21d fetchModels 附带 metas 且合入上游 context_length',
    fmMeta.ok && fmMeta.metas && fmMeta.metas['mystery-model-9000']?.context === 9000 && !!fmMeta.metas['mock-gpt']?.caps,
    `metas=${JSON.stringify(fmMeta.metas || {}).slice(0, 200)}`);

  // T21e /api/model-meta 批量端点 + 用户修正落库后生效
  const userModel = store.addModel({ name: 'my-custom', channelId: chMeta.id, upstreamModel: 'some-unknown-xyz-7b', group: 'AUTO', enabled: true });
  store.updateModel(userModel.id, { meta: { caps: ['文本', '工具'], context: 65536 } });
  const metaRes = await get(adminPort, '/api/model-meta?names=' + encodeURIComponent('some-unknown-xyz-7b,glm-4-flash'));
  const metaJson = JSON.parse(metaRes.body || '{}');
  check('T21e /api/model-meta 批量查询（用户修正覆盖推断）',
    metaRes.status === 200 && metaJson['some-unknown-xyz-7b']?.source === 'user' && metaJson['some-unknown-xyz-7b']?.context === 65536
      && metaJson['glm-4-flash']?.source === 'registry',
    `res=${metaRes.body.slice(0, 220)}`);

  // ---------- T22 仪表盘统计：today / byDay 按天聚合 ----------
  const dayKeyNow = (() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })();
  const statsRes = await get(adminPort, '/api/logs/stats');
  const statsJson = JSON.parse(statsRes.body || '{}');
  check('T22a /api/logs/stats 暴露 today 与 byDay（仪表盘当日+时间段用）',
    statsRes.status === 200 && statsJson.today && typeof statsJson.today.count === 'number'
      && statsJson.byDay && typeof statsJson.byDay[dayKeyNow] === 'object',
    `today=${JSON.stringify(statsJson.today)} dayKey=${dayKeyNow}`);
  check('T22b 今天的请求已按天计入（此前若干用例已产生成功请求）',
    (statsJson.today.count || 0) > 0 && (statsJson.byDay[dayKeyNow]?.count || 0) > 0,
    `todayCount=${statsJson.today.count}`);

  // ---------- T23 EWMA 延迟排序（0.2.5 路由提速）----------
  const { Router } = await import('../electron/backend/router.js');
  const resStub = { isModelCooled: () => false, isChannelFrozen: () => false, isBreakerOpen: () => false };
  const r2 = new Router(store, resStub);
  store.data.channels = []; store.data.models = [];
  const ewA = store.addChannel({ name: 'ewma-a', baseUrl: 'http://127.0.0.1:1', apiKey: 'k', protocol: 'openai', enabled: true, priority: 1 });
  const ewB = store.addChannel({ name: 'ewma-b', baseUrl: 'http://127.0.0.1:1', apiKey: 'k', protocol: 'openai', enabled: true, priority: 1 });
  const ewC = store.addChannel({ name: 'ewma-c', baseUrl: 'http://127.0.0.1:1', apiKey: 'k', protocol: 'openai', enabled: true, priority: 1 });
  const mSlow = store.addModel({ name: 'sp-slow', channelId: ewA.id, upstreamModel: 'u-slow', group: 'AUTO', enabled: true, priority: 100 });
  const mFast = store.addModel({ name: 'sp-fast', channelId: ewB.id, upstreamModel: 'u-fast', group: 'AUTO', enabled: true, priority: 100 });
  const mMid = store.addModel({ name: 'sp-mid', channelId: ewC.id, upstreamModel: 'u-mid', group: 'AUTO', enabled: true, priority: 100 });
  // mid-hi 优先级刻意设差（150），但延迟与 fast 同档：用来区分两种模式的预期顺序
  const mMidHi = store.addModel({ name: 'sp-mid-hi', channelId: ewC.id, upstreamModel: 'u-mid-hi', group: 'AUTO', enabled: true, priority: 150 });
  // 记录延迟：slow 2000ms / fast 200ms / mid 260ms / mid-hi 250ms（后两者在 fast×(1+0.5) 同档内）
  r2.recordLatency(ewA.id, 'u-slow', { latencyMs: 2000 });
  r2.recordLatency(ewB.id, 'u-fast', { latencyMs: 200 });
  r2.recordLatency(ewC.id, 'u-mid', { latencyMs: 260 });
  r2.recordLatency(ewC.id, 'u-mid-hi', { latencyMs: 250 });
  let ord = r2.resolve('AUTO').candidates.map((c) => c.model.id);
  // custom：优先级第一 —— 三个 100 按速度排（fast→mid→slow），150 的 mid-hi 沉底
  check('T23a custom 同优先级按 EWMA 快的排前', ord[0] === mFast.id && ord[1] === mMid.id && ord[2] === mSlow.id && ord[3] === mMidHi.id, ord.join(','));
  store.updateSettings({ orderMode: 'fastest' });
  ord = r2.resolve('AUTO').candidates.map((c) => c.model.id);
  // fastest：fast(200) 与 mid(250)/mid-hi(260) 同在 300ms 档内，档内按优先级 → fast、mid 先于 mid-hi；slow 单独一档沉底
  check('T23b fastest 模式：档内按优先级、跨档按速度', ord[0] === mFast.id && ord[1] === mMid.id && ord[2] === mMidHi.id && ord[3] === mSlow.id, ord.join(','));
  store.updateSettings({ orderMode: 'custom' });

  // ---------- T24 /api/latency 延迟快照端点 ----------
  const latRes = await get(adminPort, '/api/latency');
  const latJson = JSON.parse(latRes.body || '{}');
  check('T24 /api/latency 返回 EWMA 快照（真实路由器的实测数据）',
    latRes.status === 200 && latJson[chOpen.id]?.['mock-gpt']?.n >= 2 && latJson[chOpen.id]?.['mock-gpt']?.ewma > 0,
    `mock-gpt=${JSON.stringify(latJson[chOpen.id]?.['mock-gpt'] || null)}`);

  // ---------- T25 429 尊重 Retry-After（0.2.5 路由提速）----------
  // 清场：排除其它候选干扰，保证候选集合确定
  store.data.channels = []; store.data.models = [];
  const chRl = store.addChannel({ name: 'mock-rl', baseUrl: `http://127.0.0.1:${mockPort}`, apiKey: 'k', protocol: 'openai', enabled: true, priority: 1 });
  const chRlOk = store.addChannel({ name: 'mock-rl-ok', baseUrl: `http://127.0.0.1:${mockPort}`, apiKey: 'k', protocol: 'openai', enabled: true, priority: 1 });
  const rlModel = store.addModel({ name: 'rl-x', channelId: chRl.id, upstreamModel: 'ratelimit-model', group: 'AUTO', enabled: true });
  const rlOkModel = store.addModel({ name: 'rl-x', channelId: chRlOk.id, upstreamModel: 'mock-gpt', group: 'AUTO', enabled: true });
  const t25 = Date.now();
  r = await client(proxyPort, '/v1/chat/completions', { model: 'rl-x', stream: false, messages: [{ role: 'user', content: 'hi' }] });
  const cdRemain = rlModel.cooldownUntil - t25;
  check('T25a 429 后切到下一候选成功', r.status === 200 && r.body.includes('hi-from-openai'), `status=${r.status}`);
  check('T25b 冷却时长取自 Retry-After(2s) 而非固定 5 分钟', cdRemain > 1500 && cdRemain < 6000, `cooldownRemain=${cdRemain}ms`);
  const lastLog = logstore.query({ model: 'rl-x', page: 1, pageSize: 1 }).rows[0];
  check('T25c 日志 attempts 记录 retryAfterMs', !!lastLog && (lastLog.attempts || []).some((a) => a.status === 429 && a.retryAfterMs === 2000), JSON.stringify(lastLog?.attempts || []));
  // 冷却中的候选：再次请求时直接走健康候选，不再撞一次限流
  r = await client(proxyPort, '/v1/chat/completions', { model: 'rl-x', stream: false, messages: [{ role: 'user', content: 'hi' }] });
  const lastLog2 = logstore.query({ model: 'rl-x', page: 1, pageSize: 1 }).rows[0];
  check('T25d 冷却中的候选不再被重试（直接走健康候选）',
    r.status === 200 && (lastLog2?.attempts || []).length === 0, `status=${r.status} attempts=${JSON.stringify(lastLog2?.attempts || [])}`);

  // 仅剩的候选也在冷却中 → 整个请求无可用上游（503），不会无限重试
  store.updateModel(rlOkModel.id, { enabled: false });
  r = await client(proxyPort, '/v1/chat/completions', { model: 'rl-x', stream: false, messages: [{ role: 'user', content: 'hi' }] });
  check('T25e 唯一候选冷却中 → 直接 503 不重试', r.status === 503 && /no available channel/.test(r.body), `status=${r.status} body=${r.body.slice(0, 120)}`);

  // ---------- T26 keep-alive 连接池 + DNS 缓存（0.2.5 路由提速）----------
  const agents = [...proxy._agents.values()];
  check('T26a 按频道维度建立 keep-alive 连接池', agents.length >= 1 && agents.every((a) => a.keepAlive === true), `agents=${agents.length}`);
  const ipA = await proxy._lookup('localhost');
  const dnsSize = proxy._dnsCache.size;
  const ipB = await proxy._lookup('localhost');
  check('T26b DNS 结果缓存（第二次命中不发查询）', !!ipA && ipA === ipB && dnsSize >= 1 && proxy._dnsCache.size === dnsSize, `ip=${ipA} size=${proxy._dnsCache.size}`);

  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n结果：${results.length - failed}/${results.length} 通过`);
  mock.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
