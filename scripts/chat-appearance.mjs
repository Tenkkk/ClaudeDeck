/** npm run build && node scripts/chat-appearance.mjs
 * 真实桥接/React 的外观回归,独立配置和模拟 SDK,不调用模型或系统剪贴板。
 */
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
const TEMP = mkdtempSync(join(tmpdir(), 'claudedeck-appearance-'))
const WORKSPACE = join(TEMP, 'project')
const USER_DATA = join(TEMP, 'user-data')
for (const dir of [WORKSPACE, USER_DATA]) mkdirSync(dir)
writeFileSync(join(WORKSPACE, 'CLAUDE.md'), '# 示例项目\n用于验证文件栏外观。\n')
writeFileSync(join(USER_DATA, 'config.json'), JSON.stringify({
  projects: [{ path: WORKSPACE, name: '示例项目', collapsed: false }], activeWorkspace: WORKSPACE,
}))
const ENTRY = join(TEMP, 'main.cjs')
await build({
  entryPoints: [join(ROOT, 'src/main/index.ts')], outfile: ENTRY,
  bundle: true, platform: 'node', format: 'cjs', packages: 'external',
  define: { 'import.meta.url': JSON.stringify(pathToFileURL(ENTRY).href) },
  banner: { js: `require = require('node:module').createRequire(${JSON.stringify(join(ROOT, 'package.json'))});` },
  plugins: [{ name: 'appearance-fixtures', setup(builder) {
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
  app = await electron.launch({
    args: [ENTRY, `--user-data-dir=${USER_DATA}`], cwd: ROOT,
    env: { ...process.env, ELECTRON_RENDERER_URL: `http://127.0.0.1:${server.httpServer.address().port}`,
      CLAUDEDECK_TEST_WORKSPACE: WORKSPACE, CLAUDEDECK_TEST_REPORT: join(TEMP, 'closed.json') },
  })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const ready = () => page.waitForFunction(() =>
    document.querySelector('.composer-wrap')?.getAttribute('aria-busy') === 'false')
  await ready()
  await page.evaluate(() => document.fonts.ready)
  await page.setViewportSize({ width: 1200, height: 800 })
  assert.equal(await page.locator('.empty-state h1').innerText(), '今天想做些什么?')
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true)
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
    await page.screenshot({ path: join(TEMP, `empty-${theme}.png`) })
  }
  const attachment = { id: '11111111-1111-1111-1111-111111111111', name: '界面参考与需求说明.txt', kind: 'text', size: 1200 }
  const userText = '请整理这个项目的改动要点。\n\n<claudedeck-attachments-v1>\n' +
    JSON.stringify({ attachments: [attachment], references: [] }) + '\n</claudedeck-attachments-v1>'
  await app.evaluate((_electron, { userText }) => {
    globalThis.sessionFixture.history = { A: [
      { uuid: 'user', message: { role: 'user', content: userText } },
      { uuid: 'reply', message: { role: 'assistant', content:
        '## 让对话更专注\n\n保留熟悉的项目结构,用更柔和的层次区分内容与操作。\n\n' +
        '- 对话和输入卡共用居中的内容列。\n- 工具记录默认折叠,需要时再展开。\n\n' +
        '```ts\nconst message = "' + 'long-code-'.repeat(28) + '"\n```' } },
      { uuid: 'tool', message: { role: 'assistant', content: [
        { type: 'tool_use', id: 'read', name: 'Read', input: { file_path: 'E:/code/' + '长目录/'.repeat(15) + 'CLAUDE.md' } },
      ] } },
      { uuid: 'result', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read' }] },
        tool_use_result: { file: { content: '示例文件内容' } } },
    ] }
  }, { userText })
  await page.locator('.session-row[title="测试会话A"]').click()
  await ready()
  await page.locator('.msg-claude').waitFor()
  assert.equal(await page.locator('.message-attachment').count(), 1)
  assert.equal(await page.locator('.tool-group-head').getAttribute('aria-expanded'), 'false')
  // 真实 preload/更新状态 IPC 下的设置入口自检;不保存配置、不检查或下载更新。
  await page.getByTitle('系统设置', { exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await settings.waitFor()
  await settings.getByRole('button', { name: '运行环境', exact: true }).click()
  await settings.getByRole('heading', { name: '运行环境', exact: true }).waitFor()
  await settings.getByRole('button', { name: '关于与更新', exact: true }).click()
  await settings.getByRole('button', { name: '检查更新', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await settings.waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.msg-claude').count(), 1)
  const checkLayout = async () => {
    const layout = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect()
      const input = rect('.composer')
      const reply = rect('.msg-wrap:not(.user)')
      const main = rect('.main')
      const send = rect('.send')
      // 对话区右侧预留滚动条;输入列也补偿同一空间,两者共用可用画布中心。
      const transcript = document.querySelector('.transcript')
      const gutter = transcript.offsetWidth - transcript.clientWidth
      return {
        aligned: Math.abs(input.left - reply.left) <= 1 && Math.abs(input.width - reply.width) <= 1,
        centered: Math.abs((input.left + input.right) / 2 - (main.left + main.right - gutter) / 2) <= 1,
        noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        sendSize: send.width === 32 && send.height === 32,
        radius: getComputedStyle(document.querySelector('.composer')).borderRadius,
      }
    })
    assert.deepEqual(layout, { aligned: true, centered: true, noOverflow: true, sendSize: true, radius: '20px' })
  }
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), theme)
    for (const width of [940, 1200, 1600]) {
      await page.setViewportSize({ width, height: 800 })
      await checkLayout()
      if (width === 1200) await page.screenshot({ path: join(TEMP, `chat-${theme}.png`) })
      await page.locator('.crumb-files').click()
      await page.locator('.midcol').waitFor()
      await checkLayout()
      if (width === 1200) await page.screenshot({ path: join(TEMP, `files-${theme}.png`) })
      await page.locator('.midcol-head button[title="关闭"]').click()
    }
    await page.getByTitle('收起侧栏', { exact: true }).click()
    await checkLayout()
    await page.getByTitle('展开侧栏', { exact: true }).click()
  }
  await page.locator('.tool-group-head').click()
  assert.equal(await page.locator('.tool-group-head').getAttribute('aria-expanded'), 'true')
  await page.locator('.composer textarea').fill('模拟发送,不请求模型')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.getByRole('button', { name: '停止', exact: true }).waitFor()
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await page.getByRole('button', { name: '发送', exact: true }).waitFor()
  assert.equal(await app.evaluate(() => globalThis.sessionFixture.instances.findLast((q) => q.id === 'A').interrupts), 1)
  assert.deepEqual(errors, [])
  console.log(`PASS 空态/亮暗/三档宽度/居中同宽/附件/代码/工具折叠/文件栏/侧栏收起/图标发送停止\n截图:${TEMP}`)
} finally {
  await app?.close()
  await server.close()
}
