// 模型属性元数据：本地能力注册表 + 命名推断。
// 背景：绝大多数 OpenAI 兼容的 /v1/models 只返回 id/object/created/owned_by，
// 不带能力（文本/工具/视觉/文生图）与上下文长度。因此玄枢在本地维护一套
// 「按模型名/前缀匹配」的注册表，拉取模型时给每个模型打属性小标签。
//
// 三路合并策略（本模块实现前两路，第三路由上游扩展字段在上层调用处处理）：
//   1. 本地能力注册表（本文件 RULES，最稳）
//   2. 上游返回的扩展字段（context_length / capabilities 等，调用方解析后经 mergeUpstreamMeta 合入）
//   3. 命名约定推断（本文件 inferFromName 兜底，未命中注册表时标「推测」）

// 能力标签（与前端展示一致）
const CAP_TEXT = '文本';
const CAP_TOOL = '工具';
const CAP_VISION = '视觉';
const CAP_T2I = '文生图';
const CAP_AUDIO = '音频';
const CAP_REASON = '推理';
const CAP_FREE = '免费';

// 规则：按序匹配，先命中先用（name 统一转小写后 includes 判断）
// pattern: 模型名片段；caps: 能力；ctx: 上下文窗口（token）；out: 最大输出（可选）
const RULES = [
  // ---- 文生图 / 多模态生成 ----
  { pattern: 'dall-e', caps: [CAP_T2I], ctx: 4000 },
  { pattern: 'sd-3', caps: [CAP_T2I] },
  { pattern: 'sdxl', caps: [CAP_T2I] },
  { pattern: 'stable-diffusion', caps: [CAP_T2I] },
  { pattern: 'flux', caps: [CAP_T2I] },
  { pattern: 'midjourney', caps: [CAP_T2I] },
  { pattern: 'cogview', caps: [CAP_T2I] },
  { pattern: ' Kolors', caps: [CAP_T2I] },
  { pattern: 'kolors', caps: [CAP_T2I] },
  { pattern: 'image', caps: [CAP_T2I], ctx: 128000 },          // agnes-image-* / gpt-image 等
  { pattern: 'gpt-image', caps: [CAP_T2I], ctx: 128000 },
  { pattern: 'diffusion', caps: [CAP_T2I], ctx: 8192 },         // diffusiongemma 等
  { pattern: 'muse', caps: [CAP_T2I], ctx: 8192 },              // meta/muse-*
  // ---- 视频生成 ----
  { pattern: 'video', caps: ['视频'], ctx: 8192 },
  { pattern: 'sora', caps: ['视频'], ctx: 8192 },
  { pattern: 'kling', caps: ['视频'], ctx: 8192 },
  { pattern: 'hailuo', caps: ['视频'], ctx: 8192 },
  // ---- 音频 ----
  { pattern: 'whisper', caps: [CAP_AUDIO], ctx: 16384 },
  { pattern: 'tts', caps: [CAP_AUDIO] },
  { pattern: 'sensevoice', caps: [CAP_AUDIO] },
  { pattern: 'cosyvoice', caps: [CAP_AUDIO] },
  // ---- 视觉多模态（能看图）----
  { pattern: 'gpt-4o', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 128000 },
  { pattern: 'gpt-4.1', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 1047576 },
  { pattern: 'gpt-4-turbo', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 128000 },
  { pattern: 'gpt-4-vision', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 128000 },
  { pattern: 'gpt-5', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 400000 },
  { pattern: 'o1', caps: [CAP_TEXT, CAP_REASON], ctx: 200000 },
  { pattern: 'o3', caps: [CAP_TEXT, CAP_TOOL, CAP_REASON], ctx: 200000 },
  { pattern: 'o4', caps: [CAP_TEXT, CAP_TOOL, CAP_REASON], ctx: 200000 },
  { pattern: 'claude-3', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 200000 },
  { pattern: 'claude-4', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 200000 },
  { pattern: 'claude-sonnet', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 200000 },
  { pattern: 'claude-opus', caps: [CAP_TEXT, CAP_TOOL, CAP_REASON], ctx: 200000 },
  { pattern: 'claude-haiku', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 200000 },
  { pattern: 'gemini', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 1048576 },
  { pattern: 'gemma', caps: [CAP_TEXT, CAP_VISION], ctx: 128000 },
  { pattern: 'qwen-vl', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 128000 },
  { pattern: 'qwen2-vl', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 128000 },
  { pattern: 'qwen2.5-vl', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 128000 },
  { pattern: 'qwen3-vl', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 128000 },
  { pattern: '-vl-', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 32000 },
  { pattern: 'vision', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 32000 },
  { pattern: 'internvl', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 32000 },
  { pattern: 'minicpm-v', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 32000 },
  { pattern: 'glm-4v', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 128000 },
  { pattern: 'glm-4.1v', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 64000 },
  { pattern: 'glm-4.5v', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 64000 },
  { pattern: 'llama-3.2', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 128000 },
  { pattern: 'llama-4', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 1048576 },
  { pattern: 'pixtral', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 128000 },
  { pattern: 'molmo', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 32000 },
  // ---- 推理模型 ----
  { pattern: 'deepseek-r1', caps: [CAP_TEXT, CAP_REASON], ctx: 64000 },
  { pattern: 'deepseek-reasoner', caps: [CAP_TEXT, CAP_REASON], ctx: 64000 },
  { pattern: 'glm-z1', caps: [CAP_TEXT, CAP_REASON], ctx: 32000 },
  { pattern: 'qwq', caps: [CAP_TEXT, CAP_REASON], ctx: 32000 },
  { pattern: 'thinking', caps: [CAP_TEXT, CAP_REASON], ctx: 32000 },
  { pattern: 'reasoning', caps: [CAP_TEXT, CAP_REASON], ctx: 32000 },
  { pattern: 'marco-o1', caps: [CAP_TEXT, CAP_REASON], ctx: 32000 },
  { pattern: 'skywork-o1', caps: [CAP_TEXT, CAP_REASON], ctx: 32000 },
  // ---- GLM 系（智谱，注意放视觉/推理规则之后）----
  { pattern: 'glm-4.7', caps: [CAP_TEXT, CAP_TOOL], ctx: 200000 },
  { pattern: 'glm-4.6', caps: [CAP_TEXT, CAP_TOOL], ctx: 200000 },
  { pattern: 'glm-4.5', caps: [CAP_TEXT, CAP_TOOL], ctx: 128000 },
  { pattern: 'glm-4-plus', caps: [CAP_TEXT, CAP_TOOL], ctx: 128000 },
  { pattern: 'glm-4-air', caps: [CAP_TEXT, CAP_TOOL], ctx: 128000 },
  { pattern: 'glm-4-airx', caps: [CAP_TEXT, CAP_TOOL], ctx: 128000 },
  { pattern: 'glm-4-flash', caps: [CAP_TEXT, CAP_TOOL, CAP_FREE], ctx: 128000 },   // 官方长期免费
  { pattern: 'glm-4', caps: [CAP_TEXT, CAP_TOOL], ctx: 128000 },
  { pattern: 'glm-5', caps: [CAP_TEXT, CAP_TOOL], ctx: 200000 },
  { pattern: 'glm-3', caps: [CAP_TEXT, CAP_TOOL], ctx: 128000 },
  { pattern: 'chatglm', caps: [CAP_TEXT, CAP_TOOL], ctx: 32000 },
  // ---- DeepSeek ----
  { pattern: 'deepseek-v3', caps: [CAP_TEXT, CAP_TOOL], ctx: 128000 },
  { pattern: 'deepseek-v2', caps: [CAP_TEXT, CAP_TOOL], ctx: 128000 },
  { pattern: 'deepseek-chat', caps: [CAP_TEXT, CAP_TOOL], ctx: 64000 },
  { pattern: 'deepseek-coder', caps: [CAP_TEXT, CAP_TOOL], ctx: 64000 },
  { pattern: 'deepseek-flash', caps: [CAP_TEXT, CAP_TOOL], ctx: 64000 },
  { pattern: 'deepseek', caps: [CAP_TEXT, CAP_TOOL], ctx: 64000 },
  // ---- Qwen 系（阿里）----
  { pattern: 'qwen3.5', caps: [CAP_TEXT, CAP_TOOL], ctx: 262144 },
  { pattern: 'qwen3.8', caps: [CAP_TEXT, CAP_TOOL], ctx: 262144 },
  { pattern: 'qwen3-max', caps: [CAP_TEXT, CAP_TOOL], ctx: 262144 },
  { pattern: 'qwen3', caps: [CAP_TEXT, CAP_TOOL], ctx: 131072 },
  { pattern: 'qwen2.5-max', caps: [CAP_TEXT, CAP_TOOL], ctx: 32768 },
  { pattern: 'qwen2.5', caps: [CAP_TEXT, CAP_TOOL], ctx: 131072 },
  { pattern: 'qwen-plus', caps: [CAP_TEXT, CAP_TOOL], ctx: 131072 },
  { pattern: 'qwen-turbo', caps: [CAP_TEXT, CAP_TOOL], ctx: 131072 },
  { pattern: 'qwen-long', caps: [CAP_TEXT, CAP_TOOL], ctx: 1000000 },
  { pattern: 'qwq', caps: [CAP_TEXT, CAP_REASON], ctx: 32000 },
  { pattern: 'qwen', caps: [CAP_TEXT, CAP_TOOL], ctx: 32768 },
  { pattern: 'qwq', caps: [CAP_TEXT, CAP_REASON], ctx: 32000 },
  // ---- Kimi / Moonshot ----
  { pattern: 'kimi-k', caps: [CAP_TEXT, CAP_TOOL], ctx: 262144 },
  { pattern: 'kimi', caps: [CAP_TEXT, CAP_TOOL], ctx: 131072 },
  { pattern: 'moonshot', caps: [CAP_TEXT, CAP_TOOL], ctx: 131072 },
  // ---- OpenAI 通用 ----
  { pattern: 'gpt-4o-mini', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 128000 },
  { pattern: 'gpt-4.1-mini', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 1047576 },
  { pattern: 'gpt-4', caps: [CAP_TEXT, CAP_TOOL], ctx: 8192 },
  { pattern: 'gpt-3.5', caps: [CAP_TEXT, CAP_TOOL], ctx: 16385 },
  { pattern: 'gpt-oss', caps: [CAP_TEXT, CAP_TOOL], ctx: 131072 },
  { pattern: 'chatgpt', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 128000 },
  // ---- 其他常见家族兜底 ----
  { pattern: 'llama-3.1', caps: [CAP_TEXT, CAP_TOOL], ctx: 131072 },
  { pattern: 'llama-3.3', caps: [CAP_TEXT, CAP_TOOL], ctx: 131072 },
  { pattern: 'llama-3', caps: [CAP_TEXT, CAP_TOOL], ctx: 8192 },
  { pattern: 'llama-2', caps: [CAP_TEXT], ctx: 4096 },
  { pattern: 'llama', caps: [CAP_TEXT, CAP_TOOL], ctx: 8192 },
  { pattern: 'mistral', caps: [CAP_TEXT, CAP_TOOL], ctx: 32768 },
  { pattern: 'mixtral', caps: [CAP_TEXT, CAP_TOOL], ctx: 32768 },
  { pattern: 'codestral', caps: [CAP_TEXT, CAP_TOOL], ctx: 32768 },
  { pattern: 'ministral', caps: [CAP_TEXT, CAP_TOOL], ctx: 131072 },
  { pattern: 'yi-', caps: [CAP_TEXT, CAP_TOOL], ctx: 16384 },
  { pattern: 'baichuan', caps: [CAP_TEXT, CAP_TOOL], ctx: 32768 },
  { pattern: 'intern-s', caps: [CAP_TEXT, CAP_TOOL], ctx: 131072 },
  { pattern: 'internlm', caps: [CAP_TEXT, CAP_TOOL], ctx: 32768 },
  { pattern: 'hunyuan', caps: [CAP_TEXT, CAP_TOOL], ctx: 32768 },
  { pattern: 'ernie', caps: [CAP_TEXT, CAP_TOOL], ctx: 8192 },
  { pattern: 'spark', caps: [CAP_TEXT, CAP_TOOL], ctx: 8192 },
  { pattern: 'step-', caps: [CAP_TEXT, CAP_TOOL], ctx: 16384 },
  { pattern: 'command-r', caps: [CAP_TEXT, CAP_TOOL], ctx: 128000 },
  { pattern: 'command', caps: [CAP_TEXT, CAP_TOOL], ctx: 8192 },
  { pattern: 'nova-', caps: [CAP_TEXT, CAP_TOOL, CAP_VISION], ctx: 300000 },
  { pattern: 'nemotron', caps: [CAP_TEXT, CAP_TOOL], ctx: 131072 },
  { pattern: 'phi-4', caps: [CAP_TEXT, CAP_TOOL], ctx: 16384 },
  { pattern: 'phi-3', caps: [CAP_TEXT, CAP_TOOL], ctx: 128000 },
  { pattern: 'phi-2', caps: [CAP_TEXT], ctx: 2048 },
  { pattern: 'gemma-2', caps: [CAP_TEXT], ctx: 8192 },
  { pattern: 'gemma-3', caps: [CAP_TEXT, CAP_VISION], ctx: 128000 },
  { pattern: 'gemma', caps: [CAP_TEXT, CAP_VISION], ctx: 8192 },
  { pattern: 'falcon', caps: [CAP_TEXT], ctx: 2048 },
  { pattern: 'vicuna', caps: [CAP_TEXT], ctx: 2048 },
  { pattern: 'orca', caps: [CAP_TEXT], ctx: 4096 },
  { pattern: 'granite', caps: [CAP_TEXT, CAP_TOOL], ctx: 131072 },
  { pattern: 'lfm', caps: [CAP_TEXT, CAP_TOOL], ctx: 32768 },
  { pattern: 'sensenova', caps: [CAP_TEXT, CAP_TOOL], ctx: 32768 },
  { pattern: 'dots-', caps: [CAP_TEXT, CAP_TOOL], ctx: 32768 },
  { pattern: 'inkling', caps: [CAP_TEXT], ctx: 32768 },
  { pattern: 'laguna', caps: [CAP_TEXT], ctx: 32768 },
  { pattern: 'north', caps: [CAP_TEXT], ctx: 16384 },
  { pattern: 'atria', caps: [CAP_TEXT, CAP_TOOL], ctx: 32768 },
  { pattern: 'agents-a', caps: [CAP_TEXT, CAP_TOOL], ctx: 32768 },
  { pattern: 'kev', caps: [CAP_TEXT], ctx: 8192 },
];

