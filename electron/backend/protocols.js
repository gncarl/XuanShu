// 五协议转换：请求构造（客户端 → 上游）与响应回流（上游 → OpenAI 兼容 SSE）。
//  OpenAI 兼容 / Azure：直接透传
//  Claude / Gemini / Responses：做格式映射
import { trimSlash, withVersion } from './util.js';

// ---------- SSE 辅助 ----------
function chunk(obj) { return `data: ${JSON.stringify(obj)}\n\n`; }
function doneLine() { return `data: [DONE]\n\n`; }

function rid() { return 'chatcmpl-' + Math.random().toString(36).slice(2, 12); }

// ---------- 请求构造（返回上游 URL/头/体）----------
export function prepareRequest(channel, upstreamModel, clientBody) {
  const base = trimSlash(channel.baseUrl);
  const apiKey = channel.apiKey || '';
  const extra = channel.extraHeaders || {};
  const stream = !!clientBody.stream;

  switch (channel.protocol) {
    case 'azure': {
      const deploy = channel.deployment || upstreamModel;
      const ver = channel.apiVersion || '2024-02-15-preview';
      return {
        url: `${base}/openai/deployments/${deploy}/chat/completions?api-version=${ver}`,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'api-key': apiKey, ...extra },
        body: { ...clientBody, model: deploy },
      };
    }
    case 'claude': {
      return {
        url: `${withVersion(channel.baseUrl)}/messages`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          ...extra,
        },
        body: chatToClaude(clientBody, upstreamModel),
      };
    }
    case 'gemini': {
      const suffix = stream ? ':streamGenerateContent?alt=sse' : ':generateContent';
      // 非流式没有查询串，需要自己补 '?'，否则会拼出 generateContent&key=…
      const q = suffix.includes('?') ? '&' : '?';
      return {
        url: `${withVersion(channel.baseUrl, 'v1beta')}/models/${upstreamModel}${suffix}${q}key=${apiKey}`,
        method: 'POST',
        headers: { 'content-type': 'application/json', ...extra },
        body: chatToGemini(clientBody, upstreamModel),
      };
    }
    case 'responses': {
      // 把 Responses 输入转成 Chat Completions，走 OpenAI 兼容上游
      return {
        url: `${withVersion(channel.baseUrl)}/chat/completions`,
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}`, ...extra },
        body: responsesToChat(clientBody, upstreamModel),
      };
    }
    case 'openai':
    default: {
      return {
        url: `${withVersion(channel.baseUrl)}/chat/completions`,
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}`, ...extra },
        body: { ...clientBody, model: upstreamModel },
      };
    }
  }
}

// ---------- 请求体转换 ----------
function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (p.text || '')).join('');
  return '';
}

export function chatToClaude(body, model) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  let system = '';
  const msgs = [];
  for (const m of messages) {
    if (m.role === 'system') { system += extractText(m.content); continue; }
    msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: extractText(m.content) });
  }
  const out = {
    model,
    max_tokens: body.max_tokens || body.max_completion_tokens || 1024,
    stream: !!body.stream,
    messages: msgs,
  };
  if (system) out.system = system;
  if (body.temperature != null) out.temperature = body.temperature;
  if (body.top_p != null) out.top_p = body.top_p;
  if (body.stop) out.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  return out;
}

export function chatToGemini(body, model) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: extractText(m.content) }],
    }));
  const cfg = {};
  if (body.temperature != null) cfg.temperature = body.temperature;
  if (body.top_p != null) cfg.topP = body.top_p;
  if (body.max_tokens || body.max_completion_tokens) cfg.maxOutputTokens = body.max_tokens || body.max_completion_tokens;
  if (body.stop) cfg.stopSequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  const out = { contents };
  if (Object.keys(cfg).length) out.generationConfig = cfg;
  if (body.stream) out.stream = true;
  return out;
}

export function responsesToChat(body, model) {
  const input = Array.isArray(body.input) ? body.input : [];
  const messages = [];
  let system = '';
  for (const item of input) {
    if (item.type === 'message') {
      const role = item.role || 'user';
      const content = typeof item.content === 'string'
        ? item.content
        : (item.content?.map((p) => p.text || '').join('') || '');
      if (role === 'system') system += content;
      else messages.push({ role, content });
    } else if (item.type === 'text') {
      messages.push({ role: 'user', content: item.text || '' });
    }
  }
  if (system) messages.unshift({ role: 'system', content: system });
  return {
    model,
    stream: !!body.stream,
    messages,
    temperature: body.temperature,
    top_p: body.top_p,
    max_tokens: body.max_output_tokens || body.max_tokens,
  };
}

