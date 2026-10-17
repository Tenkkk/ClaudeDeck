/** 右侧文件区隔离回归:真实 Electron/React/文件读写,模拟 SDK,不调用模型。 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { _electron as electron } from 'playwright'

const ROOT = resolve(import.meta.dirname, '..')
const TEMP = mkdtempSync(join(tmpdir(), 'claudedeck-files-'))
const WORKSPACE = join(TEMP, 'project')
const USER_DATA = join(TEMP, 'user-data')
for (const dir of [WORKSPACE, USER_DATA, join(WORKSPACE, '.claude')]) mkdirSync(dir)
const longWord = 'long_file_path_segment_'.repeat(90)
const source = `# 文件阅读验收\n\n**重点内容**与中文正文。文件在右侧独立展示,对话保留在中间。\n\n## 阅读与编辑\n\n- 文档默认预览,长段落自动换行。\n- 切换源码可核对原文,可写文件仍需手动保存。\n- 放大阅读不会中断正在执行的会话。\n\n## 示例代码\n\n\`\`\`js\nconst path = '${longWord}'\n\`\`\`\n\n## 长路径验收\n\n${longWord}\n\n${'普通阅读段落。\n\n'.repeat(30)}`
writeFileSync(join(WORKSPACE, 'AGENTS.md'), source)
writeFileSync(join(WORKSPACE, 'CLAUDE.md'), '# 可编辑文档\n')
writeFileSync(join(WORKSPACE, '.claude/settings.json'), '{"permissions":{"allow":[]}}\n')
writeFileSync(join(USER_DATA, 'config.json'), JSON.stringify({
  projects: [{ path: WORKSPACE, name: '文件区验收', collapsed: false }],
  activeWorkspace: WORKSPACE, permissionMode: 'default',
}))
const ENTRY = join(TEMP, 'main.cjs')
await build({
  entryPoints: [join(ROOT, 'src/main/index.ts')], outfile: ENTRY,
  bundle: true, platform: 'node', format: 'cjs', packages: 'external',
  define: { 'import.meta.url': JSON.stringify(pathToFileURL(ENTRY).href) },
  banner: { js: `require = require('node:module').createRequire(${JSON.stringify(join(ROOT, 'package.json'))});` },
  plugins: [{ name: 'isolated-sdk', setup(builder) {
    builder.onResolve({ filter: /^@anthropic-ai\/claude-agent-sdk$/ }, () => ({ path: join(ROOT, 'scripts/fixtures/session-sdk.mjs') }))
    builder.onResolve({ filter: /^\.\/doctor\.js$/ }, () => ({ path: 'doctor', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents:
      'export const runDoctor = async () => ({cliFound:true,credentialsConfigured:true}); export const installCli = async () => ({ok:true,output:""});',
    }))
    builder.onLoad({ filter: /src[\\/]main[\\/]index\.ts$/ }, ({ path }) => ({ loader: 'ts', contents: readFileSync(path, 'utf8')
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
      CLAUDEDECK_TEST_REPORT: join(TEMP, 'closed.json'), CLAUDEDECK_TEST_WORKSPACE: WORKSPACE },
  })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.locator('.session-row[title="测试会话A"]').click()
  await page.waitForFunction(() => document.querySelector('.composer-wrap')?.getAttribute('aria-busy') === 'false')
  await page.locator('.composer textarea').fill('后台执行验收')
  await page.locator('.composer [data-state="send"]').click()
  await page.locator('.crumb-files').click()
  const file = (name) => page.locator('.file-row').filter({ has: page.locator('.file-name', { hasText: name }) })
  await file('AGENTS.md').click()
  await page.locator('.file-preview .md-h1').waitFor()
  assert.equal(await page.locator('.file-preview strong').textContent(), '重点内容')
  assert.equal(await page.locator('.midcol-text').count(), 0)
  assert.equal(await page.locator('.midcol-ro').textContent(), '只读')
  for (const theme of ['light', 'dark']) {
    for (const width of [940, 1200, 1600]) {
      await page.setViewportSize({ width, height: 800 })
      await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
      const metrics = await page.evaluate(() => {
        const file = document.querySelector('.midcol').getBoundingClientRect()
        const main = document.querySelector('.main').getBoundingClientRect()
        const preview = document.querySelector('.file-preview')
        const code = preview.querySelector('pre')
        return { fileLeft: file.left, fileRight: file.right, mainRight: main.right, mainWidth: main.width,
          horizontal: preview.scrollWidth > preview.clientWidth + 1,
          bodyHorizontal: document.documentElement.scrollWidth > innerWidth,
          codeHorizontal: code.scrollWidth > code.clientWidth,
        }
      })
      assert.ok(Math.abs(metrics.fileRight - width) < 1, JSON.stringify(metrics))
      if (width > 1040) {
        assert.ok(Math.abs(metrics.mainRight - metrics.fileLeft) < 1, JSON.stringify(metrics))
        assert.ok(metrics.mainWidth >= 360)
      }
      assert.equal(metrics.horizontal, false)
      assert.equal(metrics.bodyHorizontal, false)
      assert.equal(metrics.codeHorizontal, true)
      console.log(`PASS ${theme} ${width}px 文件靠右/正文换行/代码横向/对话保留空间`)
    }
  }
  await page.setViewportSize({ width: 940, height: 800 })
  const narrowSeparator = page.getByRole('separator', { name: '调整文件栏宽度' })
  const narrowBox = await narrowSeparator.boundingBox()
  const narrowWidth = await page.locator('.midcol').evaluate((el) => el.getBoundingClientRect().width)
  await page.mouse.move(narrowBox.x + narrowBox.width / 2, 400)
  await page.mouse.down()
  await page.mouse.move(narrowBox.x - 32, 400, { steps: 3 })
  await page.mouse.up()
  await page.waitForFunction((width) => document.querySelector('.midcol').getBoundingClientRect().width > width, narrowWidth)
  console.log('PASS 窄窗口浮层鼠标拖宽不错误扣除对话空间')
  await page.setViewportSize({ width: 1600, height: 800 })
  const separator = page.getByRole('separator', { name: '调整文件栏宽度' })
  const oldWidth = await page.locator('.midcol').evaluate((el) => el.getBoundingClientRect().width)
  await separator.focus()
  await page.keyboard.press('ArrowLeft')
  await page.waitForFunction((width) => document.querySelector('.midcol').getBoundingClientRect().width > width, oldWidth)
  await page.getByRole('button', { name: '源码', exact: true }).click()
  assert.equal(await page.locator('.midcol-text').inputValue(), source)
  assert.equal(await page.locator('.midcol-text').evaluate((el) => el.readOnly), true)
  await page.getByRole('button', { name: '预览', exact: true }).click()
  await page.getByRole('button', { name: '放大阅读', exact: true }).click()
  const expandedWidth = await page.locator('.midcol').evaluate((el) => el.getBoundingClientRect().width)
  assert.equal(expandedWidth, 1600 - 264)
  assert.equal(await page.locator('.main').isVisible(), false)
  await app.evaluate(() => {
    const q = globalThis.sessionFixture.instances.findLast((q) => q.id === 'A' && !q.closed)
    q.push({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '放大时后台继续回答' } } })
  })
  await page.getByRole('button', { name: '恢复分栏', exact: true }).click()
  await page.locator('.msg-claude').filter({ hasText: '放大时后台继续回答' }).waitFor()
  assert.equal(await app.evaluate(() => globalThis.sessionFixture.instances.find((q) => q.id === 'A').interrupts), 0)
  console.log('PASS 源码完整只读/分隔线键盘拖宽/放大恢复/后台执行不中断')
  await page.locator('.titlebar-left .win-btn').first().click()
  await page.getByRole('button', { name: '放大阅读', exact: true }).click()
  assert.equal(await page.locator('.midcol').evaluate((el) => el.getBoundingClientRect().width), 1600)
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.midcol.expanded').count(), 0)
  await page.locator('.titlebar-left .win-btn').first().click()
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.screenshot({ path: join(TEMP, 'files-light.png') })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.screenshot({ path: join(TEMP, 'files-dark.png') })
  await page.locator('.midcol-back').click()
  await file('CLAUDE.md').click()
  await page.getByRole('button', { name: '编辑源码', exact: true }).click()
  await page.locator('.midcol-text').fill('# 未保存草稿\n\n**中文内容**\n')
  await page.getByRole('button', { name: '预览', exact: true }).click()
  await page.locator('.dirty-dot').waitFor()
  assert.equal(readFileSync(join(WORKSPACE, 'CLAUDE.md'), 'utf8'), '# 可编辑文档\n')
  assert.equal(await page.locator('.file-preview strong').textContent(), '中文内容')
  await page.keyboard.press('Control+s')
  await page.waitForFunction(() => !document.querySelector('.dirty-dot'))
  assert.ok(readFileSync(join(WORKSPACE, 'CLAUDE.md'), 'utf8').includes('未保存草稿'))
  await page.getByRole('button', { name: '编辑源码', exact: true }).click()
  await page.locator('.midcol-text').fill('# 不能丢失的草稿\n')
  await page.locator('.midcol-back').click()
  await page.locator('.midcol-confirm').waitFor()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  assert.ok((await page.locator('.midcol-text').inputValue()).includes('不能丢失'))
  await page.locator('.midcol-back').click()
  await page.getByRole('button', { name: '不保存', exact: true }).click()
  await file('.claude').click()
  await file('settings.json').click()
  await page.locator('.midcol-text').fill('{\n invalid json\n}')
  await page.keyboard.press('Control+s')
  await page.locator('.midcol-error').waitFor()
  assert.ok(readFileSync(join(WORKSPACE, '.claude/settings.json'), 'utf8').includes('permissions'))
  assert.deepEqual(errors, [])
  console.log(`PASS 侧栏收起/预览保留草稿/预览Ctrl S保存/取消与不保存/JSON校验\n截图与临时数据:${TEMP}`)
} finally {
  await app?.close()
  await server.close()
}
