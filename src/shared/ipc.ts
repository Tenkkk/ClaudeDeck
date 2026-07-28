/**
 * Types shared between the main process and the renderer.
 *
 * The renderer never imports the Claude Agent SDK directly — the SDK spawns and
 * talks to the Claude Code executable, which is a Node-side concern. Everything
 * crosses the process boundary as the plain structures declared here.
 */

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * The SDK's PermissionMode union also contains 'dontAsk' and 'auto'. ClaudeDeck
 * surfaces only the four modes Claude Code itself presents in its UI.
 */
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

/**
 * 主题 · §16。开关挂在侧栏底部的版本行上 —— 规格只有四屏,
 * 为一个三选一再造一屏不值得,而版本号本来就是「关于这个软件」的天然入口。
 */
export type ThemePref = 'system' | 'light' | 'dark'

export const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '始终亮色' },
  { value: 'dark', label: '始终深色' },
]

/**
 * 五个固定停靠点,不是连续滑块。控件条上只显示一个字,弹层里是
 * 「更快 ←→ 更聪明」的停靠式滑轨(设计终稿 §07 / §08)。
 */
export const EFFORT_LEVELS: { value: EffortLevel; label: string }[] = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '很高' },
  { value: 'max', label: '最大' },
]

export const PERMISSION_MODES: { value: PermissionMode; label: string; hint: string }[] = [
  { value: 'default', label: '询问', hint: '每次写入或执行前请求批准' },
  { value: 'acceptEdits', label: '自动接受编辑', hint: '文件编辑免批准,命令仍需批准' },
  { value: 'plan', label: '计划模式', hint: '只读分析,不做任何改动' },
  { value: 'bypassPermissions', label: '完全放行', hint: '不再询问,谨慎使用' },
]

/** Result of the first-run environment check. */
export interface DoctorReport {
  cliFound: boolean
  cliVersion?: string
  cliError?: string
  credentialsConfigured: boolean
}

/**
 * A project is a working directory. Claude Code scopes sessions by directory,
 * so the sidebar's two-level grouping is projects → their sessions.
 */
export interface Project {
  path: string
  /** Display name — the last path segment, unless the user renames it. */
  name: string
  collapsed: boolean
}

/** Non-secret app preferences. The API key is never included. */
export interface AppConfig {
  baseUrl: string
  hasApiKey: boolean
  projects: Project[]
  activeWorkspace: string | null
  model: string | null
  effort: EffortLevel
  permissionMode: PermissionMode
  theme: ThemePref
}

/**
 * Quota and spend. The rate-limit half comes from an API whose own name says
 * DO_NOT_RELY_ON_THIS_API_YET, and API-key / Bedrock / Vertex sessions get
 * `available: false`. When it is false the whole quota block disappears from
 * the UI — no empty slot, no "unknown", and above all no possibly-wrong number.
 */
export interface UsageInfo {
  available: boolean
  subscriptionType: string | null
  fiveHour: number | null
  sevenDay: number | null
  sevenDayOpus: number | null
  fiveHourResetsAt: string | null
  sevenDayResetsAt: string | null
  sessionCostUsd: number
}

/** Context window pressure. Over 80% is the only warning before auto-compaction. */
export interface ContextUsage {
  percentage: number
  totalTokens: number
  maxTokens: number
}

export interface Versions {
  app: string
  cli: string | null
}

/**
 * MCP 服务发起的表单请求(§14)。
 *
 * `schema` 是标准 JSON Schema,所以可以写通用渲染器 —— 这一点和 dialog 的
 * payload 不同,后者按 kind 各自定义、协议层只当不透明对象转发,写不出万能渲染器。
 *
 * 头部必须写清是哪个 MCP 服务在要:说话的不是 Claude,是外部服务。
 */
export interface ElicitationField {
  key: string
  label: string
  description?: string
  required: boolean
  /** enum → 分段(超过 5 项转竖排单选)· boolean → 勾选 · number → 数字框 · string → 输入框 */
  kind: 'enum' | 'boolean' | 'number' | 'string'
  options?: string[]
  unit?: string
  default?: string | number | boolean
}

export interface ElicitationCard {
  id: string
  serverName: string
  message: string
  mode: 'form' | 'url'
  url?: string
  fields: ElicitationField[]
}

/**
 * 收到一个这个版本还不会画的 dialogKind 时的低调提示(§06 兜底)。
 * 已按 CLI 的默认处理继续 —— 我们回的是 cancelled,绝不瞎猜 payload 硬画一个框。
 */
export interface UnknownDialogNotice {
  dialogKind: string
}

/**
 * Claude 反问你 —— 设计终稿 §13,对应 dialogKind `permission_ask_user_question`。
 *
 * ⚠️ 未经端到端验证。`AskUserQuestion` 工具在当前的 SDK 会话里不上场
 * (见 CLAUDE.md),所以这条通道永远不会响。字段形状取自 CLI 二进制里
 * 那份 payload 校验器,不是猜的;但没有真数据跑过。
 * 只在真收到 dialog 时才渲染,因此对现有行为零影响。
 */