// 小模型/快速版启发：上下文通常较小
const SMALL_HINTS = [
  { pattern: '-mini', ctx: 128000 },
  { pattern: '-small', ctx: 32768 },
  { pattern: '-flash', ctx: 128000 },
  { pattern: '-lite', ctx: 65536 },
  { pattern: '-air', ctx: 32768 },
  { pattern: '-nano', ctx: 32768 },
  { pattern: '-micro', ctx: 8192 },
  { pattern: '-tiny', ctx: 4096 },
  { pattern: '7b', ctx: 32768 },
  { pattern: '8b', ctx: 32768 },
  { pattern: '9b', ctx: 32768 },
  { pattern: '4b', ctx: 16384 },
  { pattern: '1b', ctx: 8192 },
  { pattern: '2b', ctx: 8192 },
  { pattern: '3b', ctx: 16384 },
];

// 上下文显式标记优先（如 -128k / -200k / 1m）
function explicitContext(lower) {
  let m = lower.match(/(\d+(?:\.\d+)?)\s*k(?:b)?(?![\w.])/);
  if (m) return Math.round(parseFloat(m[1]) * 1024);
  m = lower.match(/(\d+(?:\.\d+)?)\s*m(?:b)?(?![\w.])/);
  if (m) return Math.round(parseFloat(m[1]) * 1024 * 1024);
  return null;
}

