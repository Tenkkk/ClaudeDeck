// 仅供 session-switching.mjs 打包替换 SDK:不启动 CLI,不请求模型。
import { writeFileSync } from 'node:fs'

const fixtures = globalThis.sessionFixture = { instances: [], delays: {}, permissions: {} }
const info = { models: [{ value: 'opus', displayName: 'Opus' }], commands: [], account: null }
process.on('exit', () => {
  writeFileSync(process.env.CLAUDEDECK_TEST_REPORT, JSON.stringify(fixtures.instances.map((q) => ({
    id: q.id, cwd: q.options.cwd, closed: q.closed, interrupts: q.interrupts,
  }))))
})

export function query({ prompt, options }) {
  const queue = []
  let waiting
  const q = {
    id: options.resume ?? `new-${fixtures.instances.length}`,
    options, closed: false, interrupts: 0, messages: [],
    push(message) {
      if (q.closed) return
      const value = { ...message, session_id: q.id }
      if (waiting) { const resolve = waiting; waiting = null; resolve({ value, done: false }) }
      else queue.push(value)
    },
    [Symbol.asyncIterator]() {
      return { next: () => queue.length
        ? Promise.resolve({ value: queue.shift(), done: false })
        : q.closed ? Promise.resolve({ done: true }) : new Promise((resolve) => { waiting = resolve }) }
    },
    close() { q.closed = true; waiting?.({ done: true }); waiting = null },
    async interrupt() {
      q.interrupts++
      q.push({ type: 'result', subtype: 'success', terminal_reason: 'aborted_streaming' })
    },
    async initializationResult() { return info },
    async supportedModels() { return info.models },
    async supportedCommands() { return [] },
    async accountInfo() { return {} },
    async getContextUsage() { return { percentage: 0, totalTokens: 0, maxTokens: 1000, categories: [] } },
    async usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET() {
      return { rate_limits_available: false, session: { total_cost_usd: 0 } }
    },
    async setPermissionMode(mode) { q.mode = mode },
    async setModel(model) { q.model = model },
    async applyFlagSettings(settings) { q.settings = settings },
  }
  fixtures.instances.push(q)
  if (!fixtures.withholdInit) q.push({ type: 'system', subtype: 'init' })
  void (async () => { for await (const message of prompt) q.messages.push(message) })()
  return q
}

export async function listSessions({ dir }) {
  return (dir === process.env.CLAUDEDECK_TEST_WORKSPACE ? ['A', 'B', 'slow'] : ['C']).map((id) => ({
    sessionId: id, customTitle: `测试会话${id}`, firstPrompt: id, lastModified: Date.now(),
  }))
}
export async function getSessionMessages(id) {
  if (fixtures.delays[id]) await fixtures.delays[id]
  return [{ uuid: `history-${id}`, message: { role: 'assistant', content: `历史${id}` } }]
}
export async function deleteSession() {}
export async function renameSession() {}
export async function tagSession() {}
export async function forkSession() { return { sessionId: 'fork' } }
