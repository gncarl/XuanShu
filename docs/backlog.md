# 玄枢 XuanShu · 需求与版本规划（Backlog）

> 本文件记录已确认、待排入后续版本的需求。每完成一个，从对应版本小节移除并写入 `CHANGELOG.md`。

---

## 0.2.3（已发布 · 2026-10-10 · 见 CHANGELOG）

> 本版本两项需求已全部实现并随 v0.2.3 发布，详细变更见 `CHANGELOG.md` 的 `[0.2.3]` 章节。

- ✅ **「关于」面板**：侧边栏新增「关于」入口，展示版本号、GitHub 仓库/Releases 链接、`shell.openExternal` 打开外部浏览器、「检查更新」按钮（后端代理请求 GitHub 比对版本号）。
- ✅ **配置导入 / 导出**：设置页「导出配置」「导入配置」两张卡片；支持玄枢原生格式与 One API / New API 兼容格式（自动识别）；导入前自动备份 `config.json`。
- ✅ **顺带修复**：US 频道「链接通但拉不到模型」假绿灯（Modal 中转需 `x-forward-secret` 自定义头，旧探测误判 401/403 为通；现支持 extraHeaders 透传与 401/403 鉴权识别）。
- ✅ **顺带优化**：频道删除改垃圾桶图标、协议徽标不折行、探测结果与按钮同行、UI 排版打磨。

---

## 0.2.4（已发布 · 2026-10-16 · 见 CHANGELOG）

> 本版本三项需求已全部实现并随 v0.2.4 发布，详细变更见 `CHANGELOG.md` 的 `[0.2.4]` 章节。

- ✅ **模型属性小标签**：拉模型列表与模型池表格展示能力 chip（文本/工具/视觉/推理/文生图/视频/音频/免费）+ 上下文大小（`128K 上下文`）。三路合并：本地能力注册表（`modelMeta.js`）+ 上游扩展字段（`context_length` 等）+ 命名推断兜底（标「推测」）；模型池每行「属性」按钮可手动修正并持久化（用户修正优先，导入导出保留）。
- ✅ **仪表盘「当日优先 + 时间段切换」**：第一屏今日 Token 调用 KPI（副标注累计值）；下方分段控件（当日/近 7 天/近 15 天/近 30 天/自定义区间）展示区间汇总 + 每日 Token 柱状/请求数折线组合图；后端 `stats()` 新增全量 `byDay` 输出；按天补零不断线。
- ✅ **手动输入模型名加入**：频道弹窗常驻输入框，Enter 加入并默认勾选，支持逗号/空格分隔批量；标「手动·未验证」；与 `fetched.length > 0` 条件解耦，上游拉取失败/返回 0 时同样可加；落库走既有 `addModel`，后端无需改动。

---

## 0.2.5（已发布 · 2026-10-17 · 见 CHANGELOG）

> 本版本六项需求已全部实现并随 v0.2.5 发布，详细变更见 `CHANGELOG.md` 的 `[0.2.5]` 章节。

- ✅ **拉模型弹窗支持「取消勾选 = 取消加入」**：已入池模型在拉取列表中以勾选态回显，取消勾选即从模型池移除；底部按钮按变更动态显示（加入 / 取消加入 / 应用变更），移除前确认；摘要行实时显示待加入 / 待移除数。
- ✅ **频道停用后其名下模型从模型池隐藏**：采用「隐藏但保留」策略——模型池表格默认不显示已停用频道的模型，提供「显示已停用频道的 N 个」开关，展开后置灰 + 「已停用」徽标；频道恢复后模型自动回归，不误删配置。
- ✅ **P0-1 HTTP keep-alive 连接复用 + DNS 缓存**：proxy.js 按频道维度 keep-alive Agent 池（maxSockets 16），免去每次请求的 TCP/TLS 握手；DNS 结果缓存 60s（保留 SNI/Host）。
- ✅ **P0-2 EWMA latency 路由**：`(频道,上游模型)` EWMA（总耗时 + 流式 TTFT，仅统计成功）；「最快优先」排序模式落地（含 latencyBuffer 同档缓冲，设置项可调）；「自定义优先级」同档按 EWMA 快的排前。新增 `GET /api/latency` 与模型池「延迟」列。
- ✅ **P0-3 429/503 尊重 `Retry-After`**：按上游告知时长冷却候选（替代固定 cooldownMs）；长等待跳过同目标原地重试直接切换；attempts 记录 retryAfterMs。
- ✅ **P1-2 TTFT 单独打点**：流式首字节延迟计入 EWMA 并作为排序速度分（对话体感主要看首字）。

## 0.2.6（规划中 · 2026-10-17 记录）

- [ ] **应用内自动更新（electron-updater + GitHub Releases）**：0.2.3「关于」面板里的「检查更新」目前只是后端代理请求 GitHub 比对版本号、提示手动下载；本项做真正的应用内更新链路。
  - 方案：`electron-updater`（Electron 应用内更新事实标准），更新源指向本仓库 GitHub Releases（`gncarl/XuanShu`）。
  - 主进程：新增 `electron/updater.js`——`autoUpdater.checkForUpdates()` → `update-available` → `downloadUpdate`（进度事件）→ `update-downloaded` → `quitAndInstall()`；IPC 桥接（`update:check` / `update:progress` / `update:install`）给渲染层。
  - UI：「关于」面板（或设置页）显示当前版本 + 「检查更新」按钮 + 状态流（检查中 → 已是最新版 / 发现新版本 x.y.z（下载中 NN%）→ 下载完成，重启安装）；失败提示 + 「去 GitHub 手动下载」兜底链接。
  - 打包：`electron-builder` 配置 `publish: { provider: 'github', owner: 'gncarl', repo: 'XuanShu' }`；electron-builder 每次打包会自动产出 `latest.yml` + `.blockmap`（已验证 0.2.5 产物里已有）。
  - **注意点（实现时必须处理）**：
    1. 玄枢**无代码签名证书**，electron-updater 默认校验更新包签名会直接失败 → 设置 `autoUpdater.verifyUpdateCodeSignature = false`（仅用 latest.yml 里的 sha512 校验完整性）。安装时用户仍会看到「未知发布者」警告——与现在手动双击安装的体验一致，不算倒退。
    2. **每次手动建 GitHub Release 时必须同时上传 `latest.yml`**（打包产物目录里现成，和 exe 一起拖上去），否则客户端检查更新会 404。需在发布说明模板 / 收尾检查清单里加这一步。
    3. 国内网络从 GitHub Releases 下载 84MB 可能很慢或中断 → 下载进度展示 + 失败可重试 + 保留下载页兜底；后续如需可换源（Gitee Releases / 对象存储），electron-updater 的 `setFeedURL` 支持自定义源，数据结构不变。
    4. delta 差量更新依赖签名，未签名只能全量下载；可接受（84MB）。
    5. 建议「启动时静默检查 + 手动检查按钮」双通道，静默检查失败不打扰。
- [ ] **P1-1 least-busy 并发均衡**：router 维护每候选 in-flight 计数，priority 相同或 roundrobin 组内优先选空闲候选。
- [ ] **P1-3 后台预热探测**：定时任务（如 5 分钟）对启用候选发 1-token 请求，预热连接 + 刷新 EWMA，避免「首个用户请求替所有人热身」。
- [ ] **P2-1 动态 priority 微调**：按近期成功率对静态 priority ±1 档浮动。
- [ ] **P2-2 并行 hedging**：首候选超过 P75 延迟无首字节时并行试探第二候选；有双写风险，建议仅非流式开启，默认关。

## 待评估 /  backlog（尚未排期）

- （暂无其他）
