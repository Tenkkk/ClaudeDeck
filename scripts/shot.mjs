/**
 * 只截图,不断言 —— 改完外观想看一眼时用,不用跑整套 e2e。
 *
 *   npm run build && node scripts/shot.mjs
 *
 * 两套主题各截一张整窗 + 一张标题栏特写,写到 .screenshots/。
 */
import { _electron as electron } from 'playwright'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SHOT = join(ROOT, '.screenshots')
mkdirSync(SHOT, { recursive: true })

const UD = mkdtempSync(join(tmpdir(), 'cd-shot-ud-'))
const WS = mkdtempSync(join(tmpdir(), 'cd-shot-ws-'))
mkdirSync(join(WS, '.claude'), { recursive: true })
writeFileSync(join(WS, 'CLAUDE.md'), '# 看一眼\n')
writeFileSync(
  join(UD, 'config.json'),
  JSON.stringify({
    baseUrl: '',
    apiKeyCipher: null,
    projects: [{ path: WS, name: WS.split(/[\\/]/).pop(), collapsed: false }],
    activeWorkspace: WS,
    model: null,
    effort: 'high',
    permissionMode: 'default',
    theme: 'system',
  }),
)

const app = await electron.launch({ args: ['.', `--user-data-dir=${UD}`], cwd: ROOT })
const page = await app.firstWindow()
await page.waitForSelector('.composer textarea', { timeout: 30_000 })
await page.evaluate(() => document.fonts.ready)

for (const theme of ['light', 'dark']) {
  await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme)
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(SHOT, `now-${theme}.png`) })
  const bar = await page.$('.titlebar')
  await bar?.screenshot({ path: join(SHOT, `now-titlebar-${theme}.png`) })

  // 把这几颗按钮的实际取色打出来 —— 「看不见」多半是色值撞了底色
  const colors = await page.evaluate(() => {
    const read = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const s = getComputedStyle(el)
      return { color: s.color, bg: s.backgroundColor }
    }
    return {
      titlebar: read('.titlebar'),
      panel: read('.titlebar-left .win-btn:nth-child(1)'),
      search: read('.titlebar-left .win-btn:nth-child(2)'),
      gear: read('.titlebar-left .win-btn:nth-child(3)'),
      ctl: read('.titlebar-right .win-ctl'),
      count: document.querySelectorAll('.titlebar-left .win-btn').length,
      box: (() => { const b=document.querySelector('.titlebar-left .win-btn'); const r=b?.getBoundingClientRect(); const svg=b?.querySelector('svg'); const sr=svg?.getBoundingClientRect(); return { btn: r && [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)], svg: sr && [Math.round(sr.x),Math.round(sr.y),Math.round(sr.width),Math.round(sr.height)], svgHtml: svg?.outerHTML.slice(0,120) } })(),
    }
  })
  console.log(`\n${theme}:`)
  console.log('  左侧按钮数', colors.count)
  for (const [k, v] of Object.entries(colors)) {
    if (v && typeof v === 'object' && 'color' in v) {
      console.log(`  ${k.padEnd(9)} 字 ${v.color}  底 ${v.bg}`)
    }
  }
  console.log('  按钮框', JSON.stringify(colors.box?.btn))
  console.log('  图标框', JSON.stringify(colors.box?.svg))
  console.log('  图标源', colors.box?.svgHtml)
}

await app.close()
rmSync(UD, { recursive: true, force: true })
rmSync(WS, { recursive: true, force: true })
console.log('\n截图写到 .screenshots/now-*.png')
