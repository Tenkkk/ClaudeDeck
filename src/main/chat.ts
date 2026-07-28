import { query, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { resolveClaudeExecutable } from './binary.js'
import { credentialEnv } from './config.js'
import {
  askCardFromPayload,
  askResult,
  KIND_ASK,
  KIND_PLAN,
  planCardFromPayload,
  SUPPORTED_DIALOG_KINDS,
} from './dialogs.js'
import { coerceValues, fieldsFromSchema } from './elicit.js'
import { applyToolResult, rowFromToolUse } from './tools.js'
import type {
  AskAnswer,
  ChatEvent,
  ContextUsage,
  EffortLevel,
  ElicitationField,
  PermissionMode,
  ToolRow,
  UsageInfo,
} from '../shared/ipc.js'

/**
 * A push-driven AsyncIterable used as the SDK's `prompt`.
 *
 * Streaming input mode (prompt = AsyncIterable rather than a string) is what
 * unlocks Query.setModel/setPermissionMode/interrupt and the canUseTool
 * callback. A GUI needs all four, so ClaudeDeck always runs in this mode.
 */
class Inbox implements AsyncIterable<SDKUserMessage> {
  private buffer: SDKUserMessage[] = []
  private waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null
  private closed = false

  push(msg: SDKUserMessage): void {
    if (this.closed) return
    const w = this.waiting
    if (w) {
      this.waiting = null
      w({ value: msg, done: false })
    } else {
      this.buffer.push(msg)
    }
  }

  close(): void {
    this.closed = true
    const w = this.waiting
    if (w) {
      this.waiting = null
      w({ value: undefined as never, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const queued = this.buffer.shift()
        if (queued) return Promise.resolve({ value: queued, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          this.waiting = resolve
        })
      },
    }
  }
}

export interface StartOptions {
  cwd: string
  resume?: string
  model: string | null
  effort: EffortLevel
  permissionMode: PermissionMode
}

let permissionSeq = 0
let elicitSeq = 0
let dialogSeq = 0

/**
 * 权限卡上要显示的那个参数。工具不同,最该被看见的东西也不同:
 * 改文件看路径,跑命令看命令本身。取不到就不显示,不编。
 */
function permissionTarget(input: unknown): string | undefined {
  const arg = (input ?? {}) as Record<string, unknown>
  for (const key of ['file_path', 'command', 'path', 'url', 'pattern']) {
    const v = arg[key]
    if (typeof v === 'string' && v.trim()) return v
  }
  return undefined
}

/**
 * One live conversation. Wraps a single long-lived Query so that model and
 * permission-mode changes can be applied in place rather than by restarting.
 */
export class ChatSession {
  private inbox = new Inbox()
  private q: Query | null = null
  private pendingPermissions = new Map<string, (allow: boolean) => void>()
  /** tool_use_id → 已发出的行,结果回来时按 id 补全。 */
  private toolRows = new Map<string, ToolRow>()
  /** 勾过「本次会话内不再问」的工具名。换会话即失效。 */
  private alwaysAllow = new Set<string>()
  /** 后台任务第一次被看见的时刻 —— SDK 的推送里没有时间,只能自己记 */
  private taskSince = new Map<string, number>()
  /** 本轮累计的输出 token,每次 send 清零 */
  private outputTokens = 0
  private pendingAsks = new Map<string, (v: AskAnswer | null) => void>()
  private pendingPlans = new Map<string, (accepted: boolean) => void>()
  private pendingElicitations = new Map<
    string,
    {
      resolve: (v: Record<string, string | boolean> | null) => void
      fields: ElicitationField[]
    }
  >()

  sessionId: string | null = null

  constructor(private readonly emit: (event: ChatEvent) => void) {}

  start(opts: StartOptions): void {
    this.sessionId = opts.resume ?? null

    this.q = query({
      prompt: this.inbox,
      options: {
        cwd: opts.cwd,
        // 打包后必须显式指过去,否则 SDK 会去 asar 里启动那个 exe —— 起不来。
        // 开发时是 undefined,走 SDK 自己的解析。见 binary.ts。
        pathToClaudeCodeExecutable: resolveClaudeExecutable(),
        resume: opts.resume,
        // Resuming without forkSession continues the same session id, so the
        // sidebar entry the user clicked stays the entry that grows.
        forkSession: false,
        model: opts.model ?? undefined,
        effort: opts.effort,
        permissionMode: opts.permissionMode,
        includePartialMessages: true,
        // 注意:brief §6 把 askUserQuestionTimeout 也列进了这里,但它属于
        // Settings(.claude/settings.json),不是 Options —— 传进来编译不过。
        toolConfig: { askUserQuestion: { previewFormat: 'html' } },
        // 不开的话分支就无法回退文件(坑 4.2)
        enableFileCheckpointing: true,
        // 开了主对话会被子 Agent 的自言自语冲垮(坑 4.5)
        forwardSubagentText: false,
        env: { ...process.env, ...credentialEnv() } as Record<string, string>,

        // MCP 服务要你填表 · §14。requestedSchema 是标准 JSON Schema,
        // 所以这里能写通用渲染器。
        onElicitation: async (request) => {
          const id = `elicit-${++elicitSeq}`
          const fields = fieldsFromSchema(request.requestedSchema)
          const answer = await new Promise<Record<string, string | boolean> | null>((resolve) => {
            this.pendingElicitations.set(id, { resolve, fields })
            this.emit({
              type: 'elicitation',
              card: {
                id,
                serverName: request.displayName ?? request.serverName,
                message: request.message,
                mode: request.mode === 'url' ? 'url' : 'form',
                url: request.url,
                fields,
              },
            })
          })
          if (!answer) return { action: 'cancel' }
          return { action: 'accept', content: coerceValues(fields, answer) }
        },

        // 只声明我们真的会画的两种。没声明的 CLI 自己按默认处理,根本不问我们,
        // 界面上不会出现半张残废的卡(坑 4.3 的「正门」)。
        supportedDialogKinds: SUPPORTED_DIALOG_KINDS,

        onUserDialog: async (request) => {
          // Claude 反问你 · §13
          if (request.dialogKind === KIND_ASK) {
            const id = `ask-${++dialogSeq}`
            const card = askCardFromPayload(id, request.payload)
            if (card) {
              const answer = await new Promise<AskAnswer | null>((resolve) => {
                this.pendingAsks.set(id, resolve)
                this.emit({ type: 'ask', card })
              })
              return answer
                ? { behavior: 'completed', result: askResult(card, answer) }
                : { behavior: 'cancelled' }
            }
          }

          // 计划卡 · §06
          if (request.dialogKind === KIND_PLAN) {
            const id = `plan-${++dialogSeq}`
            const card = planCardFromPayload(id, request.payload)
            if (card) {
              const accepted = await new Promise<boolean>((resolve) => {
                this.pendingPlans.set(id, resolve)
                this.emit({ type: 'plan', card })
              })
              return accepted
                ? { behavior: 'completed', result: { behavior: 'allow' } }
                : { behavior: 'cancelled' }
            }
          }

          // 认不出形状(含未声明的 kind、以及声明了但 payload 变形的情况):
          // 一律安全取消,并在界面上低调说明是哪个 kind。
          // 宁可不画,也不猜着画一个框 —— 猜错的选择会真的落到文件上。
          this.emit({ type: 'unknownDialog', notice: { dialogKind: request.dialogKind } })
          return { behavior: 'cancelled' }
        },
        canUseTool: async (toolName, input) => {
          // 用户勾过「本次会话内不再问」的工具直接放行,不再打断
          if (this.alwaysAllow.has(toolName)) {
            return { behavior: 'allow' as const, updatedInput: input }
          }
          const requestId = `perm-${++permissionSeq}`
          const allowed = await new Promise<boolean>((resolve) => {
            this.pendingPermissions.set(requestId, resolve)
            this.emit({
              type: 'permission',
              requestId,
              toolName,
              target: permissionTarget(input),
            })
          })
          return allowed
            ? { behavior: 'allow' as const, updatedInput: input }
            : { behavior: 'deny' as const, message: '用户拒绝了此操作。' }
        },
      },
    })

    void this.pump()
  }

  private async pump(): Promise<void> {
    if (!this.q) return
    try {
      for await (const msg of this.q) {
        this.handle(msg)
      }
    } catch (err) {
      this.emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  private handle(msg: SDKMessage): void {
    // Every message carries the session id; capture it as soon as it appears so
    // a brand-new conversation can be written into the sidebar immediately.
    const withId = msg as { session_id?: string }
    if (withId.session_id && withId.session_id !== this.sessionId) {
      this.sessionId = withId.session_id
      this.emit({ type: 'session', sessionId: withId.session_id })
    }

    if (msg.type === 'stream_event') {
      const event = msg.event as {
        type?: string
        delta?: { type?: string; text?: string }
        usage?: { output_tokens?: number }
      }
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
        this.emit({ type: 'delta', text: event.delta.text })
      }
      // usage 只在每条助手消息收尾时出现一次。一轮里若有工具往返就会有多条
      // 助手消息,所以这里累加,而不是直接取最后一条的值。
      if (event.type === 'message_delta' && typeof event.usage?.output_tokens === 'number') {
        this.outputTokens += event.usage.output_tokens
        this.emit({ type: 'progress', outputTokens: this.outputTokens })
      }
      return
    }

    // SDK 报的「此刻在干什么」· §06 的等待态
    if (msg.type === 'system' && msg.subtype === 'status') {
      this.emit({ type: 'status', status: msg.status })
      return
    }

    if (msg.type === 'assistant') {
      for (const block of msg.message.content) {
        if (block.type === 'tool_use') {
          const row = rowFromToolUse(block.id, block.name, block.input)
          this.toolRows.set(block.id, row)
          this.emit({ type: 'tool', row })
        }
      }
      return
    }

    // 工具结果回来时是一条合成的 user 消息:content 里的 tool_result 块给出
    // 它对应哪次调用,tool_use_result 给出结构化输出。
    if (msg.type === 'user') {
      const content = msg.message.content
      if (!Array.isArray(content)) return
      for (const block of content) {
        if (block.type !== 'tool_result') continue
        const pending = this.toolRows.get(block.tool_use_id)
        if (!pending) continue
        const filled = applyToolResult(pending, msg.tool_use_result)
        this.toolRows.set(block.tool_use_id, filled)
        this.emit({ type: 'toolUpdate', row: filled })
      }
      return
    }

    // 后台任务清单变了 · §11
    if (msg.type === 'system' && msg.subtype === 'background_tasks_changed') {
      const now = Date.now()
      const tasks = msg.tasks.map((t) => {
        if (!this.taskSince.has(t.task_id)) this.taskSince.set(t.task_id, now)
        return {
          id: t.task_id,
          type: t.task_type,
          description: t.description,
          since: this.taskSince.get(t.task_id) ?? now,
        }
      })
      // 已经消失的任务不用再记时间
      const live = new Set(tasks.map((t) => t.id))
      for (const id of this.taskSince.keys()) if (!live.has(id)) this.taskSince.delete(id)
      this.emit({ type: 'tasks', tasks })
      return
    }

    if (msg.type === 'result') {
      this.emit({ type: 'done' })
    }
  }

  send(text: string): void {
    // 计数按「轮」清零 —— 状态行显示的是这一轮的产出,不是整个会话的累计
    this.outputTokens = 0
    this.inbox.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      // Required: the SDK fails closed at strict isHuman() gates when a host
      // wrapping keyboard input does not attribute the message explicitly.
      origin: { kind: 'human' },
    })
  }

  /**
   * `remember` 对应卡片右下角的「本次会话内不再问 X」。只在允许时有意义,
   * 且只作用于当前这个 ChatSession —— 换会话就重新问。
   */
  /** `answer` 为 null 表示用户放弃作答。 */
  answerAsk(id: string, answer: AskAnswer | null): void {
    const resolve = this.pendingAsks.get(id)
    if (!resolve) return
    this.pendingAsks.delete(id)
    resolve(answer)
  }

  answerPlan(id: string, accepted: boolean): void {
    const resolve = this.pendingPlans.get(id)
    if (!resolve) return
    this.pendingPlans.delete(id)
    resolve(accepted)
  }

  /** `values` 为 null 表示用户取消了这张表。 */
  answerElicitation(id: string, values: Record<string, string | boolean> | null): void {
    const pending = this.pendingElicitations.get(id)
    if (!pending) return
    this.pendingElicitations.delete(id)
    pending.resolve(values)
  }

  answerPermission(requestId: string, allow: boolean, remember = false, toolName?: string): void {
    const resolve = this.pendingPermissions.get(requestId)
    if (!resolve) return
    this.pendingPermissions.delete(requestId)
    if (allow && remember && toolName) this.alwaysAllow.add(toolName)
    resolve(allow)
  }

  async setModel(model: string): Promise<void> {
    await this.q?.setModel(model)
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await this.q?.setPermissionMode(mode)
  }

  async listCommands(): Promise<
    { name: string; description: string; argumentHint: string; aliases?: string[] }[]
  > {
    return (await this.q?.supportedCommands()) ?? []
  }

  async listModels(): Promise<{ value: string; displayName: string }[]> {
    const models = await this.q?.supportedModels()
    // description 是 CLI 里 /model 第二列那句话(「Opus 5 with 1M context ·
    // Best for everyday, complex tasks」),照搬,不自己编。
    return (models ?? []).map((m) => ({
      value: m.value,
      displayName: m.displayName,
      description: m.description,
      effortLevels: m.supportedEffortLevels,
    }))
  }

  /** Context window pressure. Over 80% is the only warning before compaction. */
  async contextUsage(): Promise<ContextUsage | null> {
    if (!this.q) return null
    try {
      const r = await this.q.getContextUsage()
      return {
        percentage: r.percentage,
        totalTokens: r.totalTokens,
        maxTokens: r.maxTokens,
      }
    } catch {
      return null
    }
  }

  /**
   * Quota and spend.
   *
   * The underlying method is named DO_NOT_RELY_ON_THIS_API_YET, and API-key /
   * Bedrock / Vertex sessions report rate_limits_available: false. Both cases
   * are handled the same way: report `available: false` and let the UI drop the
   * whole block. Session cost is still meaningful either way.
   */
  async usage(): Promise<UsageInfo | null> {
    if (!this.q) return null
    try {
      const r = await this.q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()
      // rate_limits 整体可空,单项也可空,utilization 本身还能是 null —— 三层都要防。
      const limits = r.rate_limits ?? {}
      return {
        available: r.rate_limits_available,
        subscriptionType: r.subscription_type,
        fiveHour: limits.five_hour?.utilization ?? null,
        sevenDay: limits.seven_day?.utilization ?? null,
        sevenDayOpus: limits.seven_day_opus?.utilization ?? null,
        fiveHourResetsAt: limits.five_hour?.resets_at ?? null,
        sevenDayResetsAt: limits.seven_day?.resets_at ?? null,
        sessionCostUsd: r.session.total_cost_usd,
      }
    } catch {
      return null
    }
  }

  /** dryRun:只问「能回退几个文件」,不动磁盘。 */
  async rewindPreview(messageId: string) {
    if (!this.q) return null
    try {
      return await this.q.rewindFiles(messageId, { dryRun: true })
    } catch {
      return null
    }
  }

  async rewindFiles(messageId: string): Promise<void> {
    try {
      await this.q?.rewindFiles(messageId)
    } catch {
      // 回退失败不该把分支这件事也一起搞砸 —— 分支照做,文件保持原样
    }
  }

  async stopTask(taskId: string): Promise<void> {
    await this.q?.stopTask(taskId)
  }

  /** Ctrl B —— 把当前前台任务转到后台,等于终端里的那个快捷键。 */
  async moveToBackground(): Promise<boolean> {
    return (await this.q?.backgroundTasks()) ?? false
  }

  async interrupt(): Promise<void> {
    await this.q?.interrupt()
  }

  dispose(): void {
    for (const resolve of this.pendingPermissions.values()) resolve(false)
    this.pendingPermissions.clear()
    for (const p of this.pendingElicitations.values()) p.resolve(null)
    this.pendingElicitations.clear()
    for (const r of this.pendingAsks.values()) r(null)
    this.pendingAsks.clear()
    for (const r of this.pendingPlans.values()) r(false)
    this.pendingPlans.clear()
    this.inbox.close()
    this.q = null
  }
}
