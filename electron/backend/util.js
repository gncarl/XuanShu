// 通用工具函数。
import crypto from 'node:crypto';

export function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export function nowMs() {
  return Date.now();
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 深度合并（用于设置合并），不修改入参
export function deepMerge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(patch || {})) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] !== null) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// 对可能含密钥的对象做脱敏，便于日志记录
export function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  const secrets = ['apiKey', 'key', 'token', 'secret', 'authorization', 'x-api-key', 'password'];
  for (const [k, v] of Object.entries(obj)) {
    if (secrets.includes(k.toLowerCase()) && typeof v === 'string' && v) {
      out[k] = v.slice(0, 4) + '****' + v.slice(-2);
    } else if (v && typeof v === 'object') {
      out[k] = redact(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// 生成随机 admin token
export function genToken() {
  return crypto.randomBytes(18).toString('base64url');
}

// 去掉 URL 尾部斜杠
export function trimSlash(u) {
  return (u || '').replace(/\/+$/, '');
}

// 归一化上游 Base URL：末尾若已带版本段（/v1、/v4、/v1beta…）就原样使用，
// 否则补上该协议默认的版本段。这样下面几种常见填法都能连对：
//   https://api.openai.com                 → 补 /v1
//   https://api.siliconflow.cn/v1          → 原样（不再拼成 /v1/v1 → 404）
//   https://open.bigmodel.cn/api/paas/v4   → 原样
export function withVersion(u, version = 'v1') {
  const base = trimSlash(u);
  if (!base) return base;
  return /\/v\d+[a-z0-9]*$/i.test(base) ? base : `${base}/${version}`;
}

// 把 Buffer 按行切分，处理跨 chunk 的不完整行
export function makeLineSplitter(onLine) {
  let buf = '';
  return (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      onLine(line);
    }
  };
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// 比较两段版本号（形如 "0.2.3" / "v0.2.3" / "0.2.3-beta.1"）。
// 返回 -1 / 0 / 1。缺省的段按 0 处理；预发布标识（-xxx）视为比正式版小。
export function compareVersion(a, b) {
  const norm = (s) => String(s || '').trim().replace(/^v/i, '');
  const parse = (s) => {
    const [core, pre = ''] = norm(s).split('-');
    const nums = core.split('.').map((x) => parseInt(x, 10) || 0);
    return { nums, pre };
  };
  const A = parse(a);
  const B = parse(b);
  const n = Math.max(A.nums.length, B.nums.length);
  for (let i = 0; i < n; i++) {
    const x = A.nums[i] || 0;
    const y = B.nums[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  // 数字段相同：无预发布标识的更大
  if (!A.pre && B.pre) return 1;
  if (A.pre && !B.pre) return -1;
  if (A.pre === B.pre) return 0;
  return A.pre > B.pre ? 1 : -1;
}