// 免费标记：OpenRouter 风格的 :free 后缀，或名字含 free
function isFreeName(lower) {
  return lower.endsWith(':free') || /(^|[\s\-_/:])free([\s\-_/:]|$)/.test(lower);
}

// 主推断：返回 { caps, context, maxOutput, guessed }
function inferFromName(name) {
  const lower = String(name || '').toLowerCase();
  const caps = new Set();
  let context = null;
  let matched = false;

  // 1) 注册表按序匹配（可能命中多条，能力合并、上下文取先命中的）
  for (const r of RULES) {
    if (lower.includes(r.pattern)) {
      matched = true;
      for (const c of r.caps) caps.add(c);
      if (context == null && r.ctx) context = r.ctx;
    }
  }

  // 2) 显式上下文标记覆盖
  const explicit = explicitContext(lower);
  if (explicit) context = explicit;

  // 3) 未命中注册表时，用小模型启发补一个保守上下文
  if (context == null) {
    for (const h of SMALL_HINTS) {
      if (lower.includes(h.pattern)) { context = h.ctx; break; }
    }
  }

  // 4) 免费标记
  if (isFreeName(lower)) caps.add(CAP_FREE);

  // 5) 能力兜底：什么都没命中时至少给「文本」
  if (caps.size === 0) caps.add(CAP_TEXT);

  return { caps: [...caps], context, matched };
}

