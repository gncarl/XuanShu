# 玄枢 XuanShu v0.2.2 · GitHub 发布说明（待发布）

> 本轮**只打包并备好文字**，代码与标签**先不推送**。等你方便时，按「发布步骤」一节操作即可。

## 本版本一句话

修复长任务 / 推理模型「链接中断」：把写死的上游 60 秒空闲杀手改成可配置长超时（默认 10 分钟），放宽首 token 等待（8s → 60s），并新增 AUTO 负缓存避免反复尝试不存在的模型。

## Release 页面填写（GitHub → Releases → Draft a new release）

| 字段 | 填法 |
|---|---|
| **Tag** | 输入框直接敲 `v0.2.2`（发布时自动创建；或本地 `git tag -a v0.2.2` 后随 push 带上去） |
| **Target** | `master`（保持默认） |
| **Release title** | `玄枢 XuanShu v0.2.2` |
| **Release notes** | 复制下方「Release notes 可直接粘贴」块 |
| **附件** | 把 `release/` 目录下的那个 `.exe` 拖进 **Attach binaries / 拖放文件** 区域 |

> 不要把 `CHANGELOG.md` 全文粘进 Release notes，只要下面的「Release notes 可直接粘贴」那段。

## Release notes 可直接粘贴

```markdown
### 修复
- **修复长任务 / 推理模型「链接中断」**：原代理写死上游空闲 60 秒即强制销毁连接，推理模型（o 系列 / Claude thinking / deepseek-reasoner 等）在长思考静默期常超 60 秒被腰斩，agent 侧表现为 connection reset / 链接中断。现改为可配置的空闲超时（默认 10 分钟，仅兜底僵尸连接）。
- **放宽首 token 等待**：空流保护阈值由 8 秒放宽至 60 秒，推理模型首 token 不再被误判无响应而腰斩。

### 优化
- **AUTO 负缓存**：AUTO 回退时若某 (频道, 模型) 返回「模型不存在」类 4xx（400/404/422 等，排除鉴权/额度/限流），自动短期（默认 10 分钟，可配置 `negativeCacheMs`）跳过该候选，不再每次请求都把每个组合试一遍，显著降低无效请求数与回退延迟。

### 说明
- 若你已安装 0.2.1 并遇到「链接中断 / connection reset」，请直接覆盖安装 0.2.2，配置与数据不受影响（数据仍在 `%APPDATA%\ai-gateway\ai-gateway-data\`）。
- 本版本同时包含 0.2.1 的全部内容（统计页、开机启动、接口重试、设置页重做、移除连接器、白屏修复）。
- 本版为 0.2.2 的**增量更新，版本号不变**（仍为 0.2.2）；安装包已重新生成，覆盖旧 0.2.2 即可获得负缓存。
```

## 发布步骤（方便时再执行）

```bash
cd /d/LLMrouter/ai-gateway

# 1) 暂存本次改动（代码 + 文档）
git add -A

# 2) 提交
git commit -m "玄枢 XuanShu v0.2.2：修复长任务/推理模型链接中断"

# 3) 打标签并推送（代码 + 标签）
git tag -a v0.2.2 -m "玄枢 XuanShu v0.2.2"
git push origin master
git push origin v0.2.2

# 4) 去 https://github.com/gncarl/XuanShu/releases/new
#    - 选/填 Tag v0.2.2，Title 填「玄枢 XuanShu v0.2.2」
#    - Release notes 粘贴上面那段
#    - 把 release/ 下的 .exe 拖进附件区
#    - 点 Publish release
```

## 注意事项

- **84MB 安装包不入库**，走 Releases 附件。不要 `git add` 这个 exe（`.gitignore` 已忽略 `release/`）。
- 发布前务必确认第 1~3 步已成功（代码与标签先推上去），再在网页发 Release。
- 实际安装包文件名以 `release/` 目录下为准（如 `玄枢 Setup 0.2.2.exe`），拖附件时认那个文件。
- DNS 解析失败（多域名同一时刻 `ENOTFOUND`）属于本机网络/代理问题，非玄枢代码缺陷；若仍频繁中断，请检查 API Switch / v2rayN 的 DNS 拦截与系统 DNS 设置。
