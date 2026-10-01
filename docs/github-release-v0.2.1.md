# GitHub 版本更新推送说明 · v0.2.1

> 一次性操作手册。照顺序做完即可。涉及命令均为 Git Bash 语法。
> 仓库：`git@github.com:gncarl/XuanShu.git`（分支 `master`）

---

## 一、本次要发布什么

| 项目 | 内容 |
| --- | --- |
| 版本号 | `0.1.6` → `0.2.1`（`package.json` 已改好） |
| 安装包 | `D:\LLMrouter\ai-gateway\release\玄枢 Setup 0.2.1.exe`（84,069,728 字节 ≈ 84 MB） |
| 改动规模 | 14 个文件，+637 / −129 行 |
| 是否含新依赖 | 无，未新增任何 npm 包 |

改动文件清单（全部已改好，无需再动）：

```
.gitignore                     # 补 release*/ 忽略规则
CHANGELOG.md                   # 新增（本次更新日志）
README.md                      # 同步：删连接器、补统计页/开机启动/接口重试
electron/main.js               # 托盘显示修复 + 开机启动 IPC
electron/preload.cjs           # 暴露 setAutoLaunch / getAutoLaunch
electron/backend/types.js      # 默认设置新增 autoLaunch / retry* 五项
electron/backend/proxy.js      # 同目标原地重试
electron/backend/logstore.js   # 统计聚合（今日/热力图/30天趋势）+ mtime 缓存
electron/backend/adminApi.js   # 删除 /api/connectors/:tool 路由
src/pages.tsx                  # 新增统计页、重做设置页、修首页模型分布
src/components.tsx             # 侧边栏改统计 + ErrorBoundary
src/App.tsx                    # 路由调整 + ?page= 直达 + ErrorBoundary 包裹
src/api.ts                     # 删除 connector()
src/types.ts                   # Settings 增补字段
src/index.css                  # 设置行式布局 + 统计页样式
```

---

## 二、为什么安装包不入库

`release/`、`release020/`、`release021/` 均已在 `.gitignore` 中忽略。
84 MB 的 exe 放进 Git 历史会让仓库永久膨胀且无法轻易回收，**必须走 GitHub Releases 上传**。

已确认忽略生效：

```
$ git check-ignore -v release020 release021
.gitignore:4:release*/	release020
.gitignore:4:release*/	release021
```

---

## 三、推送步骤

### 第 1 步：确认状态干净

```bash
cd /d/LLMrouter/ai-gateway
git status --short
```

预期输出只有 15 行 `M`（已修改）/ `A`（新增）条目，**不应出现 `release`**。
若有 `release` 相关条目，说明忽略规则没生效，先停下来检查 `.gitignore`。

### 第 2 步：暂存改动

```bash
git add .gitignore CHANGELOG.md README.md package.json \
        electron/ src/
```

### 第 3 步：提交

建议用这条信息（一次提交覆盖 0.2.0 + 0.2.1 的全部内容）：

```bash
git commit -m "玄枢 XuanShu v0.2.1：新增统计页与开机启动，修复托盘与白屏

新增
- 统计页：今日调用/Token 概览、全年热力图、近 30 天趋势，支持请求数/Token 与提供商/模型切换
- 开机启动：设置页开关，开机静默进托盘不弹窗
- 接口重试：可重试状态码、最大重试次数、重试间隔均可配置，优先对同一目标原地重试

变更与移除
- 设置页改为行式布局，所有项即时保存
- 移除连接器功能（前端组件 + /api/connectors/:tool 路由）
- 侧边栏连接器入口替换为统计

修复
- 托盘「打开玄枢」无响应：窗口为空时未重建窗口
- 安装后打开白屏：首页模型分布仍按旧结构渲染导致 React 抛错
- 新增 ErrorBoundary，单页异常不再整屏白屏"
```

> 想分两次提交也可以：先提交 0.2.0 的改动，再提交 0.2.1 的白屏修复。但分提交意义不大，
> 因为 0.2.0 从未发布过、也不会单独发版，合并成一次更清晰。

### 第 4 步：打标签

```bash
git tag -a v0.2.1 -m "玄枢 XuanShu v0.2.1"
```

### 第 5 步：推送提交与标签

```bash
git push origin master
git push origin v0.2.1
```

> 若只想推分支：`git push origin master --tags` 可一并推标签。

---

## 四、上传安装包到 Releases

1. 打开 https://github.com/gncarl/XuanShu/releases/new
2. **Choose a tag**：选 `v0.2.1`（上面已推）；**Release title**：`玄枢 XuanShu v0.2.1`
3. **Describe this release**：直接粘贴下面这段

```markdown
## 玄枢 XuanShu v0.2.1

### 新增
- **统计页**：今日调用次数 / Token 概览，全年热力图与近 30 天趋势，可按请求数或 Token、按提供商或模型切换
- **开机启动**：设置页一键开关，开机后静默进托盘、不弹窗口
- **接口重试**：可配置可重试状态码（默认 500,502,503,504）、最大重试次数（默认 3）、重试间隔（默认 2 秒）；优先对同一目标原地重试，仍失败才故障转移
- **设置页重做**：左标签右控件的行式布局，所有项即时保存

### 移除
- **移除连接器功能**：Claude Code / OpenCode / Codex / Zed 接入配置请按各工具文档手动填写 Base URL 与访问密钥
- 侧边栏「连接器」入口替换为「统计」

### 修复
- **托盘「打开玄枢」无响应**：窗口已关闭时托盘菜单点不开软件界面，现改为窗口不存在则重建
- **安装后打开白屏**：仪表盘「模型分布」沿用了旧数据结构导致 React 抛错，已修复
- 新增全局 `ErrorBoundary`，单个页面异常不再导致整屏白屏

### 说明
- 已安装 0.1.6 可直接覆盖安装，配置与数据不受影响（数据仍在 `%APPDATA%\ai-gateway\ai-gateway-data\`）
- 若你装过 0.2.0 并遇到白屏，请直接覆盖安装 0.2.1
```

4. **Attach binaries**：把 `D:\LLMrouter\ai-gateway\release\玄枢 Setup 0.2.1.exe` 拖进上传框
5. 确认不是 Draft、不是 Pre-release，点 **Publish release**

---

## 五、收尾（可选，但建议）

发布成功后，清掉这两个临时打包目录，省下约 330 MB：

```
D:\LLMrouter\ai-gateway\release020\
D:\LLMrouter\ai-gateway\release021\
```

它们是之前为了绕开删目录限制而另开的输出目录，功能已由 `release/` 取代，可以放心删。
`release\玄枢 Setup 0.2.1.exe` **不要删**，还要上传到 Releases。

---

## 六、此次未提交的内容说明

- `_shot_*.png` / `_ui*.png`：本地调试截图，已在 `.gitignore` 忽略。
- `build-front.log`、`build-step.log`：构建日志，`.gitignore` 已忽略 `*.log`。
- `dist/`、`build-out/`、`dist-0928/`、`dist-final/`、`installer-out/`：构建产物，均已忽略。
- `release/`：忽略，安装包走 Releases。