// 合并上游扩展字段（第二路）：New API / 部分厂商会在 /v1/models 项里
// 带 context_length / max_output / capabilities 等，能解析就覆盖注册表。
function mergeUpstreamMeta(base, upstream) {
  const out = { caps: [...(base.caps || [])], context: base.context ?? null, maxOutput: base.maxOutput ?? null };
  if (!upstream || typeof upstream !== 'object') return out;
  const u = upstream;
  const cl = u.context_length ?? u.contextLength ?? u.context_window ?? u.max_context_tokens;
  if (typeof cl === 'number' && cl > 0) out.context = cl;
  const mo = u.max_output_tokens ?? u.maxOutputTokens ?? u.max_completion_tokens;
  if (typeof mo === 'number' && mo > 0) out.maxOutput = mo;
  const uc = u.capabilities ?? u.modality ?? u.tags;
  if (Array.isArray(uc)) {
    const map = {
      text: CAP_TEXT, chat: CAP_TEXT, tools: CAP_TOOL, function_calling: CAP_TOOL,
      vision: CAP_VISION, image: CAP_VISION, multimodal: CAP_VISION,
      image_generation: CAP_T2I, t2i: CAP_T2I, audio: CAP_AUDIO, tts: CAP_AUDIO,
      reasoning: CAP_REASON, thinking: CAP_REASON, free: CAP_FREE,
    };
    for (const c of uc) {
      const key = String(c || '').toLowerCase();
      if (map[key]) out.caps.push(map[key]);
    }
    out.caps = [...new Set(out.caps)];
  }
  return out;
}

