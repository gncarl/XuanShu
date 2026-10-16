# 玄枢 XuanShu v0.2.4 · GitHub 发布说明

> 本版本完成 0.2.4 全部三项待办：模型属性小标签、仪表盘「当日优先 + 时间段切换」Token 统计、模型名手动输入加入。

## 本版本一句话

拉模型时每个模型都带属性小标签（能力 + 上下文大小，可手动修正）；仪表盘第一屏看今日 Token 调用、下方可切换当日/近 7 天/近 15 天/近 30 天/自定义区间；上游列表拉不到的模型（如 glm-4-flash）支持手动输入名字回车加入。

## Release 页面填写（GitHub → Releases → Draft a new release）

| 字段 | 填法 |
|---|---|
| **Tag** | 输入框直接敲 `v0.2.4` |
| **Target** | `master` |
| **Release title** | `玄枢 XuanShu v0.2.4` |
| **Release notes** | 复制下方「Release notes 可直接粘贴」块 |
| **附件** | 把 `release/` 目录下的 `玄枢 Setup 0.2.4.exe` 拖进 **Attach binaries / 拖放文件** 区域 |

> 不要把 `CHANGELOG.md` 全文粘进 Release notes，只要下面的「Release notes 可直接粘贴」那段。

## Release notes 可直接粘贴

```markdown
### 新增
- **模型属性小标签**：拉模型结果与「模型池」表格为每个模型展示属性 chip——能力（文本 / 工具 / 视觉 / 推理 / 文生图 / 视频 / 音频 / 免费）+ 上下文窗口（如 128K）。多数上游 /v1/models 不返回能力与上下文，玄枢采用三路合并：本地能力注册表（覆盖 GLM / GPT / Claude / Qwen / DeepSeek / Kimi / Gemini 等常见家族）+ 上游扩展字段解析（context_length 等）+ 命名推断兜底（未命中的标「推测」）。模型池每行新增「属性」按钮，可手动修正并保存到本机配置（用户修正优先）。
- **手动输入模型名加入模型池**：频道弹窗模型区新增常驻输入框——上游 /v1/models 拉不到、拉取失败或返回 0 个时同样可用（如智谱 glm-4-flash 这类官方免费但未列出的模型）。支持逗号 / 空格分隔批量加入，Enter 即入列并默认勾选，手动项标「手动·未验证」。
- **仪表盘「当日优先 + 时间段切换」Token 统计**：第一屏展示今日请求 / 今日 Token / 今日成功率 / 今日失败（副标注累计值）；下方分段控件切换 当日 / 近 7 天 / 近 15 天 / 近 30 天 / 自定义区间，展示区间汇总与「每日 Token 柱状 + 每日请求数折线」组合图。

### 优化
- KPI 组件新增副标注；属性标签紧凑 chip 样式；手动加入输入框行内布局。
- 40 项自动化测试、类型检查、构建均通过。
```

## 发布步骤

```bash
cd /d/LLMrouter/ai-gateway

# 1) 暂存本次改动（代码 + 文档）
git add -A

# 2) 提交
git commit -m "玄枢 XuanShu v0.2.4：模型属性小标签 + 仪表盘时间段统计 + 手动加模型"

# 3) 打标签并推送（代码 + 标签）
git tag -a v0.2.4 -m "玄枢 XuanShu v0.2.4"
git push origin master
git push origin v0.2.4

# 4) 去 https://github.com/gncarl/XuanShu/releases/new
#    - 选/填 Tag v0.2.4，Title 填「玄枢 XuanShu v0.2.4」
#    - Release notes 粘贴上面那段
#    - 把 release/ 下的 玄枢 Setup 0.2.4.exe 拖进附件区
#    - 点 Publish release
```

## 注意事项

- **安装包不入库**，走 Releases 附件。`.gitignore` 已忽略 `release/`，不要 `git add` 这个 exe。
- 实际安装包文件名以 `release/` 目录下为准：`玄枢 Setup 0.2.4.exe`。
- 若 `npm run dist` 报 `app.asar 被占用`：先确认没有正在运行的玄枢实例（含从 `release/win-unpacked` 拉起的），或用临时输出目录法（electron-builder 配置 `directories.output` 改到新目录）绕过锁定。
- 发布前务必确认第 1~3 步已成功（代码与标签先推上去），再在网页发 Release。
