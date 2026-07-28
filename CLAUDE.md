# ClaudeDeck — 给 AI 协作者的项目说明

## 这是什么

一个 Electron 桌面应用,通过 `@anthropic-ai/claude-agent-sdk` 把 Claude Code 封装成
图形界面聊天软件。仅支持 Windows。

## 硬性约束

1. **SDK 只能在主进程用。** 它会拉起 `claude` 可执行文件,是 Node 侧的事。
   渲染层永远通过 `preload` 暴露的白名单 API 访问,`contextIsolation` 保持开启。
2. **SDK 必须保持 external。** `electron.vite.config.ts` 里的 `externalizeDepsPlugin`
   不能去掉——打包进 bundle 会破坏它对 CLI 可执行文件的路径解析。
3. **始终使用流式输入模式**(`prompt` 传 AsyncIterable,不传 string)。
   `Query.setModel` / `setPermissionMode` / `interrupt` 和 `canUseTool` 回调
   只在这个模式下可用。
4. **用户输入必须打 `origin: { kind: 'human' }`。** 缺了它,SDK 在严格的
   `isHuman()` 信任门禁处会 fail closed。
5. **`resume` 时保持 `forkSession: false`。** 否则会分叉出新的 session id,
   侧边栏里用户点开的那一条就不再是继续增长的那一条。
6. **不要给会话做本地副本。** SDK 的 session store 是单一事实来源。
   本地只存偏好和加密后的凭据。会话按项目分组 = 对每个项目各调一次
   `listSessions({ dir })` 再合并,不要自己建索引。
7. **API Key 只走 `safeStorage`。** 任何时候都不要把明文 key 写进文件或日志,
   也不要经 IPC 传给渲染层。

## AskUserQuestion 与 ExitPlanMode:走 canUseTool,不走 onUserDialog

**已端到端验证。** 这两件事**不是 user dialog,是普通工具调用**:

```
canUseTool('AskUserQuestion', { questions: [...] })
  → { behavior:'allow', updatedInput: { ...input, answers } }
    answers 以**题干原文**为键(CLI 内部 reducer 就是 answers[questionText]),
    值是选项 label,多选可用数组或 ", " 分隔;label 必须与选项完全一致。
    带 answers 放行 → 模型收到 "The user answered: ..."
    不带 answers 直接放行 → "The user did not answer the questions."

canUseTool('ExitPlanMode', { plan, planFilePath })
  → allow 即批准计划;deny 的 message 会回到模型那里
```

**这两个分支必须排在 `alwaysAllow` 检查之前** ——「本次会话内不再问」说的是
权限,不能把一个提问也一并跳过。

### 我原先错在哪(值得记下来)

我一开始把它们接在 `onUserDialog` 上,依据是 CLI 二进制里确实注册了
`kind:"permission_ask_user_question"`。那个注册项是真的,但那条通道在 Agent SDK
会话里**不会响**:声明了 `supportedDialogKinds` 也照样只有 `canUseTool` 被调用。

于是我在文档里写下「接口不允许所以做不了」,后来改口成「我没找到那个开关」——
两句都不对。开关一直在,只是不在我找的那条路上。

**教训:二进制里的字符串只能证明「存在」,不能证明「会走到」。**
跑一次探针(建 query、发一句话、把回调收到的东西原样打出来)只要几分钟,
比读几百 KB 反编译产物准得多,也快得多。

`askUserQuestionTimeout` 属于 `Settings`(`.claude/settings.json`),
不是 `Options` —— 写进 query options 编译不过。

## 不是每条助手消息都走流式

正文平时靠 `stream_event` 的 `text_delta` 增量渲染。但**内置命令的回复不流式**:
`/mcp`、`/cost` 这类由 CLI 自己合成的回答,一次性整条作为 `assistant` 消息送达,
没有任何 `text_delta`。

只认增量的话,这些回复在界面上凭空消失 —— 表现就是「敲了命令什么也没发生」,
而且它安静得没有任何报错。`chat.ts` 里用 `streamedText` 标记本条消息有没有收到过
增量,没有就在收尾时把整条补画上。

## 宿主回调只有三个

| 回调 | 管什么 | 契约 |
|---|---|---|
| `canUseTool` | 工具批准 | 类型完整 |
| `onElicitation` | MCP 服务要你填表 | `requestedSchema` 是标准 JSON Schema,**可以写通用渲染器** |
| `onUserDialog` | 各类选择框 | `payload` 是 `Record<string, unknown>`,**按 kind 各自定义,写不出通用渲染器**。且 CLI 只发**声明过**的 kind,我们一个都没声明(`SUPPORTED_DIALOG_KINDS` 为空),所以这条实际不响 |

`dialogKind` 是开放字符串。从 CLI 二进制里取到的完整注册表 —— **仅供备查**:
里面带 `permission_` 前缀的那些看着很像我们要的东西,但实测它们在 SDK 会话里
不会发出来(见上一节)。不要据此硬画 payload,更不要据此断定某个功能做不了。

```
auto_mode_flagged_allow      permission_ask_user_question
auto_mode_setup_review       permission_bash
chrome_install_setup         permission_browser
chrome_install_upsell        permission_enter_plan_mode
computer_use_approval        permission_exit_plan_mode_v2
fable_overage_consent_prompt permission_file
it2_setup                    permission_monitor
mcp_url_elicitation          permission_powershell
refusal_fallback_prompt      permission_prompt
                             permission_skill
                             permission_webfetch
                             permission_workflow
```

**没有可验证契约的 kind 一律回 `{ behavior: 'cancelled' }`。**
猜错的选择会真的落到文件上。

## 选项切换的代价不对称

| 选项 | 方式 | 是否打断 |
|---|---|---|
| 模型 | `Query.setModel()` | 否 |
| 权限档 | `Query.setPermissionMode()` | 否 |
| Effort | 无 setter,需重开 query 并 `resume` | 会短暂重连 |

## 样式

`src/renderer/src/styles.css` 里的一切都是**占位**。真正的视觉来自 Organic
设计系统,经 Claude Design 出稿后整体替换。改样式前先看 `docs/DESIGN-SPEC.md`。

## 改依赖之后必须全量重装

**不要**用增量 `npm install <pkg>` 之后直接提交锁文件。electron-builder 有一批
平台相关的可选依赖(`@electron/windows-sign`、`postject`、`cross-dirname` 等),
增量安装和 `npm install --package-lock-only` 都不会把它们写进锁文件,
但 runner 上的 `npm ci` 会严格校验并因此失败(报 `EUSAGE ... Missing: ... from lock file`)。

只有**真实的全量安装**才会做平台求值、生成正确的锁文件:

```bash
rm -rf node_modules package-lock.json && npm install
```

这个坑已经让 CI 挂过两次。

## 提交前

```bash
npm run typecheck
npm run build
```

两条都必须干净。改动涉及功能链路时再跑 `npm run smoke` 和 `npm run e2e`
(会产生真实 API 调用,所以不进 CI)。
