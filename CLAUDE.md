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

## SDK 会话里拿不到的东西(实测,别再试)

`AskUserQuestion` 与 `ExitPlanMode` **不对 Agent SDK 会话开放**。三条证据:

1. Claude 自报可用工具列表里没有
2. 写进 `options.tools` 也不暴露
3. 直接调用返回 `ExitPlanMode exists but is not enabled in this context`

所以设计终稿 §13(AskUserQuestion 全套)和 §06 的计划卡**做不出来**。
类型在 `sdk-tools.d.ts` 里,但工具不开放。等 SDK 放开再说。

`askUserQuestionTimeout` 属于 `Settings`(`.claude/settings.json`),
不是 `Options` —— 写进 query options 编译不过。

## 宿主回调只有三个

| 回调 | 管什么 | 契约 |
|---|---|---|
| `canUseTool` | 工具批准 | 类型完整 |
| `onElicitation` | MCP 服务要你填表 | `requestedSchema` 是标准 JSON Schema,**可以写通用渲染器** |
| `onUserDialog` | 各类选择框 | `payload` 是 `Record<string, unknown>`,**按 kind 各自定义,写不出通用渲染器** |

`dialogKind` 是开放字符串。从 CLI 二进制里取到的完整注册表(备查,不要据此
硬画 payload):

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
