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

  query({ page = 1, pageSize = 30, success, model, channelId, from, to } = {}) {
    let rows = this._readAll();
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

  stats() {
    const rows = this._readAll();
    const total = rows.length;
    const ok = rows.filter((r) => r.success).length;
    let promptTokens = 0, completionTokens = 0, totalTokens = 0;
    const byModel = {};
    const byChannel = {};
    for (const r of rows) {
      promptTokens += r.promptTokens || 0;
      completionTokens += r.completionTokens || 0;
      totalTokens += r.totalTokens || 0;
      byModel[r.model] = (byModel[r.model] || 0) + 1;
      byChannel[r.channelName] = (byChannel[r.channelName] || 0) + 1;
    }
    // 最近 24 小时按小时分桶做趋势
    const now = Date.now();
    const buckets = new Array(24).fill(0);
    const failBuckets = new Array(24).fill(0);
    for (const r of rows) {
      const hAgo = Math.floor((now - r.ts) / 3600000);
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
      trend: { success: buckets, failed: failBuckets, labels: buckets.map((_, i) => `${23 - i}h`) },
    };
  }

  clear() {
    fs.writeFileSync(this.path, '', 'utf8');
  }
}
