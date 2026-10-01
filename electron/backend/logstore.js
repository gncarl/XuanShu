// 请求日志：以 JSONL 形式追加写入，达到上限后只保留最近的部分。
// 这是“去除 30G 备份”的核心替代方案 —— 日志有界，绝不无限膨胀。
import fs from 'node:fs';
import path from 'node:path';

export class LogStore {
  constructor(dataDir, settings) {
    this.dir = dataDir;
    this.path = path.join(dataDir, 'logs.jsonl');
    this.settings = settings;
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(this.path)) fs.writeFileSync(this.path, '', 'utf8');
  }

  setSettings(s) { this.settings = s; }

  append(record) {
    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(this.path, line, 'utf8');
    // 超限则滚动截断（只保留最近的部分，丢弃最旧的）
    try {
      const { size } = fs.statSync(this.path);
      const cap = this.settings.logCapBytes || 50 * 1024 * 1024;
      if (size > cap) {
        const lines = fs.readFileSync(this.path, 'utf8').split('\n').filter(Boolean);
        const keep = Math.floor((this.settings.logCapLines || 200000) * 0.9);
        const trimmed = lines.slice(-keep);
        fs.writeFileSync(this.path, trimmed.join('\n') + '\n', 'utf8');
      }
    } catch { /* 不影响主流程 */ }
  }

  _readAll() {
    try {
      const txt = fs.readFileSync(this.path, 'utf8');
      return txt.split('\n').filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  // 带缓存的全量读取：JSONL 可能几万行，5 秒轮询不能每次都解析。
  // 按文件 mtime 缓存，文件没变直接复用上次解析结果。
  _readAllCached() {
    try {
      const m = fs.statSync(this.path).mtimeMs;
      if (this._cache && this._cacheMtime === m) return this._cache;
      const rows = this._readAll();
      this._cache = rows;
      this._cacheMtime = m;
      return rows;
    } catch {
      return this._readAll();
    }
  }

  query({ page = 1, pageSize = 30, success, model, channelId, from, to } = {}) {
    let rows = this._readAllCached();
    if (success !== undefined) rows = rows.filter((r) => r.success === success);
    if (model) rows = rows.filter((r) => r.model === model);
    if (channelId) rows = rows.filter((r) => r.channelId === channelId);
    if (from) rows = rows.filter((r) => r.ts >= from);
    if (to) rows = rows.filter((r) => r.ts <= to);
    rows.sort((a, b) => b.ts - a.ts);
    const total = rows.length;
    const start = (page - 1) * pageSize;
    return { rows: rows.slice(start, start + pageSize), total, page, pageSize };
  }

  // 本地时区的 YYYY-MM-DD
  _dayKey(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  stats() {
    const rows = this._readAllCached();
    const total = rows.length;
    const ok = rows.filter((r) => r.success).length;
    let promptTokens = 0, completionTokens = 0, totalTokens = 0;
    const byModel = {};      // 模型 → { count, tokens }
    const byChannel = {};    // 提供商 → { count, tokens }
    const byDay = {};        // YYYY-MM-DD → { count, tokens, success, failed }

    // 今日统计的起点：本地时区今天 0 点
    const today = this._dayKey(Date.now());

    for (const r of rows) {
      promptTokens += r.promptTokens || 0;
      completionTokens += r.completionTokens || 0;
      totalTokens += r.totalTokens || 0;

      const mKey = r.model || '(未知)';
      const m = byModel[mKey] || (byModel[mKey] = { count: 0, tokens: 0 });
      m.count += 1; m.tokens += r.totalTokens || 0;

      const cKey = r.channelName || '(未知)';
      const c = byChannel[cKey] || (byChannel[cKey] = { count: 0, tokens: 0 });
      c.count += 1; c.tokens += r.totalTokens || 0;

      const dk = this._dayKey(r.ts);
      const d = byDay[dk] || (byDay[dk] = { count: 0, tokens: 0, success: 0, failed: 0 });
      d.count += 1; d.tokens += r.totalTokens || 0;
      if (r.success) d.success += 1; else d.failed += 1;
    }

    // 全年热力图：过去 365 天，按天给出 { date, count, tokens }
    const heatmap = [];
    const now = new Date();
    for (let i = 364; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = this._dayKey(d.getTime());
      const v = byDay[key];
      heatmap.push({ date: key, count: v?.count || 0, tokens: v?.tokens || 0 });
    }

    // 30 天趋势（请求数 + token，按天）
    const trend30 = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = this._dayKey(d.getTime());
      const v = byDay[key];
      trend30.push({ date: key, count: v?.count || 0, tokens: v?.tokens || 0, success: v?.success || 0, failed: v?.failed || 0 });
    }

    const t = byDay[today] || { count: 0, tokens: 0, success: 0, failed: 0 };
    const activeDays = Object.keys(byDay).length;
    const avgPerDay = activeDays ? Math.round(total / activeDays) : 0;

    // 最近 24 小时按小时分桶做趋势（仪表盘还在用）
    const nowMs = Date.now();
    const buckets = new Array(24).fill(0);
    const failBuckets = new Array(24).fill(0);
    for (const r of rows) {
      const hAgo = Math.floor((nowMs - r.ts) / 3600000);
      if (hAgo >= 0 && hAgo < 24) {
        buckets[23 - hAgo] += 1;
        if (!r.success) failBuckets[23 - hAgo] += 1;
      }
    }

    return {
      total,
      success: ok,
      failed: total - ok,
      successRate: total ? (ok / total) : 1,
      promptTokens, completionTokens, totalTokens,
      byModel, byChannel,
      today: { count: t.count, tokens: t.tokens, success: t.success, failed: t.failed },
      avgPerDay, activeDays,
      heatmap, trend30,
      trend: { success: buckets, failed: failBuckets, labels: buckets.map((_, i) => `${23 - i}h`) },
    };
  }

  clear() {
    fs.writeFileSync(this.path, '', 'utf8');
    this._cache = null;
    this._cacheMtime = 0;
  }
}