// 对外统一入口：返回展示用属性
// { caps: string[], context: number|null, source: 'registry'|'guess'|'user' }
function modelMeta(name, opts = {}) {
  const { upstream = null, userMeta = null } = opts;
  // 用户手动修正优先（存 config.json 模型条目的 meta 字段）
  if (userMeta && (Array.isArray(userMeta.caps) || userMeta.context)) {
    return {
      caps: Array.isArray(userMeta.caps) ? [...new Set(userMeta.caps)] : [],
      context: typeof userMeta.context === 'number' ? userMeta.context : null,
      maxOutput: typeof userMeta.maxOutput === 'number' ? userMeta.maxOutput : null,
      source: 'user',
    };
  }
  const base = inferFromName(name);
  const merged = mergeUpstreamMeta(base, upstream);
  return {
    caps: merged.caps,
    context: merged.context ?? null,
    maxOutput: merged.maxOutput ?? null,
    source: base.matched ? 'registry' : 'guess',
  };
}

// 上下文大小的紧凑展示（128K / 1M / 8K）
function fmtContext(ctx) {
  if (!ctx || ctx <= 0) return '';
  if (ctx >= 1048576) {
    const v = ctx / 1048576;
    return (v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')) + 'M';
  }
  if (ctx >= 1024) return Math.round(ctx / 1024) + 'K';
  return String(ctx);
}

export { modelMeta, inferFromName, mergeUpstreamMeta, fmtContext, RULES };