// ---------- 响应映射（流式）----------
// 每种需要转换的协议返回一个 { handleLine(line), finish() } 对象，通过 out() 输出 OpenAI SSE。
// usageBox 用于在流结束时回传 token 用量给代理层做日志。
export function makeResponseMapper(protocol, { out, model, requestedModel, usageBox }) {
  if (protocol === 'claude') return claudeMapper({ out, model, usageBox });
  if (protocol === 'gemini') return geminiMapper({ out, model, usageBox });
  if (protocol === 'responses') return responsesMapper({ out, model, requestedModel, usageBox });
  // openai / azure 透传，不需要映射
  return null;
}

// 把上游归一化后的 OpenAI SSE（字符串）转成 Claude Messages SSE，写给 Anthropic 客户端。
export function makeOpenAIToClaudeMapper({ out }) {
  const sid = 'msg_' + Math.random().toString(36).slice(2, 12);
  let started = false, blockIdx = 0;
  function ev(obj) { out(`event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`); }
  function ensureStart() {
    if (started) return;
    started = true;
    ev({ type: 'message_start', message: { id: sid, type: 'message', role: 'assistant', model: 'claude', content: [] } });
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  }
  return {
    handleLine(line) {
      if (!line.startsWith('data:')) return;
      let data; try { data = JSON.parse(line.slice(5).trim()); } catch { return; }
      if (data === '[DONE]' || data === 'DONE') return;
      const d = data.choices?.[0]?.delta;
      if (!d) return;
      ensureStart();
      if (d.content) {
        ev({ type: 'content_block_delta', index: blockIdx, delta: { type: 'text_delta', text: d.content } });
      }
    },
    finish(usage) {
      if (!started) { ensureStart(); }
      const fr = 'end_turn';
      ev({ type: 'content_block_stop', index: blockIdx });
      ev({ type: 'message_delta', delta: { stop_reason: fr }, usage: usage ? { input_tokens: usage.prompt_tokens || 0, output_tokens: usage.completion_tokens || 0 } : undefined });
      ev({ type: 'message_stop' });
    },
  };
}

// ---------- 非流式响应转换 ----------
export function transformNonStream(protocol, json, model) {
  if (protocol === 'openai' || protocol === 'azure' || protocol === 'responses') {
    return protocol === 'responses' ? responsesJsonToResponses(json, model) : json;
  }
  if (protocol === 'claude') {
    const text = (json.content || []).map((p) => (p.text || '')).join('');
    return {
      id: json.id || 'chatcmpl', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: mapStop(json.stop_reason) }],
      usage: json.usage ? { prompt_tokens: json.usage.input_tokens || 0, completion_tokens: json.usage.output_tokens || 0, total_tokens: (json.usage.input_tokens || 0) + (json.usage.output_tokens || 0) } : undefined,
    };
  }
  if (protocol === 'gemini') {
    const cand = json.candidates?.[0];
    const text = cand?.content?.parts?.map((p) => p.text || '').join('') || '';
    const um = json.usageMetadata || {};
    return {
      id: 'chatcmpl', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: mapStop(cand?.finishReason) }],
      usage: { prompt_tokens: um.promptTokenCount || 0, completion_tokens: um.candidatesTokenCount || 0, total_tokens: um.totalTokenCount || 0 },
    };
  }
  return json;
}

function responsesJsonToResponses(json, model) {
  const msg = json.choices?.[0]?.message;
  const text = msg?.content || '';
  return {
    id: 'resp_' + Math.random().toString(36).slice(2, 10), object: 'response', model, status: 'completed',
    output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }],
    usage: json.usage,
  };
}

// 非流式 OpenAI Chat → Claude Messages（供 /v1/messages 端点返回）
export function openaiChatToClaude(json) {
  const msg = json.choices?.[0]?.message;
  const text = msg?.content || '';
  const u = json.usage || {};
  return {
    id: 'msg_' + Math.random().toString(36).slice(2, 10), type: 'message', role: 'assistant', model: json.model || 'claude',
    content: [{ type: 'text', text }],
    stop_reason: json.choices?.[0]?.finish_reason || 'end_turn',
    usage: { input_tokens: u.prompt_tokens || 0, output_tokens: u.completion_tokens || 0 },
  };
}

