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

此外还有:Effort 五档调节、四档权限模式、工具调用的逐次批准、斜杠命令面板、
会话重命名 / 打标签 / 分支 / 删除、额度与上下文占用,
以及一份可复现的版式验收(`npm run measure`)。

---

## 环境要求

- Windows 10 / 11
- Node.js ≥ 20
- **Claude Code** —— 不用另外装。Agent SDK 把版本配套的 `claude` 可执行文件
  作为可选依赖一起装了,安装包也把它一并带上(这也是安装包 150 MB 出头的原因)。
  版本必须与 SDK 对齐,所以宁可随包分发,也不去赌本机全局装的是哪个版本。
  只有在这份配套文件缺失时,才回退去找 PATH 上的 `claude`,并在引导页提供一键安装。

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

五层。前两层不产生 API 调用,后三层会。

**单元测试** —— 纯函数,不花钱,已进 CI:

```bash
npm run unit
```

覆盖路径截断规则、相对时间、以及四种工具行的归一化(含畸形输入的降级)。

**版式验收** —— 按设计终稿 §08 逐条量尺寸与三档宽度:

```bash
npm run measure
```

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

覆盖 contextBridge 桥接、旧版配置迁移、发消息后回复出现在界面、下拉切换模型后
历史不丢、新会话进入侧边栏、点回旧会话载入其历史、Bash 工具行与其输出展开。
使用独立的 `--user-data-dir`,不会读写你真实的 ClaudeDeck 配置。

**打包版冒烟** —— 驱动 `release/win-unpacked/` 里那个真正的 exe:

```bash
npm run dist && npm run packaged
```

上面四层跑的都是开发构建,`node_modules` 摊在磁盘上。打包后它被压进
`app.asar`,**asar 里的可执行文件是 spawn 不起来的** —— 这一整类
「dev 好好的、装完打不开」的毛病,前四层一条都照不到。这一层专门堵它:
起窗口、发一条消息、确认真有回复、确认没有报错条。

## 打包安装程序

```bash
npm run dist
```

产物在 `release/`,为 NSIS 安装包。打完包请顺手跑一次 `npm run packaged` ——
交出去之前,至少让那个 exe 自己说过一句话。

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
  main/                 主进程:窗口、IPC、SDK 会话、凭据、环境检测
    index.ts              入口与全部 IPC 处理
    chat.ts               ChatSession —— 流式输入模式下的一次对话
    config.ts             偏好与 safeStorage 凭据(含旧结构迁移)
    doctor.ts             Claude Code CLI 检测与安装
    binary.ts             定位随包分发的 claude 可执行文件(打包后不能走 asar)
    tools.ts              把 SDK 的工具调用归一化成界面能画的行
  preload/              contextBridge 白名单 API
  renderer/src/
    App.tsx               四屏路由与主界面
    screens/              加载 / 首次配置 / 选择项目
    components/           侧栏、消息、工具行
    lib/                  路径截断、相对时间等纯函数
    styles.css            设计 token(第 01 节)
    layout.css            骨架样式,只引用 token
    fonts.css + fonts/    本地打包的字体与许可证
  shared/               主进程与渲染层共用的类型
scripts/                unit / contrast / measure / smoke / e2e / packaged
docs/
  DESIGN-SPEC.md          界面规格(给 Claude Design 的输入)
  IMPLEMENTATION-BRIEF.md 实施说明(设计终稿的工程对照)
```

## 现状与路线图

项目仍在持续迭代,当前可用的能力见 [CHANGELOG](CHANGELOG.md)。

**接下来打算做的:**

- 跨会话搜索
- 应用图标 —— 目前还是 Electron 的默认图标

**已经打通的(此前一度以为做不到):**「Claude 反问你」与计划卡都能正常触发和作答,
并有端到端测试守着。此前我把它们接在 `onUserDialog` 上,那条通道在 SDK 会话里
不会响;实际走的是 `canUseTool`。原委记在 [CLAUDE.md](CLAUDE.md)。

## 文档

- [界面规格](docs/DESIGN-SPEC.md) —— 界面的结构、状态与文案
- [实施说明](docs/IMPLEMENTATION-BRIEF.md) —— 设计与工程的对照、接口清单与五个坑
- [CLAUDE.md](CLAUDE.md) —— 给 AI 协作者的约束与已知边界
- [更新日志](CHANGELOG.md)

## 参与

欢迎提 issue 反馈问题。提 PR 前请确保:

```bash
npm run typecheck && npm run unit && npm run build
```

`smoke` 与 `e2e` 会产生真实 API 调用,不进 CI,按需本地跑。

## License

本项目以 [MIT](LICENSE) 发布。随包分发的第三方内容(字体等)见 [NOTICE](NOTICE.md)。
