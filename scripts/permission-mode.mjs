/** 权限切换回归:先 npm run build,再 node scripts/permission-mode.mjs。
 * 不发送模型消息;Electron 使用临时用户数据,不改用户配置。
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { _electron as electron } from 'playwright'

const ROOT = resolve(import.meta.dirname, '..')
const USER_DATA = mkdtempSync(join(tmpdir(), 'claudedeck-permission-ud-'))
const WORKSPACE = mkdtempSync(join(tmpdir(), 'claudedeck-permission-ws-'))
const require = createRequire(import.meta.url)
const events = []
let captured
let liveQuery
let rejectMode = false
let useRealSdk = false
const compiled = await build({
  entryPoints: [join(ROOT, 'src/main/chat.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  write: false,
  plugins: [{
    name: 'isolated-credentials',
    setup(builder) {
      builder.onResolve({ filter: /^\.\/config\.js$/ }, () => ({
        path: 'config', namespace: 'test',
      }))
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
        contents: 'export const credentialEnv = () => ({})',
      }))
    },
  }],
})
const mod = { exports: {} }
runInNewContext(compiled.outputFiles[0].text, {
  module: mod, exports: mod.exports, process, console, setTimeout,
  require(id) {
    if (id !== '@anthropic-ai/claude-agent-sdk') return require(id)
    return { query(args) {
      captured = args.options
      if (useRealSdk) return (liveQuery = query(args))
      return {
        async setPermissionMode() {
          if (rejectMode) throw new Error('模拟权限切换被拒绝')
        },
        close() {},
        [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}) } },
      }
    } }
  },
})
const { ChatSession } = mod.exports
const options = { cwd: WORKSPACE, model: null, effort: 'low', permissionMode: 'default' }
const session = new ChatSession((event) => events.push(event))
session.start(options)
assert.equal(captured.permissionMode, 'default')
assert.equal(captured.allowDangerouslySkipPermissions, true)
await session.setPermissionMode('bypassPermissions')
await session.setPermissionMode('default')
rejectMode = true
await assert.rejects(session.setPermissionMode('acceptEdits'), /模拟权限切换被拒绝/)
const decision = captured.canUseTool('Edit', { file_path: join(WORKSPACE, 'test.txt') }, {
  toolUseID: 'failed-mode', signal: new AbortController().signal,
})
assert.ok(events.some((event) => event.type === 'permission'))
session.answerPermission('failed-mode', false)
assert.equal((await decision).behavior, 'deny')
session.dispose(true)
console.log('PASS SDK 选项与本地权限失败回滚')

// 真实 CLI 控制通道验证,不向 Inbox 推送任何用户消息。
useRealSdk = true
const realSession = new ChatSession(() => {})
const timer = setTimeout(() => {
  console.error('真实 CLI 权限切换超时')
  realSession.dispose(true)
  process.exitCode = 1
}, 45_000)
try {
  realSession.start(options)
  await liveQuery.initializationResult()
  await realSession.setPermissionMode('bypassPermissions')
  await realSession.setPermissionMode('acceptEdits')
  await realSession.setPermissionMode('default')
  console.log('PASS 真实 CLI 默认 → 完全放行 → 接受编辑 → 询问')
} finally {
  clearTimeout(timer)
  realSession.dispose(true)
}

writeFileSync(join(USER_DATA, 'config.json'), JSON.stringify({
  projects: [{ path: WORKSPACE, name: '权限回归', collapsed: false }],
  activeWorkspace: WORKSPACE,
  permissionMode: 'bypassPermissions',
}))
const app = await electron.launch({ args: ['.', `--user-data-dir=${USER_DATA}`], cwd: ROOT })
try {
  const page = await app.firstWindow()
  const chip = page.locator('[data-control="permission"]')
  await chip.waitFor({ timeout: 20_000 })
  assert.match(await chip.innerText(), /询问/)
  async function pick(label) {
    await chip.click()
    await page.locator('.popover .pop-row').filter({
      has: page.locator('.pop-title').filter({ hasText: label }),
    }).click()
  }
  await pick('完全放行')
  await page.waitForFunction(() =>
    document.querySelector('[data-control="permission"]')?.textContent.includes('完全放行'))
  assert.equal(JSON.parse(readFileSync(join(USER_DATA, 'config.json'))).permissionMode, 'bypassPermissions')
  // 真实 IPC 拒绝非法模式后,落盘配置必须仍是上一次成功值。
  const failure = await page.evaluate(async () => {
    try { await window.api.chat.setPermissionMode('invalid-mode'); return null }
    catch (err) { return String(err) }
  })
  assert.ok(failure)
  assert.equal(JSON.parse(readFileSync(join(USER_DATA, 'config.json'))).permissionMode, 'bypassPermissions')
  console.log('PASS 重启恢复询问、真实 UI/IPC 切换和配置失败回滚')

  // 只替换独立测试窗口的 IPC,精确控制响应时间及失败。
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('chat:setPermissionMode')
    globalThis.permissionTestCalls = 0
    ipcMain.handle('chat:setPermissionMode', () => {
      globalThis.permissionTestCalls++
      return new Promise((resolve, reject) => {
        globalThis.permissionTestResolve = resolve
        globalThis.permissionTestReject = reject
      })
    })
  })
  await pick('接受编辑')
  await pick('询问')
  assert.equal(await app.evaluate(() => globalThis.permissionTestCalls), 1)
  assert.match(await chip.innerText(), /完全放行/)
  await app.evaluate(() => globalThis.permissionTestReject(new Error('测试拒绝')))
  await page.locator('.error-line').filter({ hasText: '权限切换失败' }).waitFor()
  assert.match(await chip.innerText(), /完全放行/)
  await pick('接受编辑')
  await app.evaluate(() => globalThis.permissionTestResolve())
  await page.waitForFunction(() =>
    document.querySelector('[data-control="permission"]')?.textContent.includes('接受编辑'))
  console.log('PASS 界面等待确认、失败提示、重复点击保护及失败后重试')
} finally {
  await app.close()
}
console.log(`临时测试数据:${USER_DATA}\n临时工作目录:${WORKSPACE}`)
