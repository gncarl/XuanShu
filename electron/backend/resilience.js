// 三级容错：
//  L1 模型级冷却（持久化到 config.json，重启后仍生效）
//  L2 内存熔断（模型+频道维度，短时延后进入半开探测）
//  L3 频道级冻结（账号封禁/配额/上游整体故障时临时剔除）
//  外加状态码禁用（401/403/410 直接禁用该条目）
import { nowMs } from './util.js';

export class Resilience {
  constructor(store) {
    this.store = store;
    this.breakers = new Map(); // key: channelId:upstreamModel
  }

  s() { return this.store.settings; }

  isChannelFrozen(channelId) {
    const ch = this.store.getChannel(channelId);
    return !!ch && (ch.frozenUntil || 0) > nowMs();
  }
  freezeChannel(channelId, ms) {
    const ch = this.store.getChannel(channelId);
    if (ch) this.store.updateChannel(channelId, { frozenUntil: nowMs() + (ms ?? this.s().channelFreezeMs) });
  }

  isModelCooled(model) {
    return (model.cooldownUntil || 0) > nowMs() || model.disabled;
  }
  coolModel(model, ms) {
    this.store.setModelCooldown(model.id, nowMs() + (ms ?? this.s().cooldownMs));
  }
  disableModel(model) {
    this.store.setModelDisabled(model.id, true);
  }

  _key(channelId, upstreamModel) { return `${channelId}:${upstreamModel}`; }

  isBreakerOpen(channelId, upstreamModel) {
    const b = this.breakers.get(this._key(channelId, upstreamModel));
    if (!b) return false;
    if (b.openUntil > nowMs()) return true;
    // 进入半开：允许一次试探
    return false;
  }
  breakerHalfOpen(channelId, upstreamModel) {
    const b = this.breakers.get(this._key(channelId, upstreamModel));
    return b && b.openUntil <= nowMs() && b.failures >= this.s().breakerThreshold;
  }
  recordSuccess(channelId, upstreamModel) {
    const k = this._key(channelId, upstreamModel);
    this.breakers.delete(k);
  }
  recordFailure(channelId, upstreamModel) {
    const k = this._key(channelId, upstreamModel);
    const b = this.breakers.get(k) || { failures: 0, openUntil: 0 };
    b.failures += 1;
    if (b.failures >= this.s().breakerThreshold) {
      b.openUntil = nowMs() + this.s().breakerResetMs;
    }
    this.breakers.set(k, b);
  }

  // 是否应因状态码（401/403/410）禁用
  isFatalStatus(status) {
    return status === 401 || status === 403 || status === 410;
  }
}
