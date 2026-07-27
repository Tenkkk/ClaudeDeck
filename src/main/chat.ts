import { query, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { credentialEnv } from './config.js'
import type { ChatEvent, EffortLevel, PermissionMode } from '../shared/ipc.js'

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

/**
 * One live conversation. Wraps a single long-lived Query so that model and
 * permission-mode changes can be applied in place rather than by restarting.
 */
export class ChatSession {
  private inbox = new Inbox()
  private q: Query | null = null
  private pendingPermissions = new Map<string, (allow: boolean) => void>()

  sessionId: string | null = null

  constructor(private readonly emit: (event: ChatEvent) => void) {}

  start(opts: StartOptions): void {
    this.sessionId = opts.resume ?? null

    this.q = query({
      prompt: this.inbox,
      options: {
        cwd: opts.cwd,
        resume: opts.resume,
        // Resuming without forkSession continues the same session id, so the
        // sidebar entry the user clicked stays the entry that grows.
        forkSession: false,
        model: opts.model ?? undefined,
        effort: opts.effort,
        permissionMode: opts.permissionMode,
        includePartialMessages: true,
        env: { ...process.env, ...credentialEnv() } as Record<string, string>,
        canUseTool: async (toolName, input) => {
          const requestId = `perm-${++permissionSeq}`
          const allowed = await new Promise<boolean>((resolve) => {
            this.pendingPermissions.set(requestId, resolve)
            this.emit({ type: 'permission', requestId, toolName, input })
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
      const event = msg.event as { type?: string; delta?: { type?: string; text?: string } }
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
        this.emit({ type: 'delta', text: event.delta.text })
      }
      return
    }

    if (msg.type === 'assistant') {
      for (const block of msg.message.content) {
        if (block.type === 'tool_use') this.emit({ type: 'tool', name: block.name })
      }
      return
    }

    if (msg.type === 'result') {
      this.emit({ type: 'done' })
    }
  }

  send(text: string): void {
    this.inbox.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      // Required: the SDK fails closed at strict isHuman() gates when a host
      // wrapping keyboard input does not attribute the message explicitly.
      origin: { kind: 'human' },
    })
  }

  answerPermission(requestId: string, allow: boolean): void {
    const resolve = this.pendingPermissions.get(requestId)
    if (!resolve) return
    this.pendingPermissions.delete(requestId)
    resolve(allow)
  }

  async setModel(model: string): Promise<void> {
    await this.q?.setModel(model)
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await this.q?.setPermissionMode(mode)
  }

  async listModels(): Promise<{ value: string; displayName: string }[]> {
    const models = await this.q?.supportedModels()
    return (models ?? []).map((m) => ({ value: m.value, displayName: m.displayName }))
  }

  async interrupt(): Promise<void> {
    await this.q?.interrupt()
  }

  dispose(): void {
    for (const resolve of this.pendingPermissions.values()) resolve(false)
    this.pendingPermissions.clear()
    this.inbox.close()
    this.q = null
  }
}
