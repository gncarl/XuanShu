# 玄枢 XuanShu v0.2.3 · GitHub 发布说明

> 本版本一次性完成全部待办（关于面板 + 配置导入导出），并顺带修复 US 频道「链接通但拉不到模型」假绿灯、把频道删除改为垃圾桶图标、打磨 UI 排版。

## 本版本一句话

关于面板（版本号 / GitHub 链接 / 检查更新）+ 配置导入导出（玄枢原生 + One API 兼容）；并修复中转站自定义转发密钥头缺失导致的「探测假绿灯、拉不到模型」。

## Release 页面填写（GitHub → Releases → Draft a new release）

| 字段 | 填法 |
|---|---|
| **Tag** | 输入框直接敲 `v0.2.3` |
| **Target** | `master` |
| **Release title** | `玄枢 XuanShu v0.2.3` |
| **Release notes** | 复制下方「Release notes 可直接粘贴」块 |
| **附件** | 把 `release/` 目录下的 `玄枢 Setup 0.2.3.exe` 拖进 **Attach binaries / 拖放文件** 区域 |

> 不要把 `CHANGELOG.md` 全文粘进 Release notes，只要下面的「Release notes 可直接粘贴」那段。

## Release notes 可直接粘贴

```markdown
### 新增
- **「关于」面板**：侧边栏新增「关于」入口，展示当前版本、GitHub 仓库主页与 Releases 链接（外部浏览器打开），并提供「检查更新」按钮（后端代理请求 GitHub 比对最新版本号）。
- **配置导入 / 导出**：设置页新增「导出配置」「导入配置」两张卡片。导出将频道（baseURL + API Key）、模型池、模型分组、令牌、路由规则全量打包为 JSON；导入支持玄枢原生格式与 **One API / New API 兼容格式**（自动识别），导入前自动备份 config.json。

### 修复
- **修复「链接通但拉不到模型」假绿灯**：部分中转站（如 Modal 中转 `api.us-west-2.modal.direct`）需要自定义转发密钥头（如 `x-forward-secret`），缺失时 `/v1/models` 返回 401。旧逻辑把 401/403 误判为「链接通」；现探测区分鉴权失败 / 版本段缺失 / 上游异常，频道支持配置「额外请求头」并透传到探测与拉模型，鉴权失败时弹窗内联展示完整上游错误，可直接补头重试。

### 优化
- 频道管理「删除」改为垃圾桶图标按钮（hover 变红，深色模式适配），全表统一。
- UI 排版打磨：协议徽标不折行；探测结果徽标与「探测」按钮同行；操作列改为行内布局；频道弹窗新增内联错误面板与「额外请求头」编辑器。
- 33 项自动化测试、类型检查、构建均通过。
```

## 发布步骤

```bash
cd /d/LLMrouter/ai-gateway

# 1) 暂存本次改动（代码 + 文档）
git add -A

# 2) 提交
git commit -m "玄枢 XuanShu v0.2.3：关于面板 + 配置导入导出 + 修复中转站探测假绿灯"

# 3) 打标签并推送（代码 + 标签）
git tag -a v0.2.3 -m "玄枢 XuanShu v0.2.3"
git push origin master
git push origin v0.2.3

# 4) 去 https://github.com/gncarl/XuanShu/releases/new
#    - 选/填 Tag v0.2.3，Title 填「玄枢 XuanShu v0.2.3」
#    - Release notes 粘贴上面那段
#    - 把 release/ 下的 玄枢 Setup 0.2.3.exe 拖进附件区
#    - 点 Publish release
```

## 注意事项

- **安装包不入库**，走 Releases 附件。`.gitignore` 已忽略 `release/`，不要 `git add` 这个 exe。
- 实际安装包文件名以 `release/` 目录下为准：`玄枢 Setup 0.2.3.exe`。
- 发布前务必确认第 1~3 步已成功（代码与标签先推上去），再在网页发 Release，避免重蹈 0.2.2「声称已发但无 Release 页」的覆辙。
- DNS 解析失败（多域名同一时刻 `ENOTFOUND`）属于本机网络/代理问题，非玄枢代码缺陷。
