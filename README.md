# ClaudeDeck

把命令行工具 **Claude Code** 封装成图形界面聊天软件的 Windows 桌面应用。

> **非官方项目。** ClaudeDeck 由个人开发,与 Anthropic 无隶属、赞助或背书关系。
> Claude 与 Claude Code 是 Anthropic 的商标,此处仅作描述性使用。

---

## 功能

| | |
|---|---|
| **聊天** | 在窗口里直接和 Claude Code 对话,回复逐字流式呈现 |
| **切换模型** | 模型列表在运行时向 SDK 查询,会话进行中可随时切换,历史不中断 |
| **会话列表** | 左侧按「项目 → 会话」两层列出多个工作目录下的历史会话,点击即可回到任意一次对话(跨项目会隐式切换工作目录) |

附带(超出题目要求):Effort 五档调节、四档权限模式、工具调用的逐次批准、
额度与上下文占用、以及一份可复现的版式验收(`npm run measure`)。

---

## 环境要求

- Windows 10 / 11
- Node.js ≥ 20
- **Claude Code CLI** —— 应用启动时会自动检测,缺失时提供一键安装

登录方式二选一:

1. 已在终端里 `claude` 登录过 —— 直接沿用,无需配置
2. 使用 API Key / 中转端点 —— 在首次配置页填写 `ANTHROPIC_BASE_URL` 和 API Key,
   Key 通过 Electron `safeStorage`(Windows DPAPI)加密后落盘,不存明文

---

## 本地运行

```bash
npm install
npm run dev
```

> **国内网络补充。** `npm install` 只装 Electron 的壳包,真正的二进制由
> postinstall 从 GitHub 下载,在国内常常静默失败,表现为启动时报
> `Error: Electron uninstall`。补下载:
>
> ```bash
> ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node node_modules/electron/install.js
> ```
>
> 镜像**没有**写进仓库的 `.npmrc`:CI 构建的是用户会下载安装的产物,
> 那条链路应当只从官方源取二进制。

## 测试

两个层次,都会产生少量真实 API 调用。

**冒烟测试** —— 验 SDK 那一层,不走 UI:

```bash
npm run smoke
```

覆盖流式聊天、会话中途 `setModel`、`listSessions` / `getSessionMessages`,
以及 `resume` 后不分叉出新 session id。

**端到端测试** —— 用 Playwright 驱动真实 Electron 窗口:

```bash
npm run e2e
```

覆盖 contextBridge 桥接、发消息后回复出现在界面、下拉切换模型后历史不丢、
新会话进入侧边栏、点回旧会话载入其历史。使用独立的 `--user-data-dir`,
不会读写你真实的 ClaudeDeck 配置。

## 打包安装程序

```bash
npm run dist
```

产物在 `release/`,为 NSIS 安装包。

## 发布

推一个 `v*` 标签即触发 CI 构建并创建 GitHub Release:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

---

## 架构

```
┌─────────────────────────────────────────────────┐
│ Renderer (React)   contextIsolation: true       │
│   界面 / 状态 / 流式渲染                          │
└──────────────────┬──────────────────────────────┘
                   │ contextBridge 暴露的白名单 API
┌──────────────────┴──────────────────────────────┐
│ Preload                                         │
└──────────────────┬──────────────────────────────┘
                   │ IPC
┌──────────────────┴──────────────────────────────┐
│ Main (Node)                                     │
│   @anthropic-ai/claude-agent-sdk                │
│   凭据(safeStorage) / 环境检测 / 会话管理        │
└──────────────────┬──────────────────────────────┘
                   │ SDK 拉起
┌──────────────────┴──────────────────────────────┐
│ Claude Code CLI                                 │
└─────────────────────────────────────────────────┘
```

**会话不做本地副本。** SDK 自带 `listSessions` / `getSessionMessages` /
`renameSession` / `deleteSession`,其 session store 即单一事实来源,
应用只保存自己的偏好:项目清单(路径/显示名/折叠状态)、模型、Effort、权限档、凭据。

## 文件结构

```
src/
  main/       主进程:窗口、IPC、SDK 会话、凭据、环境检测
    index.ts    入口与全部 IPC 处理
    chat.ts     ChatSession —— 流式输入模式下的一次对话
    config.ts   偏好与 safeStorage 凭据
    doctor.ts   Claude Code CLI 检测与安装
  preload/    contextBridge 白名单 API
  renderer/   React 界面
  shared/     主进程与渲染层共用的类型
docs/
  DESIGN-SPEC.md   界面规格(Claude Design 的输入)
```

## 文档

- [界面规格](docs/DESIGN-SPEC.md)

## License

MIT
