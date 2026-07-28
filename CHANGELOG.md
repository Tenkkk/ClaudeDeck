# 更新日志

本项目仍在持续迭代。版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 未发布

### 新增

- 会话右键菜单:重命名、打标签、从这条分支、在资源管理器中打开目录、删除
  (删除是真删 Claude Code 的会话记录,因此有二次确认)
- 斜杠命令面板:命令列表由 SDK 运行时提供,按「内置 / 项目命令 / Skill」分组
- MCP 服务的表单与授权卡(`onElicitation`),按 JSON Schema 通用渲染
- 对话区的四种工具行:Read / Bash / Edit(带 diff)/ TodoWrite
- 控件条三个弹层:权限四档、模型、努力程度五档停靠轨
- 侧栏按「项目 → 会话」两层分组,支持多个工作目录并列
- 额度与上下文占用、本会话花费、版本行
- 首次配置页:检测 Claude Code CLI、一键安装、凭据加密保存

### 已知限制

- `AskUserQuestion` 与 `ExitPlanMode` 不对 Agent SDK 会话开放,
  因此相关界面暂未实现;收到无法渲染的对话框时一律安全取消并提示。
  详见 [CLAUDE.md](CLAUDE.md)。
- 仅支持 Windows。
- 尚未实现:`.claude` 配置读写中栏、子进程面板、文件回退、深色主题、跨会话搜索。

## 0.1.0

首个可运行版本:通过 `@anthropic-ai/claude-agent-sdk` 驱动本机 Claude Code,
实现聊天、切换模型、会话列表三项基本能力,并打通 tag 触发的自动发布流程。