function claudeMapper({ out, model, usageBox }) {
  let id = null, roleSent = false, finishReason = null, usage = null;
  const sid = 'msg_' + Math.random().toString(36).slice(2, 10);
  function emitDelta(delta, extra = {}) {
    if (!roleSent) { roleSent = true; }
    out(chunk({
      id: id || sid, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
      model, choices: [{ index: 0, delta, ...extra }],
    }));
  }
  return {
    handleLine(line) {
      if (!line.startsWith('data:')) return;
      let data; try { data = JSON.parse(line.slice(5).trim()); } catch { return; }
      switch (data.type) {
        case 'message_start':
          id = data.message?.id || sid;
          if (data.message?.role) emitDelta({ role: 'assistant', content: '' });
          break;
        case 'content_block_start':
          break;
        case 'content_block_delta':
          if (data.delta?.type === 'text_delta') emitDelta({ content: data.delta.text });
          else if (data.delta?.type === 'input_json_delta') emitDelta({ tool_calls: [{ index: 0, function: { arguments: data.delta.partial_json || '' } }] });
          break;
        case 'message_delta':
          finishReason = mapStop(data.delta?.stop_reason);
          usage = data.usage ? { prompt_tokens: data.usage.input_tokens || 0, completion_tokens: data.usage.output_tokens || 0, total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0) } : null;
          break;
        case 'message_stop':
          break;
        default: break;
      }
    },
    finish() {
      out(chunk({ id: id || sid, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: {}, finish_reason: finishReason || 'stop' }] }));
      if (usage) {
        out(chunk({ id: id || sid, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: {}, finish_reason: null }], usage }));
      }
      if (usageBox) usageBox.usage = usage;
      out(doneLine());
    },
  };
}

function geminiMapper({ out, model, usageBox }) {
  const id = rid();
  let roleSent = false, finishReason = null, usage = null;
  function emitDelta(text) {
    if (!roleSent) { roleSent = true; out(chunk({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] })); }
    out(chunk({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { content: text } }] }));
  }
  return {
    handleLine(line) {
      if (!line.startsWith('data:')) return;
      let data; try { data = JSON.parse(line.slice(5).trim()); } catch { return; }
      const cand = data.candidates?.[0];
      if (cand?.content?.parts) {
        for (const p of cand.content.parts) if (p.text) emitDelta(p.text);
      }
      if (cand?.finishReason) finishReason = mapStop(cand.finishReason);
      if (data.usageMetadata) {
        usage = {
          prompt_tokens: data.usageMetadata.promptTokenCount || 0,
          completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
          total_tokens: data.usageMetadata.totalTokenCount || 0,
        };
      }
    },
    finish() {
      out(chunk({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: {}, finish_reason: finishReason || 'stop' }] }));
      if (usage) out(chunk({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: {}, finish_reason: null }], usage }));
      if (usageBox) usageBox.usage = usage;
      out(doneLine());
    },
  };
}

function responsesMapper({ out, model, requestedModel, usageBox }) {
  const ridResp = 'resp_' + Math.random().toString(36).slice(2, 12);
  const itemId = 'msg_' + Math.random().toString(36).slice(2, 12);
  let roleSent = false;
  let usage = null;
  function ev(type, data) { out(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); }
  function emitDelta(text) {
    if (!roleSent) {
      roleSent = true;
      ev('response.created', { id: ridResp, object: 'response', model: requestedModel || model, status: 'in_progress' });
      ev('response.output_item.added', { item: { id: itemId, type: 'message', role: 'assistant', status: 'in_progress' } });
      ev('response.content_part.added', { part: { type: 'output_text', text: '' } });
    }
    ev('response.output_text.delta', { delta: text });
  }
  return {
    handleLine(line) {
      if (!line.startsWith('data:')) return;
      let data; try { data = JSON.parse(line.slice(5).trim()); } catch { return; }
      if (data.usage) usage = data.usage;
      const d = data.choices?.[0]?.delta;
      if (!d) return;
      if (d.role && !roleSent) { emitDelta(''); return; }
      if (d.content) emitDelta(d.content);
    },
    finish() {
      ev('response.output_text.done', { text: '' });
      ev('response.output_item.done', { item: { id: itemId, type: 'message', role: 'assistant', status: 'completed' } });
      ev('response.completed', { id: ridResp, object: 'response', model: requestedModel || model, status: 'completed', usage });
      if (usageBox) usageBox.usage = usage;
    },
  };
}

function mapStop(reason) {
  if (!reason) return 'stop';
  const map = { end_turn: 'stop', stop_sequence: 'stop', max_tokens: 'length', length: 'length', tool_use: 'tool_calls', content_filter: 'content_filter' };
  return map[reason] || 'stop';
}
