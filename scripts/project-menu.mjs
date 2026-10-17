/** npm run build && node scripts/project-menu.mjs
 * 真实主进程/桥接/React 的项目菜单回归,独立临时配置,不调用模型。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { _electron as electron } from 'playwright'

const ROOT = resolve(import.meta.dirname, '..')
const TEMP = mkdtempSync(join(tmpdir(), 'claudedeck-projects-'))
const WORKSPACE = join(TEMP, 'project-a')
const OTHER = join(TEMP, 'project-b')
const NAMED = join(TEMP, '含中文的文件夹')
const USER_DATA = join(TEMP, 'user-data')
const CONFIG = join(USER_DATA, 'config.json')
for (const dir of [WORKSPACE, OTHER, NAMED, USER_DATA]) mkdirSync(dir)
writeFileSync(join(WORKSPACE, 'CLAUDE.md'), '# 未保存保护\n')
writeFileSync(join(OTHER, 'keep.txt'), '不能删除')
writeFileSync(CONFIG, JSON.stringify({
  projects: [{ path: WORKSPACE, name: '项目A', collapsed: false },
    { path: OTHER, name: '项目B', collapsed: false }], activeWorkspace: WORKSPACE,
}))
const ENTRY = join(TEMP, 'main.cjs')
await build({
  entryPoints: [join(ROOT, 'src/main/index.ts')], outfile: ENTRY,
  bundle: true, platform: 'node', format: 'cjs', packages: 'external',
  define: { 'import.meta.url': JSON.stringify(pathToFileURL(ENTRY).href) },
  banner: { js: `require = require('node:module').createRequire(${JSON.stringify(join(ROOT, 'package.json'))});` },
  plugins: [{ name: 'project-fixtures', setup(builder) {
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
  } }],
})
const server = await createServer({
  configFile: false, root: join(ROOT, 'src/renderer'), plugins: [react()],
  server: { host: '127.0.0.1', port: 0, fs: { allow: [ROOT] } },
})
let app
try {
  await server.listen()
  const launch = () => electron.launch({
    args: [ENTRY, `--user-data-dir=${USER_DATA}`], cwd: ROOT,
    env: { ...process.env, ELECTRON_RENDERER_URL: `http://127.0.0.1:${server.httpServer.address().port}`,
      CLAUDEDECK_TEST_REPORT: join(TEMP, 'closed.json'), CLAUDEDECK_TEST_WORKSPACE: WORKSPACE },
  })
  app = await launch()
  let page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  // 按显示名称定位,避免 Windows 路径的 CSS 转义歧义。
  const project = (name) => page.locator('.project-row').filter({ hasText: name })
  const ready = () => page.waitForFunction(() =>
    document.querySelector('.composer-wrap')?.getAttribute('aria-busy') === 'false')
  const openCreator = async () => {
    await page.locator('.group-head').hover()
    await page.getByTitle('添加项目', { exact: true }).click()
  }
  const waitActionOpacity = (selector, value) => page.waitForFunction(({ selector, value }) =>
    getComputedStyle(document.querySelector(selector)).opacity === value, { selector, value })
  const menu = () => page.locator('.project-menu')
  const openMenu = async (name) => {
    await project(name).click({ button: 'right' })
    await menu().waitFor()
  }
  await project('项目A').waitFor()
  await ready()
  assert.equal(await page.locator('.sidebar-brand button').count(), 0)
  assert.equal(await page.locator('.sidebar-brand .brand').innerText(), 'ClaudeDeck')
  assert.equal(await page.locator('.project-add').count(), 2)
  await page.locator('.composer textarea').fill('只清空当前项目的新会话草稿')
  await project('项目A').hover()
  await page.getByTitle('在 项目A 里新建会话', { exact: true }).click()
  await ready()
  assert.equal(await page.locator('.composer textarea').inputValue(), '')
  assert.equal(await page.locator('.project-row[aria-current="true"] .name').innerText(), '项目A')
  console.log('PASS 品牌行仅显示名称,项目铅笔仍在当前项目新建会话')
  const fileButton = page.getByRole('button', { name: '浏览 项目A 的文件', exact: true })
  const waitOpacity = (value) => page.waitForFunction((value) =>
    getComputedStyle(document.querySelector('.project-files')).opacity === value, value)
  assert.equal(await page.locator('.claude-node').count(), 0)
  assert.equal(await page.locator('.project-files').count(), await page.locator('.project-row').count())
  for (const theme of ['light', 'dark']) {
    for (const sidebarWidth of [200, 264]) {
      await page.evaluate(({ theme, sidebarWidth }) => {
        document.documentElement.dataset.theme = theme
        document.querySelector('.app').style.setProperty('--w-sidebar', `${sidebarWidth}px`)
      }, { theme, sidebarWidth })
      await page.locator('.composer textarea').focus()
      await page.mouse.move(800, 400)
      await waitOpacity('0')
      await waitActionOpacity('.project-add', '0')
      await waitActionOpacity('.project-create-action', '0')
      assert.equal(await page.locator('.project-add').first().evaluate((el) => getComputedStyle(el).pointerEvents), 'none')
      const before = await project('项目A').locator('.name').boundingBox()
      await project('项目A').hover()
      await waitOpacity('1')
      await waitActionOpacity('.project-add', '1')
      const after = await project('项目A').locator('.name').boundingBox()
      assert.deepEqual(after, before, '悬停后项目名位置或宽度改变')
      const fits = await fileButton.evaluate((el) => {
        const file = el.getBoundingClientRect()
        const line = el.parentElement.getBoundingClientRect()
        const add = el.nextElementSibling.getBoundingClientRect()
        return file.left >= line.left && add.right <= line.right && file.right <= add.left
      })
      assert.equal(fits, true)
      const actions = await page.evaluate(() => {
        const create = document.querySelector('.project-create-action').getBoundingClientRect()
        const add = document.querySelector('.project-add').getBoundingClientRect()
        const svg = document.querySelector('.project-add svg')
        return { aligned: create.right === add.right, size: add.width, height: add.height,
          svgSize: svg.getAttribute('width'), pencil: svg.querySelector('path').getAttribute('d').includes('L11 2') }
      })
      assert.deepEqual(actions, { aligned: true, size: 32, height: 32, svgSize: '18', pencil: true })
      if (sidebarWidth === 264) await page.screenshot({ path: join(TEMP, `sidebar-files-${theme}.png`) })
      await page.locator('.group-head').hover()
      await waitActionOpacity('.project-create-action', '1')
      await waitActionOpacity('.project-add', '0')
      assert.equal(await page.locator('.project-create-action svg').getAttribute('width'), '18')
      if (sidebarWidth === 264) await page.screenshot({ path: join(TEMP, `sidebar-add-${theme}.png`) })
    }
  }
  await page.evaluate(() => document.querySelector('.app').style.setProperty('--w-sidebar', '264px'))
  await page.locator('.project-create-action').focus()
  await waitActionOpacity('.project-create-action', '1')
  await page.keyboard.press('Enter')
  await page.getByRole('dialog', { name: '创建项目', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: '创建项目', exact: true }).waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.querySelector('.project-create-action') === document.activeElement &&
    !document.querySelector('.shell')?.hasAttribute('inert'))
  await page.locator('.composer textarea').fill('铅笔键盘新建')
  await page.locator('.project-add').first().focus()
  await waitActionOpacity('.project-add', '1')
  await page.keyboard.press('Enter')
  await ready()
  assert.equal(await page.locator('.composer textarea').inputValue(), '')
  console.log('PASS 添加/铅笔图标悬停或键盘聚焦显示,32px/18px 且右对齐,亮暗窄侧栏无跳动')
  await project('项目A').focus()
  await page.keyboard.press('Tab')
  assert.equal(await fileButton.evaluate((el) => el === document.activeElement), true)
  await page.keyboard.press('Enter')
  await page.locator('.file-row').waitFor()
  assert.equal(await fileButton.getAttribute('aria-pressed'), 'true')
  await page.locator('.composer textarea').focus()
  await page.mouse.move(800, 400)
  await waitOpacity('1')
  await fileButton.click()
  await page.locator('.midcol').waitFor({ state: 'hidden' })
  await project('项目B').click()
  await page.waitForFunction(() => document.querySelectorAll('.project-row')[1].getAttribute('aria-expanded') === 'false')
  assert.equal(await project('项目B').getAttribute('aria-expanded'), 'false')
  await project('项目B').hover()
  await page.getByRole('button', { name: '浏览 项目B 的文件', exact: true }).click()
  await page.locator('.midcol-crumb').filter({ hasText: '项目B' }).waitFor()
  assert.equal(await project('项目B').getAttribute('aria-expanded'), 'false')
  assert.equal(await page.evaluate(() => window.api.config.get().then((c) => c.activeWorkspace)), WORKSPACE)
  await page.locator('.midcol-head button[title="关闭"]').click()
  await project('项目B').click()
  await page.waitForFunction(() => document.querySelectorAll('.project-row')[1].getAttribute('aria-expanded') === 'true')
  await page.locator('.crumb-files').click()
  await page.locator('.file-row').waitFor()
  await page.locator('.midcol-head button[title="关闭"]').click()
  console.log('PASS 文件入口位于项目行,亮暗/窄侧栏无跳动,键盘打开/常显高亮/折叠项目及顶部入口可用')
  const original = await page.evaluate(() => window.api.config.get())
  await openMenu('项目B')
  const after = await page.evaluate(() => window.api.config.get())
  assert.deepEqual(after, original)
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '移除项目')
  await page.keyboard.press('Escape')
  assert.equal(await project('项目B').evaluate((el) => el === document.activeElement), true)
  await project('项目B').press('Shift+F10')
  await menu().getByRole('menuitem', { name: '编辑项目' }).click()
  assert.equal(await page.locator('#project-path').inputValue(), OTHER)
  assert.equal(await page.locator('#project-path').getAttribute('readonly'), '')
  await page.locator('#project-name').fill('   ')
  assert.equal(await menu().getByRole('button', { name: '保存', exact: true }).isDisabled(), true)
  await page.locator('#project-name').fill('  中文项目 B  ')
  await menu().getByRole('button', { name: '保存', exact: true }).click()
  await project('中文项目 B').waitFor()
  const stored = JSON.parse(readFileSync(CONFIG, 'utf8'))
  assert.deepEqual(stored.projects[1], { ...original.projects[1], name: '中文项目 B' })
  assert.equal(stored.activeWorkspace, WORKSPACE)
  for (const args of [[OTHER, ''], [OTHER, 12], [123, '名称'], [join(TEMP, 'unknown'), '名称']]) {
    const rejected = await page.evaluate(async ([path, name]) => {
      try { await window.api.projects.rename(path, name); return false } catch { return true }
    }, args)
    assert.equal(rejected, true)
  }
  assert.deepEqual(JSON.parse(readFileSync(CONFIG, 'utf8')), stored)
  console.log('PASS 右键不切换/折叠,键盘导航与焦点,空白/非法参数校验,名称保存不改目录')

  await app.close()
  app = await launch()
  page = await app.firstWindow()
  page.on('pageerror', (err) => errors.push(err.message))
  await project('中文项目 B').waitFor()
  await ready()
  assert.equal(await page.evaluate(() => window.api.config.get().then((c) => c.projects[1].name)), '中文项目 B')
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async (theme) => { await window.api.config.update({ theme });
      document.documentElement.dataset.theme = theme }, theme)
    for (const width of [940, 1200, 1600]) {
      await page.setViewportSize({ width, height: 800 })
      await page.locator('.project-row').first().evaluate((el) => el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: innerWidth - 1, clientY: innerHeight - 1,
      })))
      await menu().waitFor()
      await menu().getByRole('menuitem', { name: '编辑项目' }).click()
      const bounds = await menu().evaluate((el) => {
        const r = el.getBoundingClientRect()
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
          width: innerWidth, height: innerHeight, style: el.getAttribute('style') }
      })
      const inside = bounds.left >= 7.5 && bounds.top >= 7.5 && bounds.right <= bounds.width - 7.5
        && bounds.bottom <= bounds.height - 7.5 && bounds.left > bounds.width / 2 && bounds.top > bounds.height / 2
      assert.equal(inside, true, `${theme} ${width}px 菜单未贴近右下角或溢出:${JSON.stringify(bounds)}`)
      if (width === 1200) await page.screenshot({ path: join(TEMP, `project-edit-${theme}.png`) })
      await page.keyboard.press('Escape')
    }
  }
  await page.setViewportSize({ width: 1200, height: 800 })
  console.log('PASS 重启后名称持久化,亮暗主题与窗口边缘不裁切')

  await page.locator('.session-row[title="测试会话A"]').click()
  await ready()
  await page.locator('.composer textarea').fill('A持续运行')
  await page.locator('.composer [data-state="send"]').click()
  await page.locator('.session-row[title="测试会话C"]').click()
  await ready()
  await page.locator('.composer textarea').fill('C持续运行')
  await page.locator('.composer [data-state="send"]').click()
  await page.locator('.session-row[title="测试会话A"]').click()
  await ready()
  await page.locator('.composer textarea').fill('保留输入草稿')
  const creator = () => page.getByRole('dialog', { name: '创建项目', exact: true })
  const instanceCount = () => app.evaluate(() => globalThis.sessionFixture.instances.length)
  const beforeCreate = await instanceCount()
  const beforeConfig = readFileSync(CONFIG, 'utf8')
  assert.equal(await page.getByTitle('管理项目', { exact: true }).count(), 0)
  await page.evaluate(() => { globalThis.originalComposer = document.querySelector('.composer textarea') })
  for (const closeBy of ['button', 'escape', 'backdrop', 'cancel']) {
    await openCreator()
    await creator().waitFor()
    assert.equal(await page.locator('.shell').getAttribute('inert'), '')
    assert.equal(await creator().getByRole('textbox', { name: '项目名称' }).evaluate((el) => el === document.activeElement), true)
    assert.equal(await creator().getByRole('button', { name: '创建项目', exact: true }).isDisabled(), true)
    await creator().getByRole('button', { name: '关闭创建项目' }).focus()
    await page.keyboard.press('Shift+Tab')
    assert.equal(await creator().getByRole('button', { name: '取消', exact: true }).evaluate((el) => el === document.activeElement), true)
    await page.keyboard.press('Tab')
    assert.equal(await creator().getByRole('button', { name: '关闭创建项目' }).evaluate((el) => el === document.activeElement), true)
    await app.evaluate(() => globalThis.sessionFixture.instances.findLast((q) => q.id === 'A' && !q.closed).push({
      type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '创建弹窗中继续输出' } },
    }))
    await page.locator('.msg-claude').filter({ hasText: '创建弹窗中继续输出' }).waitFor()
    if (closeBy === 'button') {
      for (const theme of ['light', 'dark']) {
        await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
        for (const width of [375, 940, 1200, 1600]) {
          await page.setViewportSize({ width, height: 800 })
          const bounds = await creator().boundingBox()
          assert.equal(bounds.x >= 0 && bounds.x + bounds.width <= width, true)
          if (width === 1200) await page.screenshot({ path: join(TEMP, `project-create-${theme}.png`) })
        }
      }
      await page.setViewportSize({ width: 1200, height: 800 })
    }
    if (closeBy === 'button') await creator().getByRole('button', { name: '关闭创建项目' }).click()
    else if (closeBy === 'escape') await page.keyboard.press('Escape')
    else if (closeBy === 'backdrop') await page.locator('.project-create').click({ position: { x: 5, y: 100 } })
    else await creator().getByRole('button', { name: '取消', exact: true }).click()
    await creator().waitFor({ state: 'hidden' })
    assert.equal(await page.locator('.composer textarea').inputValue(), '保留输入草稿')
    assert.equal(await page.evaluate(() => globalThis.originalComposer === document.querySelector('.composer textarea')), true)
    assert.equal(await page.locator('.session-row[aria-current="true"]').getAttribute('title'), '测试会话A')
    assert.equal(await instanceCount(), beforeCreate)
    await page.waitForFunction(() => document.querySelector('.group-head button[title="添加项目"]') === document.activeElement)
    assert.equal(readFileSync(CONFIG, 'utf8'), beforeConfig)
  }
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }) })
  await openCreator()
  await creator().getByRole('textbox').fill('新项目')
  await creator().getByRole('button', { name: '添加', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.project-create .card')?.getAttribute('aria-busy') === 'false')
  assert.equal(await creator().getByRole('textbox').inputValue(), '新项目')
  assert.equal(await creator().getByRole('button', { name: '创建项目', exact: true }).isDisabled(), true)
  assert.equal(await instanceCount(), beforeCreate)
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, OTHER)
  await creator().getByRole('button', { name: '添加', exact: true }).click()
  await creator().getByText(OTHER, { exact: true }).waitFor()
  assert.equal(readFileSync(CONFIG, 'utf8'), beforeConfig)
  await creator().getByRole('textbox').fill('   ')
  assert.equal(await creator().getByRole('button', { name: '创建项目', exact: true }).isDisabled(), false)
  await creator().getByRole('textbox').fill('重复项目')
  await creator().getByRole('button', { name: '创建项目', exact: true }).click()
  await creator().getByRole('alert').filter({ hasText: '此文件夹已添加' }).waitFor()
  assert.equal(readFileSync(CONFIG, 'utf8'), beforeConfig)
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = () => new Promise((resolve) => { globalThis.resolveFolder = resolve }) })
  await creator().getByRole('button', { name: '更换文件夹', exact: true }).click()
  assert.equal(await creator().getByRole('button', { name: '取消', exact: true }).isDisabled(), true)
  await page.keyboard.press('Escape')
  assert.equal(await creator().count(), 1)
  await app.evaluate(() => globalThis.resolveFolder({ canceled: true, filePaths: [] }))
  await page.waitForFunction(() => document.querySelector('.project-create .card')?.getAttribute('aria-busy') === 'false')
  assert.equal(await creator().getByText(OTHER, { exact: true }).count(), 1)
  assert.equal(await creator().getByRole('textbox').inputValue(), '重复项目')
  await page.keyboard.press('Escape')
  await creator().waitFor({ state: 'hidden' })
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, OTHER)
  assert.equal(await page.evaluate(async () => {
    try { await window.api.projects.create('伪造目录凭证', '非法项目'); return false } catch { return true }
  }), true)
  const selected = await page.evaluate(() => window.api.projects.selectDirectory())
  for (const name of [123, null, {}]) {
    assert.equal(await page.evaluate(async ({ token, name }) => {
      try { await window.api.projects.create(token, name); return false } catch { return true }
    }, { token: selected.token, name }), true)
  }
  await page.evaluate((token) => window.api.projects.discardSelection(token), selected.token)
  assert.equal(await page.evaluate(async (token) => {
    try { await window.api.projects.create(token, '过期项目'); return false } catch { return true }
  }, selected.token), true)
  assert.equal(readFileSync(CONFIG, 'utf8'), beforeConfig)
  console.log('PASS 创建弹窗关闭/取消/键盘焦点,亮暗与窄窗口,后台输出/草稿保留,选择不登记,必填/重复/凭证校验和忙碌保护')
  await openMenu('中文项目 B')
  await menu().getByRole('menuitem', { name: '移除项目' }).click()
  assert.equal(await menu().getByText('只从项目列表移除', { exact: false }).count(), 1)
  await menu().getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await project('中文项目 B').count(), 1)
  await openMenu('中文项目 B')
  await menu().getByRole('menuitem', { name: '移除项目' }).click()
  await menu().getByRole('button', { name: '移除', exact: true }).click()
  await project('中文项目 B').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.composer textarea').inputValue(), '保留输入草稿')
  assert.equal(await page.locator('.session-row[aria-current="true"]').getAttribute('title'), '测试会话A')
  const stats = await app.evaluate(() => globalThis.sessionFixture.instances.map((q) => ({ id: q.id, closed: q.closed })))
  assert.equal(stats.findLast((q) => q.id === 'A').closed, false)
  assert.equal(stats.findLast((q) => q.id === 'C').closed, true)
  await app.evaluate(() => globalThis.sessionFixture.instances.findLast((q) => q.id === 'A' && !q.closed).push({
    type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '移除其他项目后A仍在输出' } },
  }))
  await page.locator('.msg-claude').filter({ hasText: '移除其他项目后A仍在输出' }).waitFor()
  assert.equal(readFileSync(join(OTHER, 'keep.txt'), 'utf8'), '不能删除')
  console.log('PASS 取消不移除,移除非当前项目保留当前对话/草稿,仅清理目标会话,目录保留')

  // 模拟系统目录选择,重新登记相同目录,历史仍可见。
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, OTHER)
  await openCreator()
  assert.equal(await creator().getByRole('textbox').inputValue(), '')
  await creator().getByRole('button', { name: '添加', exact: true }).click()
  await creator().getByText(OTHER, { exact: true }).waitFor()
  assert.equal(await creator().getByRole('button', { name: '创建项目', exact: true }).isDisabled(), false)
  const countBeforeCreate = JSON.parse(readFileSync(CONFIG, 'utf8')).projects.length
  await creator().getByRole('button', { name: '创建项目', exact: true }).click()
  await creator().waitFor({ state: 'hidden' })
  await project('project-b').waitFor()
  assert.equal(JSON.parse(readFileSync(CONFIG, 'utf8')).projects.length, countBeforeCreate + 1)
  assert.equal(JSON.parse(readFileSync(CONFIG, 'utf8')).projects.find((p) => p.path === OTHER).name, 'project-b')
  await page.locator('.session-row[title="测试会话C"]').waitFor()
  await page.locator('.session-row[title="测试会话A"]').click()
  await ready()
  await project('项目A').hover()
  await page.getByTitle('浏览 项目A 的文件').click()
  await page.locator('.file-row').filter({ hasText: 'CLAUDE.md' }).click()
  await page.getByRole('button', { name: '编辑源码', exact: true }).click()
  await page.locator('.midcol textarea').fill('# 不可丢弃的草稿')
  await page.evaluate(() => { globalThis.originalFile = document.querySelector('.midcol textarea') })
  await openCreator()
  await page.keyboard.press('Escape')
  await creator().waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => globalThis.originalFile === document.querySelector('.midcol textarea')), true)
  assert.equal(await page.locator('.midcol textarea').inputValue(), '# 不可丢弃的草稿')
  await openMenu('项目A')
  await menu().getByRole('menuitem', { name: '移除项目' }).click()
  await menu().getByRole('button', { name: '移除', exact: true }).click()
  await menu().getByRole('alert').waitFor()
  assert.equal(await project('项目A').count(), 1)
  assert.equal(await page.locator('.midcol textarea').inputValue(), '# 不可丢弃的草稿')
  await page.keyboard.press('Escape')
  await page.locator('.midcol-head button[title="关闭"]').click()
  await page.getByRole('button', { name: '不保存', exact: true }).click()
  console.log('PASS 未保存文件阻止移除并保留草稿,重新登记目录后历史仍可见')

  await openMenu('项目A')
  await menu().getByRole('menuitem', { name: '移除项目' }).click()
  await menu().getByRole('button', { name: '移除', exact: true }).click()
  await project('项目A').waitFor({ state: 'hidden' })
  await ready()
  assert.equal(await page.evaluate(() => window.api.config.get().then((c) => c.activeWorkspace)), OTHER)
  assert.equal(await page.locator('.session-row[aria-current="true"]').count(), 0)
  await openMenu('project-b')
  await menu().getByRole('menuitem', { name: '移除项目' }).click()
  await menu().getByRole('button', { name: '移除', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.sidebar') && !document.querySelector('.composer'))
  assert.deepEqual(await page.evaluate(() => window.api.config.get().then((c) => c.projects)), [])
  assert.equal(await creator().count(), 0)
  assert.equal(await page.getByRole('button', { name: '＋ 添加项目…', exact: true }).count(), 1)
  assert.equal(existsSync(join(WORKSPACE, 'CLAUDE.md')), true)
  await page.getByRole('button', { name: '＋ 添加项目…', exact: true }).click()
  await creator().waitFor()
  await creator().getByRole('button', { name: '取消', exact: true }).click()
  await creator().waitFor({ state: 'hidden' })
  assert.deepEqual(await page.evaluate(() => window.api.config.get().then((c) => c.projects)), [])
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, WORKSPACE)
  await page.getByRole('button', { name: '＋ 添加项目…', exact: true }).click()
  await creator().getByRole('textbox').fill('   ')
  await creator().getByRole('button', { name: '添加', exact: true }).click()
  await creator().getByText(WORKSPACE, { exact: true }).waitFor()
  await creator().getByRole('button', { name: '创建项目', exact: true }).click()
  await project('project-a').waitFor()
  await ready()
  assert.equal(JSON.parse(readFileSync(CONFIG, 'utf8')).projects[0].name, 'project-a')
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, WORKSPACE)
  await openCreator()
  await creator().getByRole('button', { name: '添加', exact: true }).click()
  await creator().getByText(WORKSPACE, { exact: true }).waitFor()
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, NAMED)
  await creator().getByRole('button', { name: '更换文件夹', exact: true }).click()
  await creator().getByText(NAMED, { exact: true }).waitFor()
  assert.equal(await creator().getByRole('textbox').inputValue(), '')
  await creator().getByRole('button', { name: '创建项目', exact: true }).click()
  await project('含中文的文件夹').waitFor()
  await ready()
  assert.equal(JSON.parse(readFileSync(CONFIG, 'utf8')).projects.find((p) => p.path === NAMED).name, '含中文的文件夹')
  await openMenu('含中文的文件夹')
  await menu().getByRole('menuitem', { name: '移除项目' }).click()
  await menu().getByRole('button', { name: '移除', exact: true }).click()
  await project('含中文的文件夹').waitFor({ state: 'hidden' })
  await ready()
  await openCreator()
  await creator().getByRole('textbox').fill('  自定义项目名  ')
  await creator().getByRole('button', { name: '添加', exact: true }).click()
  await creator().getByText(NAMED, { exact: true }).waitFor()
  await creator().getByRole('button', { name: '创建项目', exact: true }).click()
  await project('自定义项目名').waitFor()
  await ready()
  assert.equal(JSON.parse(readFileSync(CONFIG, 'utf8')).projects.find((p) => p.path === NAMED).name, '自定义项目名')
  console.log('PASS 名称留空/仅空白使用文件夹名,更换目录使用新名称,中文目录与自定义名称保存正确')
  assert.deepEqual(errors, [])
  console.log('PASS 当前项目移除切到剩余项目的新会话,最后一个移除返回选择页,无渲染错误')
  console.log(`截图与测试数据: ${TEMP}`)
} finally {
  await app?.close()
  await server.close()
}
