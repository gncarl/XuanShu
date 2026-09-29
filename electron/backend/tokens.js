// Web Admin 登录会话管理（内存态）。桌面端自动带上 adminToken 免登录。
import { genToken } from './util.js';

export class SessionManager {
  constructor() {
    this.sessions = new Set();
  }
  // 用 adminToken 换取会话 token；若未设置 adminToken 则直接放行
  login(adminToken, provided) {
    if (!adminToken) return { ok: true, token: 'open' };
    if (provided === adminToken) {
      const t = genToken();
      this.sessions.add(t);
      return { ok: true, token: t };
    }
    return { ok: false };
  }
  // 校验请求是否有权限（会话 token 或原始 adminToken）
  authorize(adminToken, headerVal) {
    if (!adminToken) return true; // 未设口令即开放
    if (!headerVal) return false;
    const v = headerVal.replace(/^Bearer\s+/i, '');
    if (v === adminToken) return true;
    if (this.sessions.has(v)) return true;
    return false;
  }
}
