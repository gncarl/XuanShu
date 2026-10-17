# 主流 AI 聚合路由工具调研 & 玄枢提速建议

> 2026-10-17 · 基于公开资料（LiteLLM 文档与源码解析、OpenRouter 官方说明、Bifrost/Kong 对比评测、腾讯云开发者社区技术文章、Techstrong/Techcrunch 行业报道）与玄枢现有代码（`router.js` / `resilience.js` / `proxy.js`）逐项比对。

---

## 一、行业现状：三代技术演进

| 阶段 | 核心逻辑 | 算力利用率 | 平均延迟 | 容错 |
|---|---|---|---|---|
| 第一代（2023 前）静态规则 | 关键词/路径 → 固定映射，无实时反馈 | 55–65% | 800–1200ms | 被动切换，恢复 3–5s |
| 第二代（2023–2024）基础动态 | 实时负载/QPS/延迟驱动，负载均衡 + 故障转移 | 70–80% | 500–800ms | 主动检测，恢复 1–2s |
| 第三代（2025 至今）语义智能 | Embedding 语义解析 + 任务复杂度评分 + KV 缓存感知 + 成本权重 | 85–92% | 200–500ms | 预判式容错，无感切换 |

产品形态分两类：

- **网关型**（统一 API + 管理 + failover）：OpenRouter、LiteLLM、Portkey、Kong AI Gateway、Bifrost、Cloudflare AI Gateway
- **智能路由型**（按请求选模型）：Not Diamond、RouteLLM、Semantic Router、Martian
- **新锐**：Cursor Router（编程场景，宣称降本 30–50%）、Ramp Router（OpenAI 兼容端点，降本 30%）、Meta SwitchBoard（内部自用）

## 二、各工具路由规则要点

### OpenRouter（托管聚合标杆）
- 四种路由模式：**cheapest**（满足能力要求的最低价）、**lowest-latency**、**highest-throughput**、**pinned**（锁定供应商）
- 自动 failover：主供应商 5xx 透明切换到同模型备份供应商
- KV cache 折扣透传（如 DeepSeek 输入缓存命中价）
- 实时公布各模型延迟/吞吐统计（模型卡片可见）

### LiteLLM（自托管，最值得参考）
五种路由策略：

| 策略 | 选择依据 | 开销 |
|---|---|---|
| simple-shuffle（默认） | 按 rpm/weight 加权随机 | 最低，官方生产推荐 |
| least-busy | 当前活跃请求数最少的部署 | 低 |
| latency-based-routing | EWMA 响应时间最快（`new = 0.3×当前 + 0.7×历史`） | 低，需预热 |
| usage-based-routing | 当前 TPM 最低（需 Redis，官方不推荐生产） | 高 |
| cost-based-routing | 当前最便宜 | 低 |

关键机制：
- **order 分层 + fallbacks 列表**：先按 order 层级依次重试，同层耗尽才降级到另一模型组的 fallbacks；`enable_weighted_failover` 支持组内先换部署再跨组
- **429 立即冷却**：不耗完重试次数，直接把失败部署挂起（cooldown），并尊重 `Retry-After` 或指数退避，避免惊群
- **专项 fallback**：`context_window_fallbacks`（超上下文换大窗模型）、`content_policy_fallbacks`（内容审核拦截换模型）
- **lowest_latency_buffer**：延迟在「最快者 50% 以内」的都算候选，防止最快单点吸走全部流量

### Bifrost（Go，性能标杆）
- 路由开销 11µs @ 5k RPS；CEL 规则引擎表达力最强；虚拟 key、预算上限、RBAC、guardrails
- 启示：**规则引擎与请求路径解耦**，策略可配置不写死

### AWS Bedrock Intelligent Prompt Routing
- 托管复杂度分类器，同模型族内双模型路由（Haiku↔Sonnet），混合负载降本 30%
- 局限：仅限同族、不可跨供应商——个人/小网关场景参考价值有限

## 三、玄枢现状与差距

