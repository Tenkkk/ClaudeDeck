/** node scripts/settings-dialog.mjs
 * 隔离 React 设置面板回归:模拟所有配置/更新接口,不访问凭据或请求网络更新。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const ROOT = resolve(import.meta.dirname, '..')
const TEMP = mkdtempSync(join(tmpdir(), 'claudedeck-settings-'))
await build({
  stdin: { resolveDir: ROOT, loader: 'tsx', sourcefile: 'settings-fixture.tsx', contents: `
    import React, { useState } from 'react'
    import { createRoot } from 'react-dom/client'
    import SettingsDialog from './src/renderer/src/components/SettingsDialog.tsx'
    import './src/renderer/src/styles.css'
    import './src/renderer/src/fonts.css'
    import './src/renderer/src/layout.css'
    const fixture = window.settingsFixture = { saves: [], updates: [], fail: false, hold: false }
    let updateState = { phase: 'idle', current: '0.3.0' }
    const listeners = new Set()
    fixture.setUpdate = (next) => { updateState = { current: '0.3.0', ...next }; listeners.forEach((fn) => fn(updateState)) }
    window.api = { update: {
      state: async () => updateState,
      onState: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
      check: async () => { fixture.updates.push('check'); fixture.setUpdate({ phase: 'latest' }) },
      download: async () => { fixture.updates.push('download'); fixture.setUpdate({ phase: 'downloading', version: '0.4.0', percent: 25, transferredMb: 5, totalMb: 20 }) },
      install: async () => { fixture.updates.push('install') },
    } }
    function Fixture() {
      const [open, setOpen] = useState(false)
      const [config, setConfig] = useState({ baseUrl: '', hasApiKey: true })
      return <><button onClick={() => setOpen(true)}>打开设置</button><textarea aria-label="背景草稿" defaultValue="不丢弃背景草稿" />
        {open && <SettingsDialog config={config} doctor={{ cliFound: true, cliVersion: '2.1.283', cliSource: 'bundled', cliPath: 'E:/code/' + '很长的目录/'.repeat(30) + 'claude.exe' }}
          onClose={() => setOpen(false)} onSaveCredentials={async (url, key) => {
            fixture.saves.push({ url, key })
            if (fixture.hold) await new Promise((resolve) => { fixture.release = resolve })
            if (fixture.fail) { fixture.fail = false; throw new Error('模拟保存失败,请重试。') }
            setConfig((current) => ({ baseUrl: url, hasApiKey: key === null ? current.hasApiKey : key !== '' }))
          }} />}</>
    }
    createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture /></React.StrictMode>)
  ` },
  bundle: true, outfile: join(TEMP, 'fixture.js'), platform: 'browser', format: 'esm',
  jsx: 'automatic', loader: { '.woff2': 'file' },
})
const server = createServer((request, response) => {
  const name = basename(new URL(request.url, 'http://localhost').pathname)
  if (!name) {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>')
  } else {
    try {
      response.setHeader('content-type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'font/woff2')
      response.end(readFileSync(join(TEMP, name)))
    } catch { response.writeHead(404); response.end() }
  }
})
let browser
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.evaluate(() => document.fonts.ready)
  const dialog = page.getByRole('dialog', { name: '设置', exact: true })
  const open = async () => { await page.getByRole('button', { name: '打开设置', exact: true }).click(); await dialog.waitFor() }
  const category = (name) => dialog.getByRole('button', { name, exact: true })
  const field = (name) => dialog.getByLabel(new RegExp(name))
  const save = () => dialog.getByRole('button', { name: '保存', exact: true })
  await open()
  assert.equal(await category('连接配置').getAttribute('aria-current'), 'page')
  assert.equal(await field('API Key').inputValue(), '')
  await field('Base URL').fill(' https://fixture.invalid/v1 ')
  await field('API Key').fill(' fake-test-key ')
  await category('运行环境').click()
  assert.match(await dialog.innerText(), /随安装包分发/)
  await dialog.locator('summary').click()
  assert.match(await dialog.innerText(), /claude.exe/)
  await category('连接配置').click()
  assert.equal(await field('API Key').inputValue(), ' fake-test-key ')
  await page.evaluate(() => { window.settingsFixture.fail = true })
  await save().click()
  await dialog.getByRole('alert').waitFor()
  assert.equal(await save().isDisabled(), false)
  assert.equal(await field('API Key').inputValue(), ' fake-test-key ')
  await page.evaluate(() => { window.settingsFixture.hold = true })
  await save().click()
  await dialog.getByRole('button', { name: '保存中…', exact: true }).waitFor()
  assert.equal(await field('API Key').isDisabled(), true)
  await page.evaluate(() => document.querySelector('#settings-connection').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  assert.equal(await page.evaluate(() => window.settingsFixture.saves.length), 2)
  await page.evaluate(() => { window.settingsFixture.hold = false; window.settingsFixture.release() })
  await dialog.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  assert.equal(await field('API Key').inputValue(), '')
  assert.deepEqual(await page.evaluate(() => window.settingsFixture.saves.at(-1)), { url: 'https://fixture.invalid/v1', key: 'fake-test-key' })
  await save().click()
  await dialog.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  assert.equal(await page.evaluate(() => window.settingsFixture.saves.at(-1).key), null)
  await dialog.getByRole('button', { name: '清除密钥', exact: true }).click()
  await dialog.getByRole('button', { name: '清除密钥', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => window.settingsFixture.saves.at(-1).key), '')
  console.log('PASS 分类切换保留草稿,保存/清除/null 语义,失败重试与并发保护,密钥不回读')
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
    for (const [width, height] of [[1200, 800], [940, 600], [1600, 900], [375, 600]]) {
      await page.setViewportSize({ width, height })
      for (const section of ['连接配置', '运行环境', '关于与更新']) {
        await category(section).click()
        assert.equal(await category(section).getAttribute('aria-current'), 'page')
        assert.equal(await dialog.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          const footer = element.querySelector('.settings-footer').getBoundingClientRect()
          return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight &&
            element.scrollWidth <= element.clientWidth && footer.bottom <= bounds.bottom &&
            element.querySelector('.dialog-body').scrollWidth <= element.querySelector('.dialog-body').clientWidth
        }), true, `${theme} ${width}x${height} ${section}`)
        if (width === 1200 || width === 375) {
          await page.mouse.move(300, 50)
          await page.waitForFunction(() => [...document.querySelectorAll('.settings-nav button:not([aria-current])')]
            .every((button) => getComputedStyle(button).backgroundColor === 'rgba(0, 0, 0, 0)'))
          await page.screenshot({ path: join(TEMP, `${theme}-${width}-${section}.png`) })
        }
      }
    }
  }
  await page.setViewportSize({ width: 1200, height: 800 })
  await category('关于与更新').click()
  await dialog.getByRole('button', { name: '检查更新', exact: true }).click()
  await dialog.getByText('已经是最新版本。', { exact: true }).waitFor()
  await page.evaluate(() => window.settingsFixture.setUpdate({ phase: 'checking' }))
  assert.equal(await dialog.getByRole('button', { name: '检查中…', exact: true }).isDisabled(), true)
  await page.evaluate(() => window.settingsFixture.setUpdate({ phase: 'available', version: '0.4.0', notes: '更新说明\n' + '长更新说明 '.repeat(600) }))
  await dialog.getByRole('button', { name: '下载更新', exact: true }).click()
  await dialog.getByRole('progressbar').waitFor()
  assert.equal(await dialog.getByRole('progressbar').getAttribute('aria-valuenow'), '25')
  await page.evaluate(() => window.settingsFixture.setUpdate({ phase: 'ready', version: '0.4.0' }))
  await dialog.getByRole('button', { name: '重启并安装', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.settingsFixture.updates), ['check', 'download', 'install'])
  await page.evaluate(() => window.settingsFixture.setUpdate({ phase: 'error', message: '模拟更新失败' }))
  await dialog.getByText('模拟更新失败', { exact: true }).waitFor()
  await category('连接配置').click()
  await dialog.getByRole('button', { name: '关闭设置', exact: true }).focus()
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab')
    assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true)
  }
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('button', { name: '打开设置', exact: true }).evaluate((el) => el === document.activeElement), true)
  await open()
  await page.mouse.click(4, 4)
  await dialog.waitFor({ state: 'hidden' })
  await open()
  await dialog.getByRole('button', { name: '关闭设置', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await page.getByLabel('背景草稿').inputValue(), '不丢弃背景草稿')
  assert.deepEqual(errors, [])
  console.log(`PASS 亮暗/窄屏低高度/固定底栏/完整更新状态/焦点闭环/Esc/遮罩/关闭与背景草稿\n截图:${TEMP}`)
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
}
