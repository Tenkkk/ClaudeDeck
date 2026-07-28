/**
 * 生成 README 用的截图,写到 docs/images/。
 *
 *   npm run build && node scripts/shots-for-readme.mjs
 *
 * 会产生少量真实 API 调用 —— 空对话的截图没有说服力,该有回复就得有回复。
 * 用独立的 --user-data-dir 与临时工作目录,不碰真实配置,截出来的路径也
 * 不会泄露本机目录结构。
 */
import { _electron as electron } from 'playwright'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = join(ROOT, 'docs', 'images')
mkdirSync(OUT, { recursive: true })

const UD = mkdtempSync(join(tmpdir(), 'cd-doc-ud-'))
const WS = join(tmpdir(), 'claudedeck-demo')
mkdirSync(join(WS, '.claude'), { recursive: true })
mkdirSync(join(WS, 'src'), { recursive: true })
writeFileSync(join(WS, 'CLAUDE.md'), '# 演示项目\n\n这个目录只用于生成文档截图。\n')
writeFileSync(
  join(WS, '.claude', 'settings.json'),
  JSON.stringify({ permissions: { allow: ['Bash(npm run build)'], deny: [] } }, null, 2),
)
writeFileSync(join(WS, 'src', 'index.ts'), 'export const hello = () => "hi"\n')

writeFileSync(
  join(UD, 'config.json'),
  JSON.stringify({
    baseUrl: '',
    apiKeyCipher: null,
    projects: [{ path: WS, name: 'claudedeck-demo', collapsed: false }],
    activeWorkspace: WS,
    model: null,
    effort: 'medium',
    permissionMode: 'default',
    theme: 'system',
  }),
)

const app = await electron.launch({ args: ['.', `--user-data-dir=${UD}`], cwd: ROOT })
const page = await app.firstWindow()
await page.waitForSelector('.composer textarea', { timeout: 30_000 })
await page.evaluate(() => document.fonts.ready)
await page.setViewportSize({ width: 1280, height: 820 })

const theme = (t) => page.evaluate((x) => (document.documentElement.dataset.theme = x), t)
const shot = async (name) => {
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, `${name}.png`) })
  console.log(`docs/images/${name}.png`)
}

// ---- 一轮真实对话,顺带把 Markdown 与工具行都带出来 ----
await theme('light')
await page.fill(
  '.composer textarea',
  '用一句话说明什么是 Markdown,然后给一个三行的 TypeScript 代码块示例。不要跑任何工具。',
)
await page.click('.composer [data-state="send"]')
await page.waitForSelector('.md-code', { timeout: 120_000 })
await page.waitForSelector('.composer [data-state="send"]', { timeout: 120_000 })
await shot('main-light')

await theme('dark')
await shot('main-dark')
await theme('light')

// ---- 文件树 ----
await page.click('.crumb-files')
await page.waitForSelector('.file-row', { timeout: 15_000 })
await shot('files')
await page.click('.crumb-files')

// ---- MCP 面板 ----
await page.fill('.composer textarea', '/mcp')
await page.click('.composer [data-state="send"]')
await page
  .waitForFunction(
    () => !(document.querySelector('.mcp-panel')?.textContent ?? '').includes('正在读取'),
    undefined,
    { timeout: 30_000 },
  )
  .catch(() => {})
await shot('mcp')

// ---- 系统设置 ----
await page.click('.titlebar-left .win-btn:nth-child(3)')
await page.waitForSelector('.dialog-body', { timeout: 15_000 })
await shot('settings')
await page.click('.dialog-head .icon-btn')

// ---- 搜索 ----
await page.click('.titlebar-left .win-btn:nth-child(2)')
await page.waitForSelector('.search-panel', { timeout: 15_000 })
await shot('search')

await app.close()
rmSync(UD, { recursive: true, force: true })
rmSync(WS, { recursive: true, force: true })
