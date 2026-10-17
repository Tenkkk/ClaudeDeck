/** npm run build && node scripts/session-switching.mjs
 * 使用真实主进程/桥接/React StrictMode,仅替换 SDK 与环境检测。
 * 独立临时配置和 Vite 端口,不触及用户会话、不产生 API 费用。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer as createHttpServer } from 'node:http'
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
const compatibilityUpstream = createHttpServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const hasImage = Buffer.concat(chunks).toString('utf8').includes('"type":"image"')
  res.writeHead(hasImage ? 400 : 200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(hasImage ? { error: { message: 'tool_result: unsupported text content block "image"' } } : {}))
})
try {
  await new Promise((resolve) => compatibilityUpstream.listen(0, '127.0.0.1', resolve))
  await server.listen()
  const address = server.httpServer.address()
  app = await electron.launch({
    args: [ENTRY, `--user-data-dir=${USER_DATA}`], cwd: ROOT,
    env: { ...process.env, ELECTRON_RENDERER_URL: `http://127.0.0.1:${address.port}`,
      CLAUDEDECK_TEST_REPORT: REPORT, CLAUDEDECK_TEST_WORKSPACE: WORKSPACE,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${compatibilityUpstream.address().port}` },
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
  // 只在这段提示测试中冻结页面时钟,精确覆盖 5 秒边界及旧计时器清理。
  await page.clock.install()
  await page.clock.pauseAt(new Date(Date.now() + 1000))
  const imageNotice = page.getByRole('status').filter({ hasText: '模型未读取这些图片' })
  async function triggerCompatibility(id = 'A') {
    await app.evaluate(async (_electron, id) => {
      const q = globalThis.sessionFixture.instances.findLast((q) => q.id === id && !q.closed)
      if (q.options.settings?.env?.ANTHROPIC_BASE_URL !== q.options.env.ANTHROPIC_BASE_URL) {
        throw new Error('会话临时 settings.env 必须固定兼容地址,防止被用户配置覆盖')
      }
      const response = await fetch(q.options.env.ANTHROPIC_BASE_URL + '/v1/messages', { method: 'POST',
        body: JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'fixture-image',
          content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'fixture' } }] }] }] }) })
      if (response.status !== 200) throw new Error('兼容请求未成功')
      await response.text()
    }, id)
  }
  await triggerCompatibility()
  await imageNotice.waitFor()
  await page.clock.runFor(4999)
  assert.equal(await imageNotice.count(), 1)
  await page.clock.runFor(1)
  await imageNotice.waitFor({ state: 'hidden' })
  await triggerCompatibility()
  await imageNotice.waitFor()
  await page.clock.runFor(3000)
  await triggerCompatibility()
  await page.clock.runFor(2000)
  assert.equal(await imageNotice.count(), 1, '重复降级应重置计时,不能被前一次计时器清除')
  await page.clock.runFor(3000)
  await imageNotice.waitFor({ state: 'hidden' })
  await triggerCompatibility()
  await imageNotice.waitFor()
  for (const theme of ['light', 'dark']) {
    for (const width of [375, 940, 1600]) {
      await page.setViewportSize({ width, height: 800 })
      await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
      const notice = page.getByRole('status').filter({ hasText: '模型未读取这些图片' })
      assert.ok(await notice.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
      if (width === 940) await notice.screenshot({ path: join(TEMP, `image-notice-${theme}.png`) })
    }
  }
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.clock.runFor(1000)
  await open('B')
  assert.equal(await imageNotice.count(), 0)
  await triggerCompatibility('B')
  await imageNotice.waitFor()
  await page.clock.runFor(4000)
  assert.equal(await imageNotice.count(), 1, '旧会话计时器不能清掉新会话提示')
  await page.clock.runFor(1000)
  await imageNotice.waitFor({ state: 'hidden' })
  await triggerCompatibility('A')
  await open('A')
  assert.equal(await imageNotice.count(), 0, '切回不能重弹历史或后台降级提示')
  await page.clock.resume()
  console.log('PASS 图片兼容提示仅当下显示、5秒消失/重复重计时、亮暗/窄窗口、切换取消且回放不重弹')
  const paletteCommands = [
    { name: 'tk', description: `${'Multi-model review and collaborative implementation. 超长命令描述。'.repeat(16)} tail-match-only`,
      argumentHint: `<${'long-argument-without-spaces-'.repeat(16)}>`,
      aliases: ['tool-short', 'long-alias-without-spaces-'.repeat(16)] },
    ...Array.from({ length: 24 }, (_, i) => ({ name: `task-${String(i).padStart(2, '0')}`,
      description: '普通命令描述', argumentHint: '' })),
    { name: 'long-command-name-'.repeat(16), description: '超长命令名与参数也不能撑宽',
      argumentHint: 'long-argument-'.repeat(16), aliases: ['long-alias-'.repeat(16)] },
  ]
  await push('A', [{ type: 'system', subtype: 'commands_changed', commands: paletteCommands }])
  const composer = page.locator('.composer textarea')
  await composer.fill('/')
  await page.locator('.palette-row').first().waitFor()
  assert.equal(await page.locator('.palette-row').count(), paletteCommands.length)
  for (const theme of ['light', 'dark']) {
    for (const width of [940, 1200, 1600]) {
      await page.setViewportSize({ width, height: 800 })
      for (const columnWidth of [260, 360, 720]) {
        await page.evaluate(({ theme, columnWidth }) => {
          document.documentElement.dataset.theme = theme
          document.querySelector('.app').style.setProperty('--w-prose', `${columnWidth}px`)
        }, { theme, columnWidth })
        const layout = await page.locator('.palette').evaluate((palette) => {
          const list = palette.querySelector('.palette-list')
          const rows = [...list.querySelectorAll('.palette-row')]
          return {
            panelOverflow: palette.scrollWidth > palette.clientWidth,
            listOverflow: list.scrollWidth > list.clientWidth,
            horizontalHidden: getComputedStyle(list).overflowX === 'hidden',
            verticalScroll: list.scrollHeight > list.clientHeight && getComputedStyle(list).overflowY === 'auto',
            rowsFit: rows.every((row) => row.scrollWidth <= row.clientWidth),
            ellipsis: [...palette.querySelectorAll('.palette-name,.palette-desc,.palette-hint,.palette-alias')]
              .every((field) => getComputedStyle(field).textOverflow === 'ellipsis' && getComputedStyle(field).whiteSpace === 'nowrap'),
            truncated: [...palette.querySelectorAll('.palette-desc')].some((desc) => desc.scrollWidth > desc.clientWidth),
            fullText: [...palette.querySelectorAll('.palette-name,.palette-desc,.palette-hint,.palette-alias')]
              .every((field) => field.title === field.textContent.trim()),
          }
        })
        assert.deepEqual(layout, { panelOverflow: false, listOverflow: false, horizontalHidden: true,
          verticalScroll: true, rowsFit: true, ellipsis: true, truncated: true, fullText: true },
        `${theme} ${width}px / column ${columnWidth}px`)
        if (width === 1200 && columnWidth !== 260) {
          await page.locator('.palette').screenshot({ path: join(TEMP, `palette-${theme}-${columnWidth}.png`) })
        }
      }
    }
  }
  await page.evaluate(() => document.querySelector('.app').style.removeProperty('--w-prose'))
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.locator('.palette-row').first().hover()
  await composer.focus()
  const selectedName = () => page.locator('.palette-row[aria-selected="true"] .palette-name').textContent()
  assert.equal(await selectedName(), '/tk')
  await page.keyboard.press('ArrowDown')
  assert.notEqual(await selectedName(), '/tk')
  await page.keyboard.press('ArrowUp')
  assert.equal(await selectedName(), '/tk')
  await page.keyboard.press('ArrowUp')
  const lastName = `/${paletteCommands.at(-1).name}`
  assert.equal(await selectedName(), lastName)
  assert.equal(await page.locator('.palette-list').evaluate((list) => list.scrollTop > 0 && list.scrollLeft === 0), true)
  await page.keyboard.press('Enter')
  assert.equal(await composer.inputValue(), `${lastName} `)
  await page.locator('.palette').waitFor({ state: 'hidden' })
  await composer.fill('/tail-match-only')
  await page.locator('.palette-row').waitFor()
  assert.equal(await page.locator('.palette-row').count(), 1)
  assert.equal(await selectedName(), '/tk')
  assert.equal(await page.locator('.palette-desc').getAttribute('title'), paletteCommands[0].description)
  await composer.fill('/tool-short')
  await page.waitForFunction(() => document.querySelectorAll('.palette-row').length === 1)
  assert.equal(await selectedName(), '/tk')
  await page.keyboard.press('Enter')
  assert.equal(await composer.inputValue(), '/tk ')
  await composer.fill('/')
  await page.locator('.palette-row').first().click()
  assert.equal(await composer.inputValue(), '/tk ')
  await composer.fill('/')
  await page.keyboard.press('Escape')
  await page.locator('.palette').waitFor({ state: 'hidden' })
  assert.equal(await composer.inputValue(), '')
  assert.equal(await app.evaluate(() => globalThis.sessionFixture.instances.findLast((q) => q.id === 'A').messages.length), 0)
  console.log('PASS 命令面板亮暗/窄列无横向滚动,长描述/名称/参数/别名单行省略且悬停全文,保留纵向滚动')
  console.log('PASS ↑↓/Enter/Esc/点击与完整描述/别名检索,填入完整命令而不发送模型消息')
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

  const longCommand = 'git -C E:/code/ohmygame log --oneline -15 --date=short --pretty=format:"%h %ad %an %s"'
  const longRule = `${longCommand} ${'long-scope-without-spaces-'.repeat(20)}`
  const longHint = `This command requires approval ${'long-explanation-'.repeat(20)}`
  const requestPermission = async (id, title) => app.evaluate((_electron, { id, title, command, rule, hint }) => {
    const q = globalThis.sessionFixture.instances.findLast((q) => q.id === 'A')
    const controller = new AbortController()
    globalThis.sessionFixture.permissions.abort = () => controller.abort()
    globalThis.sessionFixture.permissions.pending = q.options.canUseTool('Bash', { command }, {
      toolUseID: id, signal: controller.signal, title, decisionReason: hint,
      suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: rule }],
        behavior: 'allow', destination: 'session' }],
    })
  }, { id, title, command: longCommand, rule: longRule, hint: longHint })
  await requestPermission('permission-a')
  await page.locator('.permission-card').waitFor()
  for (const theme of ['light', 'dark']) {
    for (const width of [940, 1200, 1600]) {
      await page.setViewportSize({ width, height: 900 })
      for (const cardWidth of [260, 320, 720]) {
        await page.evaluate(({ theme, cardWidth }) => {
          document.documentElement.dataset.theme = theme
          document.querySelector('.permission-card').style.maxWidth = `${cardWidth}px`
        }, { theme, cardWidth })
        const layout = await page.locator('.permission-card').evaluate((card) => {
          const buttons = [...card.querySelectorAll('.row > button')]
          const [allow, deny, remember] = buttons.map((button) => button.getBoundingClientRect())
          const bounds = card.getBoundingClientRect()
          return {
            horizontal: Math.abs(allow.top - deny.top) < 1 && allow.right <= deny.left,
            nowrap: buttons.slice(0, 2).every((button) => getComputedStyle(button).whiteSpace === 'nowrap'),
            touchTargets: buttons.every((button) => button.getBoundingClientRect().height >= 44),
            ownLine: remember.top >= Math.max(allow.bottom, deny.bottom),
            overflow: card.scrollWidth > card.clientWidth,
            contained: buttons.every((button) => {
              const r = button.getBoundingClientRect()
              return r.left >= bounds.left && r.right <= bounds.right + 1
            }),
          }
        })
        assert.deepEqual(layout, { horizontal: true, nowrap: true, touchTargets: true,
          ownLine: true, overflow: false, contained: true }, `${theme} ${width}px / card ${cardWidth}px`)
        assert.equal(await page.locator('.permission-card .card-target').textContent(), longCommand)
        assert.equal(await page.locator('.permission-card .card-remember').textContent(), `本次会话内不再问 Bash(${longRule})`)
        if (width === 1200 && cardWidth !== 260) {
          await page.locator('.permission-card').screenshot({ path: join(TEMP, `permission-${theme}-${cardWidth}.png`) })
        }
      }
    }
  }
  await page.evaluate(() => document.querySelector('.permission-card').style.removeProperty('max-width'))
  await page.setViewportSize({ width: 1200, height: 800 })
  console.log('PASS 权限卡亮暗/窄卡片/长命令与授权范围,按钮不压缩且记住范围独占下一行')
  await open('B')
  assert.equal(await page.locator('.permission-card').count(), 0)
  await open('A')
  await page.locator('.permission-card').waitFor()
  await page.locator('.permission-card button.primary').focus()
  await page.keyboard.press('Enter')
  await open('B')
  await open('A')
  assert.equal(await page.locator('.permission-card').count(), 0)
  const allowed = await app.evaluate(async () => await globalThis.sessionFixture.permissions.pending)
  assert.equal(allowed.behavior, 'allow')
  assert.equal(allowed.updatedPermissions, undefined)
  console.log('PASS 未作答权限卡切回恢复,已作答卡片不复活,Enter 单次允许不记住范围')

  await requestPermission('permission-deny', longHint)
  await page.locator('.permission-card').waitFor()
  assert.equal(await page.locator('.permission-card .card-title').textContent(), longHint)
  assert.equal(await page.locator('.permission-card').evaluate((card) => card.scrollWidth <= card.clientWidth), true)
  await page.locator('.permission-card button.primary').focus()
  await page.keyboard.press('Tab')
  assert.equal(await page.getByRole('button', { name: '拒绝', exact: true }).evaluate((el) => el === document.activeElement), true)
  await page.keyboard.press('Space')
  assert.equal(await app.evaluate(async () => (await globalThis.sessionFixture.permissions.pending).behavior), 'deny')
  await requestPermission('permission-remember')
  await page.locator('.permission-card').waitFor()
  await page.locator('.permission-card button.primary').focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  assert.equal(await page.locator('.permission-card .card-remember').evaluate((el) => el === document.activeElement), true)
  await page.keyboard.press('Enter')
  const remembered = await app.evaluate(async () => await globalThis.sessionFixture.permissions.pending)
  assert.equal(remembered.behavior, 'allow')
  assert.deepEqual(remembered.updatedPermissions, [{ type: 'addRules',
    rules: [{ toolName: 'Bash', ruleContent: longRule }], behavior: 'allow', destination: 'session' }])
  console.log('PASS 长标题换行,Tab/Space 拒绝和独立授权按钮的 Enter 操作,审批范围与语义不变')

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
  await page.locator('.project-row[aria-current="true"]').hover()
  await page.locator('.project-row[aria-current="true"] ~ .project-add').click()
  await ready()
  await push('A', [delta('并且继续'), done])
  assert.equal(await textCount('新建时仍在生成'), 0)
  await open('A')
  await page.locator('.msg-claude').filter({ hasText: '新建时仍在生成并且继续' }).waitFor()
  console.log('PASS 新建会话不打断原会话,后台完成后仍能切回')

  await app.evaluate(() => { globalThis.sessionFixture.withholdInit = true })
  await page.locator('.project-row[aria-current="true"]').hover()
  await page.locator('.project-row[aria-current="true"] ~ .project-add').click()
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
  compatibilityUpstream.closeAllConnections()
  await new Promise((resolve) => compatibilityUpstream.close(resolve))
}
assert.ok(JSON.parse(readFileSync(REPORT, 'utf8')).every((q) => q.closed))
console.log(`PASS 退出清理所有已打开会话\n测试临时目录:${TEMP}`)
