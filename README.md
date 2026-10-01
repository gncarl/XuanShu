# 玄枢 · XuanShu

**本地 AI 模型聚合路由网关** —— 把多家上游模型收拢成**一个统一的 OpenAI 兼容入口**，并可按名字路由到多个上游，支持**故障转移 / 轮询 / 加权**三种策略。

> 用 **Electron + React + Node** 实现；纯 Node 后端、无原生依赖（不编译 `.node`）。
>
> 「玄」取深幽之意，「枢」为枢纽——多路模型汇于一点，正是它做的事。

---

## 它能干什么

| 能力 | 说明 |
| --- | --- |
| 统一本地 OpenAI 兼容端点 | 客户端 Base URL 指向 `http://127.0.0.1:9090/v1` 即可 |
| 五协议转换 | OpenAI / OpenAI Responses / Claude / Gemini / Azure，任意上游任意协议，对客户端都表现为 OpenAI 格式 |
| 模型池 + 分组 + 别名 + AUTO 回退 | 客户端填 `auto` 即自动选路，填具体名则精确匹配 |
| **路由规则（虚拟模型）** | 自定义客户端模型名（如 `auto` / `local` / `fast`）→ 路由到一个或多个上游，策略可选：**故障转移 failover** / **轮询 roundrobin** / **加权 weighted** |
| 多选 + 全选 | 建路由时上游目标支持复选框批量勾选，可搜索过滤、全选 / 全不选 / 反选 |
| 三级容错 | DB 冷却 + 内存熔断 + 频道冻结，401/403/410 自动禁用 |
| 空流保护 | 上游返回 200 却迟迟不出字 → 判失败并切换下一个 |
| Base URL 智能归一化 | 末尾带不带版本段都行（`https://api.openai.com` 与 `https://api.siliconflow.cn/v1` 均可） |
| **同目标原地重试** | 上游返回 5xx / 超时等可重试状态码时，对同一目标原地重试若干次（次数与间隔可配），仍失败才切换下一个 |
| **统计页** | 今日调用 / Token 概览，全年热力图与近 30 天趋势，可按请求数或 Token、按提供商或模型切换 |
| 管理页 | 仪表盘 / 频道 / 模型池 / 令牌 / 日志 / 统计 / 设置 |
| 令牌管理 | 生成 Access Key，列表可直接一键复制完整 Key |
| 开机启动 | 设置页一键开关；开机后静默进托盘，不弹窗口 |
| Web Admin | 同一地址用浏览器也能管理 |

**相比同类工具的一处设计差异**：配置为单文件 `config.json` 原地写回 + 有上限的追加式日志，**没有整库备份机制**，不会跑着跑着堆出几十 GB 的备份目录。

---

## 快速开始

```bash
npm install          # 安装依赖（会拉 Electron 桌面运行时）
npm start            # 启动桌面应用
```

其他方式：

```bash
npm run dev          # 仅前端开发服务器（热更新）
npm run backend      # 仅启动后端（headless），浏览器开 http://127.0.0.1:8787 即 Web Admin
npm run build        # 构建前端到 dist/
npm run test         # 端到端验证（mock 上游，无需任何真实 Key）
npm run dist         # 打包 NSIS 安装包
```

> 若 `npm install` 报找不到 `@esbuild/win32-x64` / `@rollup/rollup-win32-x64-msvc` 等可选原生包，补装即可：
> `npm install @esbuild/win32-x64 @rollup/rollup-win32-x64-msvc`

---

## 怎么用

1. **加频道**：「频道」页 → 新建，填上游 Base URL + API Key，选协议。
   拉模型时 Base URL 带不带 `/v1` 都行，程序会自动归一化。
2. **加模型**：在频道点「编辑 / 拉模型」→ 拉取上游模型列表 → **勾选**要加入模型池的（支持全选 / 只选未加入）。
3. **建路由（可选）**：「模型池」页 → 「路由规则（虚拟模型）」→ 新建。
   - 客户端模型名：如 `auto`、`local`、`fast`
   - 策略：故障转移（按顺序依次尝试）/ 轮询（轮流分配）/ 加权（按权重随机）
   - 上游目标：**多选勾选**要参与的上游模型，可搜索、可全选；加权策略下可逐个填权重
4. **指给工具**：把 AI 工具的 Base URL 指向 `http://127.0.0.1:9090/v1`（端口可在设置改）。

```bash
curl http://127.0.0.1:9090/v1/chat/completions \
  -H "Authorization: Bearer <你的访问密钥>" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","stream":true,"messages":[{"role":"user","content":"你好"}]}'
```

`model` 填路由名即按该路由策略走；填模型池里的模型名则精确匹配并自动故障转移。

5. **开机启动（可选）**：「设置」页打开「开机启动」开关，开机后自动静默运行，只在托盘显示图标。
   需要打开界面时，左键单击托盘图标，或右键 →「打开玄枢」。

---

## 数据目录

- 桌面端：`%APPDATA%\ai-gateway\ai-gateway-data\`（该路径已显式固定，与显示名解耦，改名不丢数据）
- headless：项目下 `data/`，或用环境变量 `AI_GATEWAY_DATA_DIR` 指定

---

## 目录结构

```
├── electron/
│   ├── main.js            # 主进程：窗口 / 托盘 / 开机启动 / 启动后端
│   ├── preload.cjs        # 渲染进程安全桥（窗口按钮 / 开机启动）
│   └── backend/           # 纯 Node 后端（无原生依赖）
│       ├── index.js       # 装配并启动两个端口
│       ├── proxy.js       # 代理服务器：路由 / 容错 / 重试 / 流式 / 空流保护
│       ├── protocols.js   # 五协议请求构造与响应回流
│       ├── router.js      # 模型池 / 分组 / AUTO / 路由规则解析
│       ├── resilience.js  # 三级容错
│       ├── store.js       # 配置存储（JSON 原地写回）
│       ├── logstore.js    # 有上限的滚动日志 + 统计聚合（今日 / 热力图 / 趋势）
│       ├── adminApi.js    # REST 管理 API + Web Admin 静态托管
│       ├── channels.js    # 探测 / 拉模型
│       └── tokens.js      # Web Admin 登录会话
├── src/                   # React 前端
├── assets/
│   ├── gen-icon.mjs       # 纯 Node 生成多尺寸 ICO（DIB 条目）+ PNG 预览
│   ├── icon.ico           # 应用图标
│   └── tray.png           # 托盘图标
├── build/installer.nsh    # NSIS 自定义脚本（给快捷方式指定图标）
├── test/run.mjs           # 端到端验证
└── package.json
```

---

## 已知限制

- Responses 层、Claude/Gemini 的**工具调用（function calling）**为文本/流式子集，复杂 `tool_use` 仍需打磨。
- 「最快优先」排序依赖历史速度数据，当前等价于自定义优先级。
- 仅面向个人本机网关，未内置多租户鉴权；若要暴露到公网，请自行加反向代理 + TLS。

---

## 许可证

MIT
