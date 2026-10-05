/** npm run build && node scripts/session-switching.mjs
 * 使用真实主进程/桥接/React StrictMode,仅替换 SDK 与环境检测。
 * 独立临时配置和 Vite 端口,不触及用户会话、不产生 API 费用。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { _electron as electron } from 'playwright'

const ROOT = resolve(import.meta.dirname, '..')
const TEMP = mkdtempSync(join(tmpdir(), 'claudedeck-switch-'))
const WORKSPACE = join(TEMP, 'project-a')
const OTHER = join(TEMP, 'project-b')
const USER_DATA = join(TEMP, 'user-data')
const REPORT = join(TEMP, 'closed.json')
for (const dir of [WORKSPACE, OTHER, USER_DATA]) mkdirSync(dir)
writeFileSync(join(USER_DATA, 'config.json'), JSON.stringify({
  projects: [WORKSPACE, OTHER].map((path) => ({ path, name: path === WORKSPACE ? '项目A' : '项目B', collapsed: false })),
  activeWorkspace: WORKSPACE, permissionMode: 'default',
}))

const ENTRY = join(TEMP, 'main.cjs')
await build({
  entryPoints: [join(ROOT, 'src/main/index.ts')], outfile: ENTRY,
  bundle: true, platform: 'node', format: 'cjs', packages: 'external',
  define: { 'import.meta.url': JSON.stringify(pathToFileURL(ENTRY).href) },
  banner: { js: `require = require('node:module').createRequire(${JSON.stringify(join(ROOT, 'package.json'))});` },
  plugins: [{
    name: 'session-fixtures',
    setup(builder) {
      builder.onResolve({ filter: /^@anthropic-ai\/claude-agent-sdk$/ }, () => ({
        path: join(ROOT, 'scripts/fixtures/session-sdk.mjs'),
      }))
      builder.onResolve({ filter: /^\.\/doctor\.js$/ }, () => ({ path: 'doctor', namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents:
        `export const runDoctor = async () => ({cliFound:true,credentialsConfigured:true});
         export const installCli = async () => ({ok:true,output:''});`,
      }))
      builder.onLoad({ filter: /src[\\/]main[\\/]index\.ts$/ }, ({ path }) => ({
        loader: 'ts', contents: readFileSync(path, 'utf8')
          .replace("join(__dirname, '../preload/index.mjs')", JSON.stringify(join(ROOT, 'out/preload/index.mjs')))
          .replace('mainWindow?.show()', 'undefined'),
      }))
    },
  }],
})

const server = await createServer({
  configFile: false, root: join(ROOT, 'src/renderer'), plugins: [react()],
  server: { host: '127.0.0.1', port: 0, fs: { allow: [ROOT] } },
})
let app
try {
  await server.listen()
  const address = server.httpServer.address()
  app = await electron.launch({
    args: [ENTRY, `--user-data-dir=${USER_DATA}`], cwd: ROOT,
    env: { ...process.env, ELECTRON_RENDERER_URL: `http://127.0.0.1:${address.port}`,
      CLAUDEDECK_TEST_REPORT: REPORT, CLAUDEDECK_TEST_WORKSPACE: WORKSPACE },
  })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  const ready = () => page.waitForFunction(() =>
    document.querySelector('.composer-wrap')?.getAttribute('aria-busy') === 'false')
  await page.locator('.session-row[title="测试会话A"]').waitFor()
  await ready()
  async function open(id) {
    await page.locator(`.session-row[title="测试会话${id}"]`).click()
    await ready()
    await page.waitForFunction((title) =>
      document.querySelector('.session-row[aria-current="true"]')?.getAttribute('title') === title,
    `测试会话${id}`)
  }
  async function push(id, messages) {
    await app.evaluate((_electron, { id, messages }) => {
      const q = globalThis.sessionFixture.instances.findLast((q) => q.id === id && !q.closed)
      if (!q) throw new Error(`会话未找到:${id}`)
      for (const message of messages) q.push(message)
    }, { id, messages })
  }
  const delta = (text) => ({ type: 'stream_event', event: {
    type: 'content_block_delta', delta: { type: 'text_delta', text },
  } })
  const thinking = (text) => ({ type: 'stream_event', event: {
    type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: text },
  } })
  const tool = (id) => ({ type: 'assistant', message: { content: [
    { type: 'tool_use', id, name: 'Read', input: { file_path: `${id}.txt` } },
  ] } })
  const done = { type: 'result', subtype: 'success' }
  const textCount = (text) => page.locator('.msg-claude').filter({ hasText: text }).count()

  await open('A')
  await page.locator('.composer textarea').fill('给A的请求')
  await page.locator('.composer [data-state="send"]').click()
  await push('A', [thinking('思考只出现一次'), delta('正文只出现一次'), tool('read-a')])
  await page.locator('.msg-claude').filter({ hasText: '正文只出现一次' }).waitFor()
  assert.equal(await textCount('正文只出现一次'), 1)
  assert.equal(await page.locator('.thought').filter({ hasText: '思考只出现一次' }).count(), 1)
  assert.equal(await page.locator('.msg-user').filter({ hasText: '给A的请求' }).count(), 1)
  console.log('PASS 开发 StrictMode 正文/思考/用户消息均只出现一次')

  await open('B')
  await push('A', [delta('A后台继续生成')])
  assert.equal(await textCount('A后台继续生成'), 0)
  await open('A')
  await page.locator('.msg-claude').filter({ hasText: 'A后台继续生成' }).waitFor()
  assert.equal(await textCount('正文只出现一次'), 1)
  assert.equal(await textCount('A后台继续生成'), 1)
  await page.locator('.composer [data-state="stop"]').waitFor()
  let stats = await app.evaluate(() => globalThis.sessionFixture.instances.map((q) => ({
    id: q.id, closed: q.closed, interrupts: q.interrupts,
  })))
  assert.equal(stats.filter((q) => q.id === 'A').length, 1)
  assert.equal(stats.find((q) => q.id === 'A').interrupts, 0)
  assert.equal(stats.find((q) => q.id === 'A').closed, false)
  console.log('PASS A/B 切换不打断、不重启、不串流,切回恢复忙碌与输出')

  await open('B')
  await push('A', [done])
  await open('A')
  await page.locator('.composer [data-state="send"]').waitFor()
  assert.equal(await textCount('A后台继续生成'), 1)
  // 合法的相同文字属于下一段,不能被按文本去重吞掉。
  await push('A', [delta('正文只出现一次'), done])
  await page.waitForFunction(() => [...document.querySelectorAll('.msg-claude')]
    .filter((el) => el.textContent.includes('正文只出现一次')).length === 2)
  console.log('PASS 后台完成状态恢复,合法相同文本不被误删')

  await app.evaluate(() => {
    const q = globalThis.sessionFixture.instances.findLast((q) => q.id === 'A')
    const controller = new AbortController()
    globalThis.sessionFixture.permissions.abort = () => controller.abort()
    globalThis.sessionFixture.permissions.pending = q.options.canUseTool('Bash', { command: 'echo fixture' }, {
      toolUseID: 'permission-a', signal: controller.signal,
    })
  })
  await page.locator('.permission-card').waitFor()
  await open('B')
  assert.equal(await page.locator('.permission-card').count(), 0)
  await open('A')
  await page.locator('.permission-card').waitFor()
  await page.locator('.permission-card button.primary').click()
  await open('B')
  await open('A')
  assert.equal(await page.locator('.permission-card').count(), 0)
  assert.equal(await app.evaluate(async () =>
    (await globalThis.sessionFixture.permissions.pending).behavior), 'allow')
  console.log('PASS 未作答权限卡切回恢复,已作答卡片不复活')

  await app.evaluate(() => {
    const q = globalThis.sessionFixture.instances.findLast((q) => q.id === 'A')
    const controller = new AbortController()
    globalThis.sessionFixture.cancelCards = () => controller.abort()
    const opts = (toolUseID) => ({ toolUseID, signal: controller.signal })
    globalThis.sessionFixture.cards = [
      q.options.canUseTool('AskUserQuestion', { questions: [{
        question: '测试提问恢复', header: '测试', options: [{ label: '是' }, { label: '否' }],
      }] }, opts('ask-a')),
      q.options.canUseTool('ExitPlanMode', { plan: '测试计划恢复' }, opts('plan-a')),
      q.options.onElicitation({ serverName: '测试MCP', message: '测试表单恢复',
        requestedSchema: { type: 'object', properties: { name: { type: 'string' } } },
      }, { signal: controller.signal }),
    ]
  })
  await page.locator('.plan-card').waitFor()
  await open('B')
  assert.equal(await page.locator('.plan-card,.ask-card').count(), 0)
  await open('A')
  await page.locator('.plan-card').waitFor()
  assert.equal(await page.locator('.ask-card').count(), 2)
  await open('B')
  await app.evaluate(() => globalThis.sessionFixture.cancelCards())
  await open('A')
  assert.equal(await page.locator('.plan-card,.ask-card').count(), 0)
  console.log('PASS 提问/计划/MCP 卡片恢复,后台撤销后不残留死卡')

  await page.evaluate(async () => {
    await window.api.chat.setPermissionMode('bypassPermissions')
    await window.api.chat.setModel('sonnet')
    await window.api.chat.setEffort('high')
  })
  await open('B')
  assert.match(await page.locator('[data-control="permission"]').innerText(), /询问/)
  await open('A')
  assert.match(await page.locator('[data-control="permission"]').innerText(), /完全放行/)
  const settings = await page.evaluate(() => window.api.config.get())
  assert.equal(settings.model, 'sonnet')
  assert.equal(settings.effort, 'high')
  console.log('PASS 模型/努力/权限按运行会话恢复,不随其他会话切换漂移')

  await push('A', [delta('新建时仍在生成')])
  await page.locator('.new-session').click()
  await ready()
  await push('A', [delta('并且继续'), done])
  assert.equal(await textCount('新建时仍在生成'), 0)
  await open('A')
  await page.locator('.msg-claude').filter({ hasText: '新建时仍在生成并且继续' }).waitFor()
  console.log('PASS 新建会话不打断原会话,后台完成后仍能切回')

  await app.evaluate(() => { globalThis.sessionFixture.withholdInit = true })
  await page.locator('.new-session').click()
  await ready()
  await page.locator('.composer textarea').fill('尚无会话ID的请求')
  await page.locator('.composer [data-state="send"]').click()
  const earlyId = await app.evaluate(() => globalThis.sessionFixture.instances.at(-1).id)
  await open('A')
  assert.equal(await app.evaluate((_electron, id) =>
    globalThis.sessionFixture.instances.find((q) => q.id === id).closed, earlyId), false)
  await app.evaluate(() => { globalThis.sessionFixture.withholdInit = false })
  console.log('PASS 已发送但尚无 SDK 会话 ID 的任务不会被误当空会话清理')

  await open('C')
  await push('A', [delta('跨项目后台输出'), done])
  assert.equal(await textCount('跨项目后台输出'), 0)
  await open('A')
  await page.locator('.msg-claude').filter({ hasText: '跨项目后台输出' }).waitFor()
  console.log('PASS 跨项目输出隔离')

  await app.evaluate(() => {
    globalThis.sessionFixture.delays.slow = new Promise((resolve) => {
      globalThis.sessionFixture.releaseSlow = resolve
    })
  })
  await page.locator('.session-row[title="测试会话slow"]').click()
  await open('B')
  await app.evaluate(() => globalThis.sessionFixture.releaseSlow())
  await page.waitForFunction(() => document.querySelector('.composer-wrap')?.getAttribute('aria-busy') === 'false')
  assert.equal(await page.locator('.session-row[aria-current="true"]').getAttribute('title'), '测试会话B')
  assert.equal(await textCount('历史slow'), 0)
  console.log('PASS 慢历史加载不能覆盖最后选中的会话')

  await push('B', [delta('等待显式停止')])
  await page.locator('.composer [data-state="stop"]').click()
  stats = await app.evaluate(() => globalThis.sessionFixture.instances.map((q) => ({ id: q.id, interrupts: q.interrupts })))
  assert.equal(stats.find((q) => q.id === 'B').interrupts, 1)
  assert.equal(stats.find((q) => q.id === 'A').interrupts, 0)
  await page.evaluate(() => window.api.sessions.remove('A'))
  await page.evaluate((path) => window.api.projects.remove(path), OTHER)
  const closed = await app.evaluate(() => globalThis.sessionFixture.instances.map((q) => ({ id: q.id, closed: q.closed })))
  assert.equal(closed.find((q) => q.id === 'A').closed, true)
  assert.equal(closed.find((q) => q.id === 'C').closed, true)
  assert.equal(closed.find((q) => q.id === 'B').closed, false)
  console.log('PASS 删除会话/移除项目只清理对应后台进程')
  assert.deepEqual(errors, [])
  console.log('PASS 显式停止仅中断当前会话,无 React 页面异常')
} finally {
  await app?.close()
  await server.close()
}
assert.ok(JSON.parse(readFileSync(REPORT, 'utf8')).every((q) => q.closed))
console.log(`PASS 退出清理所有已打开会话\n测试临时目录:${TEMP}`)
