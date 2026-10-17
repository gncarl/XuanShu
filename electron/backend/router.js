// 路由：把客户端请求的 model 字符串解析成一组候选（model, channel）并按序排列。
// 支持：路由规则（虚拟模型）、精确匹配、别名、分组、模糊匹配、AUTO 自动组回退。
import { nowMs } from './util.js';

// 轮询游标：把数组整体旋转 n 位
function rotate(arr, n) {
  if (!arr.length) return arr;
  const k = ((n % arr.length) + arr.length) % arr.length;
  return arr.slice(k).concat(arr.slice(0, k));
}

// 加权随机排序（Efraimidis–Spirakis：key = random^(1/weight)，降序）。
// 权重越大越可能排在最前；所有目标仍保留在候选序列里作为故障转移后备。
function weightedShuffle(arr) {
  return arr
    .map((t) => ({ t, k: Math.pow(Math.random(), 1 / Math.max(1, t.weight || 1)) }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.t);
}

export class Router {
  constructor(store, resilience) {
    this.store = store;
    this.res = resilience;
    this.rr = new Map(); // 轮询游标：routeId -> 下一次起始下标
    // 延迟反馈（EWMA）：key = channelId\u0000upstreamModel
    //   ewma：总耗时指数加权平均；ttft：首字延迟（流式）；n：成功次数；fails：失败次数
    //   只统计成功请求——失败由冷却/熔断/负缓存处理，混进来会污染均值。
    this.lat = new Map();
  }

  _latKey(channelId, upstreamModel) { return channelId + '\u0000' + upstreamModel; }

  // 记录一次结果（proxy 在请求结束后调用）。latencyMs 为本次尝试耗时，ttftMs 仅流式有。
  recordLatency(channelId, upstreamModel, { latencyMs = 0, ttftMs = null, ok = true } = {}) {
    const k = this._latKey(channelId, upstreamModel);
    const e = this.lat.get(k) || { ewma: null, ttft: null, n: 0, fails: 0 };
    if (ok) {
      e.n += 1;
      // EWMA：新样本占 0.3，历史占 0.7（与 LiteLLM latency-based-routing 一致）
      if (latencyMs > 0) e.ewma = e.ewma == null ? latencyMs : 0.3 * latencyMs + 0.7 * e.ewma;
      if (ttftMs > 0) e.ttft = e.ttft == null ? ttftMs : 0.3 * ttftMs + 0.7 * e.ttft;
    } else {
      e.fails += 1;
    }
    this.lat.set(k, e);
  }

  // 供管理 API / 前端展示：{ [channelId]: { [upstreamModel]: {ewma,ttft,n,fails} } }
  latencySnapshot() {
    const out = {};
    for (const [k, v] of this.lat) {
      const i = k.indexOf('\u0000');
      const cid = k.slice(0, i), up = k.slice(i + 1);
      (out[cid] ||= {})[up] = { ...v };
    }
    return out;
  }

  // 排序用的「速度分」：TTFT 优先（对话体感主要看首字），没有则总耗时；无数据返回 null
  _speed(x) {
    const e = this.lat.get(this._latKey(x.channel.id, x.model.upstreamModel));
    if (!e) return null;
    return e.ttft ?? e.ewma ?? null;
  }

  // 当前可参与路由的模型（启用、频道启用、未冷却、未冻结、熔断未开）
  _availablePool() {
    const out = [];
    for (const m of this.store.listModels()) {
      if (!m.enabled) continue;
      const ch = this.store.getChannel(m.channelId);
      if (!ch || !ch.enabled) continue;
      if (this.res.isModelCooled(m)) continue;
      if (this.res.isChannelFrozen(ch.id)) continue;
      if (this.res.isBreakerOpen(ch.id, m.upstreamModel)) continue;
      out.push({ model: m, channel: ch });
    }
    return out;
  }

  _order(pool) {
    const mode = this.store.settings.orderMode || 'custom';
    const arr = [...pool];
    // 优先级比较（模型优先，再频道）： fastest 模式同档内、custom 模式前两级都用它
    const byPriority = (a, b) =>
      (a.model.priority - b.model.priority) || (a.channel.priority - b.channel.priority);
    // 速度比较：双方有数据比快慢；仅一方有数据则「已知快的」排前；都无数据保持原序（稳定排序）
    const bySpeed = (a, b) => {
      const sa = this._speed(a), sb = this._speed(b);
      if (sa == null && sb == null) return 0;
      if (sa == null) return 1;
      if (sb == null) return -1;
      return sa - sb;
    };
    if (mode === 'newest') {
      arr.sort((a, b) => (b.model.createdAt || 0) - (a.model.createdAt || 0));
    } else if (mode === 'fastest') {
      // 最快优先：按 EWMA（TTFT 优先）升序；latencyBuffer 内的算同档，档内按优先级排，
      // 防止最快单点吸走全部流量（对齐 LiteLLM lowest_latency_buffer）。无数据的排最后。
      const buf = Math.max(0, Math.min(5, Number(this.store.settings.latencyBuffer ?? 0.5)));
      const withData = [], noData = [];
      for (const x of arr) (this._speed(x) == null ? noData : withData).push(x);
      withData.sort((a, b) => this._speed(a) - this._speed(b));
      const out = [];
      for (let i = 0; i < withData.length;) {
        const base = this._speed(withData[i]);
        let j = i;
        while (j < withData.length && this._speed(withData[j]) <= base * (1 + buf)) j++;
        const group = withData.slice(i, j);
        group.sort(byPriority);
        out.push(...group);
        i = j;
      }
      noData.sort(byPriority);
      return [...out, ...noData];
    } else {
      // custom：优先级 → 频道优先级 → 同档里 EWMA 快的排前（零风险提速，默认生效）
      arr.sort((a, b) => byPriority(a, b) || bySpeed(a, b));
    }
    return arr;
  }

  resolve(requested) {
    const autoName = this.store.settings.autoGroup || 'AUTO';
    const pool = this._availablePool();

    // 0) 路由规则（虚拟模型）：客户端模型名精确命中某条启用的路由。
    //    路由是「用户显式定义」的意图，优先级高于内置 AUTO 与模型名匹配，
    //    且只走它自己的目标（不会兜底到全部模型，避免请求被路由到意料之外的上游）。
    if (requested) {
      const route = this.store.listRoutes().find((r) => r.enabled && r.name && r.name === requested);
      if (route) {
        return {
          candidates: this._resolveRoute(route, pool),
          usedAuto: false,
          route: route.name,
          strategy: route.strategy,
        };
      }
    }

    if (!requested || requested === autoName) {
      return { candidates: this._order(pool), usedAuto: true };
    }

    // 1) 精确 / 别名
    let hits = pool.filter((x) => x.model.name === requested || x.model.alias === requested);
    if (hits.length) return { candidates: this._order(hits), usedAuto: false };

    // 2) 分组
    const grp = this.store.listGroups().find((g) => g.name === requested);
    if (grp) {
      hits = pool.filter((x) => x.model.group === requested);
      if (hits.length) return { candidates: this._order(hits), usedAuto: false };
    }

    // 3) 模糊
    hits = pool.filter((x) =>
      (requested.includes(x.model.name) && x.model.name) ||
      (x.model.name.includes(requested) && requested));
    if (hits.length) return { candidates: this._order(hits), usedAuto: false };

    // 4) 兜底 AUTO：宁可慢一点也要尽量成功
    return { candidates: this._order(pool), usedAuto: true };
  }

  // 按策略把一条路由的目标解析成有序候选（只保留当前可用的目标）。
  //  failover   ：按目标定义顺序依次尝试（第一个不行就下一个）
  //  roundrobin ：每次请求把起始位置后移一位，依次分配、失败自动顺延
  //  weighted   ：按权重随机排序，权重大的更容易第一个被用，其余仍作后备
  _resolveRoute(route, pool) {
    const byId = new Map(pool.map((x) => [x.model.id, x]));
    const avail = (route.targets || []).filter((t) => byId.has(t.modelId));
    if (!avail.length) return [];

    let ordered = avail;
    if (route.strategy === 'roundrobin') {
      const cur = this.rr.get(route.id) || 0;
      ordered = rotate(avail, cur);
      this.rr.set(route.id, (cur + 1) % avail.length);
    } else if (route.strategy === 'weighted') {
      ordered = weightedShuffle(avail);
    }
    return ordered.map((t) => byId.get(t.modelId));
  }
}
