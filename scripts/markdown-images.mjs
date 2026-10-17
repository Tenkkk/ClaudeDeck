/** npm run build && node scripts/markdown-images.mjs
 * 隔离项目、真实 IPC/React、模拟 SDK;不使用真实凭据或第三方图片。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, openSync, ftruncateSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { _electron as electron } from 'playwright'

const ROOT = resolve(import.meta.dirname, '..')
const TEMP = mkdtempSync(join(tmpdir(), 'claudedeck-markdown-images-'))
const WORKSPACE = join(TEMP, 'project')
const OTHER = join(TEMP, 'outside')
const USER_DATA = join(TEMP, 'user-data')
const reader = await build({ entryPoints: [join(ROOT, 'src/main/markdown-image.ts')], bundle: true,
  platform: 'node', format: 'esm', write: false })
const { readMarkdownImage, loadImageForAction } = await import(`data:text/javascript;base64,${Buffer.from(reader.outputFiles[0].text).toString('base64')}`)
for (const dir of [WORKSPACE, OTHER, USER_DATA, join(WORKSPACE, 'docs')]) mkdirSync(dir, { recursive: true })
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGN4dmfffwAIrAOAylaYlgAAAABJRU5ErkJggg==', 'base64')
const previewPng = process.argv[2] ? readFileSync(resolve(process.argv[2])) : png
writeFileSync(join(WORKSPACE, '猫 (1).png'), previewPng)
writeFileSync(join(WORKSPACE, 'docs', 'cat.png'), png)
writeFileSync(join(OTHER, 'cat.png'), png)
writeFileSync(join(WORKSPACE, 'fake.png'), '不是图片')
writeFileSync(join(WORKSPACE, 'bad.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
writeFileSync(join(WORKSPACE, 'docs', 'README.md'), '![文档图片](cat.png)')
const large = openSync(join(WORKSPACE, 'large.png'), 'w')
ftruncateSync(large, 20 * 1024 * 1024 + 1)
closeSync(large)
symlinkSync(OTHER, join(WORKSPACE, 'outside-link'), 'junction')
assert.equal((await loadImageForAction(WORKSPACE, `data:image/png;base64,${png.toString('base64')}`)).name, 'image.png')
await assert.rejects(loadImageForAction(WORKSPACE, 'data:image/svg+xml;base64,PHN2Zz4='))
const actualFetch = globalThis.fetch
try {
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'file:///C:/private.png' } })
  await assert.rejects(loadImageForAction(WORKSPACE, 'https://fixture.invalid/cat.png'), /HTTPS/)
  globalThis.fetch = async () => new Response(png, { headers: { 'content-length': String(21 * 1024 * 1024) } })
  await assert.rejects(loadImageForAction(WORKSPACE, 'https://fixture.invalid/cat.png'), /20MB/)
  await assert.rejects(loadImageForAction(WORKSPACE, 'https://user:password@fixture.invalid/cat.png'), /HTTPS/)
} finally { globalThis.fetch = actualFetch }
for (const source of ['docs/cat.png', join(WORKSPACE, '猫 (1).png'), pathToFileURL(join(WORKSPACE, '猫 (1).png')).href]) {
  const result = await readMarkdownImage(WORKSPACE, source)
  assert.equal(result.ok, true, source)
  assert.equal(result.src, `data:image/png;base64,${(source === 'docs/cat.png' ? png : previewPng).toString('base64')}`)
}
for (const [source, reason] of [
  ['../outside/cat.png', 'out-of-scope'], [join(OTHER, 'cat.png'), 'out-of-scope'],
  ['%2e%2e/outside/cat.png', 'out-of-scope'], ['outside-link/cat.png', 'out-of-scope'],
  ['file://server/share/cat.png', 'out-of-scope'], ['\\\\server\\share\\cat.png', 'out-of-scope'],
  ['docs/cat.png:secret', 'out-of-scope'], ['fake.png', 'unsupported'], ['large.png', 'too-large'],
  ['missing.png', 'not-found'], ['javascript:alert(1)', 'unsupported'], ['docs', 'unsupported'],
]) assert.deepEqual(await readMarkdownImage(WORKSPACE, source), { ok: false, reason }, source)

writeFileSync(join(USER_DATA, 'config.json'), JSON.stringify({
  projects: [{ path: WORKSPACE, name: '图片测试', collapsed: false }], activeWorkspace: WORKSPACE,
}))
const ENTRY = join(TEMP, 'main.cjs')
await build({
  entryPoints: [join(ROOT, 'src/main/index.ts')], outfile: ENTRY,
  bundle: true, platform: 'node', format: 'cjs', packages: 'external',
  define: { 'import.meta.url': JSON.stringify(pathToFileURL(ENTRY).href) },
  banner: { js: `require = require('node:module').createRequire(${JSON.stringify(join(ROOT, 'package.json'))});` },
  plugins: [{ name: 'image-fixtures', setup(builder) {
    builder.onResolve({ filter: /^@anthropic-ai\/claude-agent-sdk$/ }, () => ({ path: join(ROOT, 'scripts/fixtures/session-sdk.mjs') }))
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
const server = await createServer({ configFile: false, root: join(ROOT, 'src/renderer'), plugins: [react()],
  server: { host: '127.0.0.1', port: 0, fs: { allow: [ROOT] } },
})
let app
try {
  await server.listen()
  app = await electron.launch({ args: [ENTRY, `--user-data-dir=${USER_DATA}`], cwd: ROOT,
    env: { ...process.env, ELECTRON_RENDERER_URL: `http://127.0.0.1:${server.httpServer.address().port}`,
      CLAUDEDECK_TEST_WORKSPACE: WORKSPACE, CLAUDEDECK_TEST_REPORT: join(TEMP, 'closed.json') },
  })
  const page = await app.firstWindow()
  await app.evaluate(({ clipboard, dialog, shell, nativeImage }, { temp }) => {
    const networkImage = nativeImage.createFromBitmap(Buffer.from([230, 220, 190, 255]), { width: 1, height: 1 }).toPNG()
    const fixture = globalThis.imageSystemFixture = { copies: [], reveals: [], saves: [],
      savePath: `${temp}/copy.png`, canceled: false, failCopy: false, network: [] }
    clipboard.writeImage = (bitmap) => {
      if (fixture.failCopy) throw new Error('模拟剪贴板不可用')
      fixture.copies.push(bitmap.getSize())
    }
    shell.showItemInFolder = (path) => fixture.reveals.push(path)
    dialog.showSaveDialog = async (options) => {
      fixture.saves.push(options)
      return { canceled: fixture.canceled, filePath: fixture.savePath }
    }
    globalThis.fetch = async (url, options) => {
      fixture.network.push({ url: String(url), credentials: options.credentials, headers: options.headers })
      return new Response(networkImage, { headers: { 'content-type': 'image/png' } })
    }
  }, { temp: TEMP })
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.waitForFunction(() => document.querySelector('.composer-wrap')?.getAttribute('aria-busy') === 'false')
  assert.deepEqual(await page.evaluate((project) => window.api.files.image(project, 'cat.png'), OTHER), { ok: false, reason: 'out-of-scope' })
  const reply = `生成好了。\n\n![生成结果](<${join(WORKSPACE, '猫 (1).png')}>)\n\n` +
    '![不存在](missing.png)\n\n![损坏](bad.png)\n\n![网络图片](https://fixture.invalid/cat.png)'
  await app.evaluate((_electron, reply) => {
    globalThis.sessionFixture.history = { A: [{ uuid: 'reply', message: { role: 'assistant', content: reply } }] }
  }, reply)
  let networkRequests = 0
  await page.route('https://fixture.invalid/**', (route) => {
    networkRequests++
    assert.equal(route.request().headers().referer, undefined)
    return route.fulfill({ contentType: 'image/png', body: png })
  })
  await page.locator('.session-row[title="测试会话A"]').click()
  const image = page.getByRole('button', { name: '放大图片:生成结果', exact: true })
  await image.waitFor()
  assert.equal(await image.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0), true)
  await page.getByText('不存在 · 图片不存在或无法读取。', { exact: true }).waitFor()
  await page.getByText('损坏 · 图片加载失败,文件可能已损坏或网络地址不可用。', { exact: true }).waitFor()
  assert.equal(networkRequests, 0)
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
    for (const width of [375, 940, 1200, 1600]) {
      await page.setViewportSize({ width, height: 800 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
      assert.equal(await image.evaluate((button) => {
        const img = button.querySelector('img')
        const rect = img.getBoundingClientRect()
        return rect.width <= button.closest('.md').getBoundingClientRect().width && rect.height <= 420
      }), true)
    }
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.locator('.transcript').evaluate((element) => { element.scrollTop = 0 })
    await page.screenshot({ path: join(TEMP, `${theme}.png`) })
  }
  await image.focus()
  await page.keyboard.press('Enter')
  const preview = page.getByRole('dialog', { name: '图片预览:生成结果', exact: true })
  await preview.waitFor()
  const close = preview.getByRole('button', { name: '关闭图片预览' })
  assert.equal(await close.evaluate((el) => el === document.activeElement), true)
  await page.keyboard.press('Tab')
  assert.equal(await preview.getByRole('button', { name: '图片操作', exact: true }).evaluate((el) => el === document.activeElement), true)
  await page.keyboard.press('Tab')
  assert.equal(await preview.getByRole('combobox', { name: '图片缩放' }).evaluate((el) => el === document.activeElement), true)
  // 查看器铺满窗口;适应模式不滚动,100%/200% 只允许画布滚动。
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
    for (const width of [375, 940, 1600]) {
      await page.setViewportSize({ width, height: 800 })
      await page.waitForFunction(() => {
        const canvas = document.querySelector('.image-viewer-canvas')
        return canvas && canvas.scrollWidth <= canvas.clientWidth
      }, undefined, { timeout: 1000 }).catch(async (err) => {
        console.log(await preview.evaluate((dialog) => {
          const canvas = dialog.querySelector('.image-viewer-canvas'), img = canvas.querySelector('img')
          return { viewport: window.innerWidth, client: [canvas.clientWidth, canvas.clientHeight], scroll: [canvas.scrollWidth, canvas.scrollHeight], image: img.style.cssText }
        }))
        throw err
      })
      const geometry = await preview.evaluate((dialog) => ({ width: dialog.getBoundingClientRect().width,
        window: window.innerWidth, overflow: dialog.scrollWidth > dialog.clientWidth,
        canvasOverflow: dialog.querySelector('.image-viewer-canvas').scrollWidth > dialog.querySelector('.image-viewer-canvas').clientWidth,
        canvasWidth: dialog.querySelector('.image-viewer-canvas').clientWidth,
        scrollWidth: dialog.querySelector('.image-viewer-canvas').scrollWidth,
        imageWidth: dialog.querySelector('.image-viewer-canvas img').getBoundingClientRect().width }))
      assert.ok(Math.abs(geometry.width - geometry.window) <= 0.5, '允许 Windows DPI 的亚像素舍入')
      assert.equal(geometry.overflow, false)
      assert.equal(geometry.canvasOverflow, false, JSON.stringify(geometry))
      await preview.getByRole('combobox', { name: '图片缩放' }).selectOption('2')
      assert.equal(await preview.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth), true)
      await preview.getByRole('combobox', { name: '图片缩放' }).selectOption('fit')
    }
    await page.setViewportSize({ width: 1200, height: 800 })
    await preview.getByRole('button', { name: '图片操作', exact: true }).click()
    const menu = preview.getByRole('menu', { name: '图片操作菜单' })
    await menu.waitFor()
    assert.equal(await menu.getByRole('menuitem').count(), 4)
    const menuBounds = await menu.boundingBox()
    assert.ok(menuBounds.x >= 8 && menuBounds.x + menuBounds.width <= 1192.5)
    await page.screenshot({ path: join(TEMP, `viewer-${theme}.png`) })
    await page.keyboard.press('End')
    assert.equal(await menu.getByRole('menuitem', { name: '下载副本', exact: true }).evaluate((el) => el === document.activeElement), true)
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'detached' })
    assert.equal(await preview.isVisible(), true, '菜单 Esc 不关闭查看器')
  }
  await page.keyboard.press('Escape')
  await preview.waitFor({ state: 'detached' })
  assert.equal(await image.evaluate((el) => el === document.activeElement), true)
  await image.click()
  await close.click()
  await preview.waitFor({ state: 'detached' })
  await image.click()
  await preview.locator('.image-viewer-canvas').click({ position: { x: 4, y: 4 } })
  await preview.waitFor({ state: 'detached' })
  const stage = image.locator('..')
  async function inlineAction(name) {
    await stage.getByRole('button', { name: '图片操作', exact: true }).click()
    await stage.getByRole('menuitem', { name, exact: true }).click()
  }
  await inlineAction('复制图片')
  await page.getByRole('status').filter({ hasText: '图片已复制。' }).waitFor()
  assert.equal(await app.evaluate(() => globalThis.imageSystemFixture.copies.length), 1)
  await inlineAction('从资源管理器打开')
  await page.getByRole('status').filter({ hasText: '已在资源管理器中定位。' }).waitFor()
  assert.equal(await app.evaluate(() => globalThis.imageSystemFixture.reveals[0]), join(WORKSPACE, '猫 (1).png'))
  await inlineAction('下载副本')
  await page.getByRole('status').filter({ hasText: '图片副本已保存。' }).waitFor()
  assert.deepEqual(readFileSync(join(TEMP, 'copy.png')), previewPng)
  await app.evaluate(() => { globalThis.imageSystemFixture.canceled = true })
  await inlineAction('下载副本')
  await stage.getByRole('button', { name: '图片操作', exact: true }).waitFor()
  await page.waitForFunction(() => !document.querySelector('.md-image-stage .image-control').disabled)
  assert.deepEqual(readFileSync(join(TEMP, 'copy.png')), previewPng)
  await app.evaluate((_electron, path) => { globalThis.imageSystemFixture.canceled = false; globalThis.imageSystemFixture.savePath = path }, join(WORKSPACE, '猫 (1).png'))
  await inlineAction('下载副本')
  await page.getByRole('alert').filter({ hasText: '不能覆盖原图' }).waitFor()
  assert.deepEqual(readFileSync(join(WORKSPACE, '猫 (1).png')), previewPng)
  await app.evaluate(() => { globalThis.imageSystemFixture.failCopy = true })
  await inlineAction('复制图片')
  await page.getByRole('alert').filter({ hasText: '模拟剪贴板不可用' }).waitFor()
  await app.evaluate(() => { globalThis.imageSystemFixture.failCopy = false })
  await page.locator('.composer textarea').fill('保留我的输入')
  await image.click()
  await preview.getByRole('button', { name: '图片操作', exact: true }).click()
  await preview.getByRole('menuitem', { name: '添加到聊天', exact: true }).click()
  await preview.waitFor({ state: 'detached' })
  await page.locator('.attachment-card').waitFor()
  assert.equal(await page.locator('.composer textarea').inputValue(), '保留我的输入')
  assert.equal(await app.evaluate(() => globalThis.sessionFixture.instances.findLast((q) => q.id === 'A').messages.length), 0)
  await page.getByRole('button', { name: '加载网络图片 · 网络图片', exact: true }).click()
  await page.getByRole('button', { name: '放大图片:网络图片', exact: true }).waitFor()
  assert.equal(networkRequests, 1)
  const remoteStage = page.getByRole('button', { name: '放大图片:网络图片', exact: true }).locator('..')
  await remoteStage.getByRole('button', { name: '图片操作', exact: true }).click()
  assert.equal(await remoteStage.getByRole('menuitem', { name: '从资源管理器打开', exact: true }).isDisabled(), true)
  await remoteStage.getByRole('menuitem', { name: '复制图片', exact: true }).click()
  await remoteStage.locator('.image-action-note').waitFor()
  assert.equal(await remoteStage.locator('.image-action-note').innerText(), '图片已复制。')
  assert.deepEqual(await app.evaluate(() => globalThis.imageSystemFixture.network.map(({ credentials, headers }) => ({ credentials, headers }))),
    [{ credentials: 'omit', headers: undefined }])
  assert.equal(await app.evaluate(() => globalThis.imageSystemFixture.copies.length), 2)
  await assert.rejects(page.evaluate(({ project, bytes }) => window.api.files.imageAttach(project, `data:image/png;base64,${bytes}`),
    { project: WORKSPACE, bytes: Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]).toString('base64') }), /5MB/)
  await page.locator('.crumb-files').click()
  await page.getByText('docs', { exact: true }).click()
  await page.getByText('README.md', { exact: true }).click()
  await page.getByRole('button', { name: '放大图片:文档图片', exact: true }).waitFor()
  await page.locator('.midcol-head button[title="关闭"]').click()
  const deferred = await page.evaluate(({ project, bytes }) => window.api.attachments.add(project, '延迟图片.png', Uint8Array.from(bytes)),
    { project: WORKSPACE, bytes: Array.from(png) })
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('files:imageAttach')
    ipcMain.handle('files:imageAttach', () => new Promise((resolve) => { globalThis.finishImageAttach = resolve }))
  })
  await inlineAction('添加到聊天')
  await page.getByText('正在处理…', { exact: true }).waitFor()
  await page.locator('.session-row[title="测试会话B"]').click()
  await page.getByText('历史B', { exact: true }).waitFor()
  await app.evaluate((_electron, attachment) => globalThis.finishImageAttach(attachment), deferred)
  assert.equal(await page.locator('.attachment-card').count(), 0, '切换后不能把图片塞到 B 的输入框')
  await page.locator('.session-row[title="测试会话A"]').click()
  await page.getByText('延迟图片.png', { exact: true }).waitFor()
  assert.equal(await page.locator('.attachment-card').count(), 2)
  assert.equal(await page.locator('.composer textarea').inputValue(), '保留我的输入')
  const delta = (text) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } })
  await app.evaluate((_electron, message) => globalThis.sessionFixture.instances.findLast((q) => q.id === 'A').push(message), delta('![流式图片](docs/cat.png'))
  assert.equal(await page.getByRole('button', { name: '放大图片:流式图片', exact: true }).count(), 0)
  await app.evaluate((_electron, message) => globalThis.sessionFixture.instances.findLast((q) => q.id === 'A').push(message), delta(')'))
  await page.getByRole('button', { name: '放大图片:流式图片', exact: true }).waitFor()
  // 延迟本地读取时切走,晚到的响应不能挂到下一会话上。
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('files:image')
    ipcMain.handle('files:image', () => new Promise((resolve) => { globalThis.finishImage = resolve }))
    globalThis.sessionFixture.history.slow = [{ uuid: 'slow-image', message: { role: 'assistant', content: '![延迟图片](docs/cat.png)' } }]
  })
  await page.locator('.session-row[title="测试会话slow"]').click()
  await page.getByRole('status').filter({ hasText: '正在加载图片 · 延迟图片' }).waitFor()
  await page.locator('.session-row[title="测试会话B"]').click()
  await page.getByText('历史B', { exact: true }).waitFor()
  await app.evaluate((_electron, src) => globalThis.finishImage({ ok: true, src }), `data:image/png;base64,${png.toString('base64')}`)
  assert.equal(await page.getByRole('button', { name: '放大图片:延迟图片', exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(`PASS 图片解析与安全/全窗预览缩放与亮暗/菜单键盘/复制定位另存/取消与原图保护/添加不发送与草稿隔离/网络确认/流式与文档引用\n截图:${TEMP}`)
} finally {
  await app?.close()
  await server.close()
}