export interface AskOption {
  label: string
  description: string
  preview?: string
}

export interface AskQuestion {
  question: string
  /** ≤12 字的短标签,既当进度也当左右键 */
  header: string
  options: AskOption[]
  multiSelect: boolean
}

export interface AskCard {
  id: string
  questions: AskQuestion[]
}

/** 用户对一整套反问的作答。键是题干原文 —— 这是工具输出契约规定的。 */
export interface AskAnswer {
  /** 题干 → 选中的标签;多选用逗号分隔 */
  answers: Record<string, string>
  /** 一道都不选,直接说一段话 */
  response?: string
  /** 每题的补充说明 */
  notes?: Record<string, string>
}

/**
 * 计划卡 —— 设计终稿 §06,对应 dialogKind `permission_exit_plan_mode_v2`。
 * 同样未经端到端验证,原因同上。
 *
 * 沙绿左条,和权限卡的陶土左条区分:一个在拦你,一个在等你满意。
 */
export interface PlanCard {
  id: string
  plan: string
}

/**
 * 斜杠命令。source 不是 SDK 给的 —— SlashCommand 没有来源字段,
 * 是主进程查项目的 .claude/commands 与 .claude/skills 标出来的(§15)。
 */
export interface SlashCommandItem {
  name: string
  description: string
  argumentHint: string
  aliases?: string[]
  source: 'builtin' | 'project' | 'skill'
}

/**
 * `.claude` 配置栏里的一项 · §10。范围只到项目的 .claude/ 和根的 CLAUDE.md。
 */
export interface ClaudeEntry {
  /** 相对项目根的路径,正斜杠 */
  path: string
  name: string
  kind: 'dir' | 'file'
  size?: number
  count?: number
  /** 项目根的 CLAUDE.md,不在 .claude/ 里但归这一栏管 */
  atRoot?: boolean
}

export type SaveResult =
  | { ok: true }
  | { ok: false; reason: 'out-of-scope' }
  | { ok: false; reason: 'invalid-json'; line: number; message: string }
  | { ok: false; reason: 'write-failed'; message: string }

export interface ModelOption {
  value: string
  displayName: string
  description?: string
}

/** One row in the session list, sourced from the SDK's own session store. */
export interface SessionListItem {
  sessionId: string
  title: string
  preview: string
  lastModified: number
  gitBranch?: string
  /** 一个会话一个标签(tagSession 收单值,传 null 即清除)。 */
  tag?: string
}

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** Raw patch lines, each still carrying its leading '+', '-' or ' '. */
  lines: string[]
}

export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/**
 * A tool call, already normalised for display.
 *
 * The SDK's tool inputs and outputs are shaped per tool; flattening them here
 * in the main process keeps that knowledge in one place and lets the renderer
 * render rows without knowing anything about the SDK.
 */
export type ToolRow =
  | { id: string; tool: 'read'; path: string }
  | {
      id: string
      tool: 'bash'
      command: string
      description?: string
      stdout?: string
      stderr?: string
      interrupted?: boolean
    }
  | { id: string; tool: 'edit'; path: string; added: number; removed: number; hunks: DiffHunk[] }
  | { id: string; tool: 'todo'; todos: TodoItem[] }
  | { id: string; tool: 'other'; name: string }

/**
 * One entry in the transcript, in the order it happened.
 *
 * `ts` drives the timestamp in the hover action row — shown on hover only, so
 * the transcript stays quiet until you reach for something.
 */
export type TranscriptItem =
  | { kind: 'user'; text: string; ts?: number }
  | { kind: 'assistant'; text: string; ts?: number }
  | { kind: 'tool'; row: ToolRow }

/** Streamed from main to renderer over the `chat:event` channel. */
export type ChatEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'delta'; text: string }
  /** A tool call started. Carries everything known at request time. */
  | { type: 'tool'; row: ToolRow }
  /** The same row again once its result arrived — replace by `row.id`. */
  | { type: 'toolUpdate'; row: ToolRow }
  /** `target` 是这次调用最该被看见的那个参数(文件路径 / 命令),已在主进程取好。 */
  | { type: 'permission'; requestId: string; toolName: string; target?: string }
  /** MCP 服务要你填一张表 · §14 */
  | { type: 'elicitation'; card: ElicitationCard }
  /** Claude 反问你 · §13 */
  | { type: 'ask'; card: AskCard }
  /** Claude 提交计划请你点头 · §06 */
  | { type: 'plan'; card: PlanCard }
  /** 收到不会画的 dialogKind,已回 cancelled · §06 兜底 */
  | { type: 'unknownDialog'; notice: UnknownDialogNotice }
  | { type: 'done' }
  | { type: 'error'; message: string }

export interface PermissionReply {
  requestId: string
  allow: boolean
}
