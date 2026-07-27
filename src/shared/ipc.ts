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

export const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

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
}

export interface HistoryMessage {
  role: 'user' | 'assistant'
  text: string
}

/** Streamed from main to renderer over the `chat:event` channel. */
export type ChatEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'permission'; requestId: string; toolName: string; input: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string }

export interface PermissionReply {
  requestId: string
  allow: boolean
}
