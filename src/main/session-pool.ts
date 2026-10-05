import { ChatSession, type StartOptions } from './chat.js'
import type { ChatEvent, ChatViewEvent, ImageAttachment, TimedChatEvent, TranscriptItem } from '../shared/ipc.js'

interface LiveSession {
  session: ChatSession
  options: StartOptions
  history: TranscriptItem[]
  events: TimedChatEvent[]
}

/** 切换的是查看对象,不是 CLI 生命周期。缓存仅存内存,退出统一销毁。 */
export class SessionPool {
  private records = new Set<LiveSession>()
  private generation = 0
  private viewId = ''
  private opening: StartOptions | null = null
  current: LiveSession | null = null

  constructor(
    private readonly publish: (event: ChatViewEvent) => void,
    private readonly create = (emit: (event: ChatEvent) => void): ChatSession => new ChatSession(emit),
  ) {}

  get active(): ChatSession | null {
    return this.current?.session ?? null
  }

  matches(viewId: string): boolean {
    return this.current !== null && this.viewId === viewId
  }

  private record(record: LiveSession, event: ChatEvent): void {
    if (!this.records.has(record)) return
    const at = Date.now()
    const last = record.events.at(-1)
    // 合并相邻增量,避免按每个 token 保存一个对象;不按内容去重。
    if (
      (event.type === 'delta' || event.type === 'thinking') &&
      last?.event.type === event.type
    ) {
      const previous = last.event as Extract<ChatEvent, { type: 'delta' | 'thinking' }>
      record.events[record.events.length - 1] = {
        at: last.at, event: { ...event, text: previous.text + event.text },
      }
    } else {
      record.events.push({ event, at })
    }
    if (record === this.current) {
      this.publish({ type: 'event', viewId: this.viewId, event, at })
    } else if (event.type === 'session' || event.type === 'done' || event.type === 'error') {
      this.publish({ type: 'background', sessionId: record.session.sessionId })
    }
  }

  async open(
    options: StartOptions,
    viewId: string,
    history: (sessionId: string, cwd: string) => Promise<TranscriptItem[]>,
  ): Promise<boolean> {
    const generation = ++this.generation
    this.current = null
    this.viewId = viewId
    this.opening = options
    let record = options.resume
      ? [...this.records].find((r) =>
          r.options.cwd === options.cwd && r.session.sessionId === options.resume && !r.session.dead)
      : undefined
    let fresh = false
    if (!record) {
      const baseline = options.resume ? await history(options.resume, options.cwd) : []
      if (generation !== this.generation) return false
      const session = this.create((event) => this.record(created, event))
      const created: LiveSession = { session, options: { ...options }, history: baseline, events: [] }
      record = created
      this.records.add(record)
      fresh = true
    }
    if (generation !== this.generation) return false
    this.opening = null
    this.current = record
    // 空会话没有可恢复的消息,不为每次点击“新建”留下一个空进程。
    for (const previous of this.records) {
      const empty = !previous.options.resume && !previous.events.some(({ event }) => event.type === 'sent')
      if (previous !== record && (empty || previous.session.dead)) this.drop(previous)
    }
    this.publish({
      type: 'restore', viewId, workspace: record.options.cwd,
      sessionId: record.session.sessionId ?? record.options.resume ?? null,
      history: record.history, events: record.events,
      model: record.options.model, effort: record.options.effort,
      permissionMode: record.options.permissionMode,
    })
    if (fresh) {
      try {
        record.session.start(record.options)
      } catch (err) {
        this.record(record, { type: 'error', message: String(err) })
        this.drop(record)
        throw err
      }
    }
    return true
  }

  send(text: string, images: ImageAttachment[]): void {
    const record = this.current
    if (!record) throw new Error('会话尚未准备好,请稍后再试。')
    record.session.send(text, images)
    this.record(record, { type: 'sent', text, images: images.length })
  }

  private drop(record: LiveSession): void {
    this.records.delete(record)
    if (record === this.current) this.current = null
    record.session.dispose(true)
  }

  remove(cwd: string, sessionId?: string): void {
    // 历史尚在读取时删除目标,也不能让它稍后重新启动已被移除的会话。
    if (this.opening?.cwd === cwd && (!sessionId || this.opening.resume === sessionId)) {
      this.generation++
      this.opening = null
    }
    for (const record of this.records) {
      if (record.options.cwd === cwd && (!sessionId || record.session.sessionId === sessionId)) {
        this.drop(record)
      }
    }
  }

  dispose(): void {
    this.generation++
    this.opening = null
    for (const record of this.records) this.drop(record)
    this.current = null
  }
}