**已有（0.2.4）**：路由规则（failover / roundrobin / weighted 三策略）、AUTO 静态优先级排序、L1 模型冷却（持久化）/ L2 内存熔断 / L3 频道冻结、401/403/410 直接禁用、AUTO 负缓存（模型不存在类 4xx 短期跳过）、同目标原地重试 + 间隔、流式首字节保护 + 空流冻结。

**核心差距（按对「访问速度」的影响排序）**：

1. **每次请求都新建 TCP/TLS 连接**——`proxy.js` 的 `_forwardOnce` 用裸 `https.request()`，无 `keepAlive` Agent。国内直连海外 API 单次 TLS 握手约 300–600ms（2-RTT + 握手往返），这是当前**最大的单点提速空间**。
2. **延迟数据只记录、不参与路由**——`logstore` 已落 `latencyMs`，但 `router._order()` 只用静态 `model.priority`，跑得慢的候选永远排前面。
3. **无 TTFT（首字延迟）度量**——对话/agent 场景体感主要取决于首字延迟，现在只记总延迟。
4. **无并发感知**——多请求并发时全部涌向 priority 最高的候选，没有 least-busy 均衡。
5. **429 不尊重 `Retry-After`**——限流后按固定间隔重试，容易在恢复期内反复撞墙。
6. **候选上限硬编码 6 个**（`MAX_RETRIES`），模型池扩大后尾部候选永远轮不到。

## 四、改进建议（按性价比排序）

### P0 — 低成本高收益，建议下一版本

1. **HTTP keep-alive 连接复用 + DNS 缓存**
   - 按 channel 维度建 `https.Agent({ keepAlive: true, maxSockets: 8 })` 池；Node 默认不缓存 DNS，可加 `dns.lookup` 结果缓存（TTL 60s）
   - 预期：每次请求省一次完整 TLS 握手，冷请求延迟立降 300ms 量级（取决于上游 RTT）
2. **latency-based 路由（EWMA）**
   - 在 `resilience` 或 router 侧按 `(channelId, upstreamModel)` 维护 EWMA 延迟；AUTO 排序与路由策略排序时，把 EWMA 作为 priority 之后的次级排序键（或设置里加 `latencyFirst` 开关）
   - 引入 `lowest_latency_buffer`（默认 0.5）防止最快单点吸流
   - 重试成功即清空/衰减该键，避免一次慢请求长期影响排序
3. **429 尊重 `Retry-After`**
   - `_forwardOnce` 拿到 429 时解析响应头 `Retry-After`（秒或 HTTP 日期），冷却该候选到指定时刻，而不是用固定 `cooldownMs`

### P1 — 中等成本，视使用情况排期

4. **least-busy 并发均衡**：router 维护每候选 in-flight 计数，priority 相同（或 roundrobin 组内）时优先选空闲的；请求结束计数减一
5. **TTFT 单独打点**：流式分支在首字节到达时记录 `ttftMs`，路由用 TTFT 的 EWMA（比总延迟更贴合对话体感）；仪表盘可展示
6. **后台预热探测**：低优先级定时任务（如每 5 分钟）对启用候选发 1-token 请求，预热连接 + 刷新 EWMA，避免「首个用户请求替所有人热身」

### P2 — 长期或按需

7. **动态 priority 微调**：根据近期成功率对静态 priority 做 ±1 档浮动，让「快且稳」的候选自然上浮
8. **并行 hedging**：首候选超过 P75 延迟仍未首字节时，并行试探第二候选，先到先得——流式场景有双写风险，需谨慎，建议仅非流式开启
9. **语义/复杂度路由**：需引入分类器，对单人本地网关属于过度设计，暂不建议

## 五、结论

玄枢的容错体系（三级容错 + 负缓存）已接近 LiteLLM 水平，真正的短板在**连接管理与延迟反馈**：不做 keep-alive，每一次 AUTO 重试都在付全额 TLS 握手费；不把延迟用于路由，priority 排序形同虚设。建议优先落地 P0 三项——工作量集中在 `proxy.js`（Agent 池、Retry-After）和 `router.js`/`resilience.js`（EWMA 排序键）两个文件，不动数据模型，风险可控。
