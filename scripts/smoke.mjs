/**
 * 手动冒烟测试 —— 验证三个功能的核心链路真的跑得通。
 *
 * 不走 UI,直接按 src/main/chat.ts 的方式调用 SDK,因为风险全在这一层:
 * 渲染层只是把这些结果画出来。
 *
 *   node scripts/smoke.mjs
 *
 * 会产生真实的 API 调用(少量费用)。需要已登录的 Claude Code,
 * 或在环境变量里提供 ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY。
 */
import {
  query,
  listSessions,
  getSessionMessages,
  deleteSession,
} from '@anthropic-ai/claude-agent-sdk'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CWD = mkdtempSync(join(tmpdir(), 'claudedeck-smoke-'))

let passed = 0
let failed = 0
function check(label, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** 与 chat.ts 里的 Inbox 相同:可推送的 AsyncIterable,用作 SDK 的 prompt。 */
class Inbox {
  #buffer = []
  #waiting = null
  #closed = false

  push(text) {
    const msg = {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      origin: { kind: 'human' },
    }
    if (this.#waiting) {
      const w = this.#waiting
      this.#waiting = null
      w({ value: msg, done: false })
    } else {
      this.#buffer.push(msg)
    }
  }

  close() {
    this.#closed = true
    if (this.#waiting) {
      const w = this.#waiting
      this.#waiting = null
      w({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator]() {
    return {
      next: () => {
        const queued = this.#buffer.shift()
        if (queued) return Promise.resolve({ value: queued, done: false })
        if (this.#closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => {
          this.#waiting = resolve
        })
      },
    }
  }
}

/** 打开一个会话,返回控制句柄。 */
function open({ resume } = {}) {
  const inbox = new Inbox()
  const state = { sessionId: null, deltas: '', done: null }

  const q = query({
    prompt: inbox,
    options: {
      cwd: CWD,
      resume,
      forkSession: false,
      effort: 'low',
      permissionMode: 'bypassPermissions',
      includePartialMessages: true,
    },
  })

  const pump = (async () => {
    for await (const msg of q) {
      if (msg.session_id) state.sessionId = msg.session_id
      if (msg.type === 'stream_event') {
        const e = msg.event
        if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
          state.deltas += e.delta.text
        }
      }
      if (msg.type === 'result' && state.done) {
        const resolve = state.done
        state.done = null
        resolve()
      }
    }
  })()

  return {
    q,
    state,
    async ask(text) {
      state.deltas = ''
      const settled = new Promise((resolve) => {
        state.done = resolve
      })
      inbox.push(text)
      await settled
      return state.deltas
    },
    close() {
      inbox.close()
      return pump
    },
  }
}

console.log(`工作目录:${CWD}\n`)

try {
  // ---- 功能 1:聊天(流式) ------------------------------------------------
  console.log('[1/3] 聊天')
  const s1 = open()
  const reply1 = await s1.ask('只回复两个字:你好')
  check('收到流式文本', reply1.trim().length > 0, JSON.stringify(reply1.trim().slice(0, 30)))
  check('捕获到 session_id', Boolean(s1.state.sessionId), s1.state.sessionId ?? '')
  const sessionId = s1.state.sessionId

  // ---- 功能 2:会话中途切换模型 -------------------------------------------
  console.log('\n[2/3] 切换模型')
  const models = await s1.q.supportedModels()
  check('supportedModels 返回非空', models.length > 0, `${models.length} 个`)
  console.log(
    '        ' + models.map((m) => `${m.displayName} (${m.value})`).join('\n        '),
  )

  const target = models.find((m) => /haiku/i.test(m.value + m.displayName)) ?? models[0]
  await s1.q.setModel(target.value)
  check('setModel 未抛异常', true, `→ ${target.value}`)

  const reply2 = await s1.ask('只回复两个字:收到')
  check('切换后仍能对话', reply2.trim().length > 0, JSON.stringify(reply2.trim().slice(0, 30)))
  check('切换模型后 session_id 未变', s1.state.sessionId === sessionId, s1.state.sessionId ?? '')

  await s1.close()

  // ---- 功能 3:会话列表与恢复 ---------------------------------------------
  console.log('\n[3/3] 会话列表与切换')
  const sessions = await listSessions({ dir: CWD })
  check('listSessions 能找到刚才的会话', sessions.some((s) => s.sessionId === sessionId), `共 ${sessions.length} 条`)

  const info = sessions.find((s) => s.sessionId === sessionId)
  if (info) {
    console.log(
      `        标题:${info.customTitle || info.summary || info.firstPrompt || '(空)'}`,
    )
  }

  const history = await getSessionMessages(sessionId, { dir: CWD })
  const texts = history
    .map((m) => {
      const c = m.message?.content
      if (typeof c === 'string') return c
      if (Array.isArray(c)) return c.filter((b) => b.type === 'text').map((b) => b.text).join('')
      return ''
    })
    .filter((t) => t.trim())
  check('getSessionMessages 能取回历史', texts.length >= 2, `${texts.length} 条消息`)

  // resume 继续同一会话,验证不分叉
  const s2 = open({ resume: sessionId })
  const reply3 = await s2.ask('只回复两个字:继续')
  check('resume 后能继续对话', reply3.trim().length > 0, JSON.stringify(reply3.trim().slice(0, 30)))
  check('resume 未分叉出新 session_id', s2.state.sessionId === sessionId, s2.state.sessionId ?? '')
  await s2.close()

  const after = await listSessions({ dir: CWD })
  check('resume 后列表未新增条目', after.length === sessions.length, `${sessions.length} → ${after.length}`)

  await deleteSession(sessionId, { dir: CWD }).catch(() => {})
} catch (err) {
  failed++
  console.error('\n异常:', err)
} finally {
  rmSync(CWD, { recursive: true, force: true })
}

console.log(`\n${passed} 通过,${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
