/**
 * 版式验收 —— 按《设计终稿》§08 的「验收时按这些量」逐条量。
 *
 *   npm run measure
 *
 * 不产生 API 调用,只启动窗口量尺寸:
 *   - 关键尺寸是否等于 token 声明值
 *   - 940 / 1200 / 1600 三档下无横向滚动、侧栏不变宽、发送按钮不换行
 *   - §04 的路径截断在真实界面上生效
 *
 * 顺带把两屏截图写到 .screenshots/(已 gitignore),用于和设计稿逐项对照。
 */
import { _electron as electron } from 'playwright'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SHOT = join(ROOT, '.screenshots')
mkdirSync(SHOT, { recursive: true })

const UD = mkdtempSync(join(tmpdir(), 'cd-measure-'))
const WS = mkdtempSync(join(tmpdir(), 'cd-ws-'))
mkdirSync(UD, { recursive: true })

// 真实的 Windows 路径。注意:不要经由 shell 传这些字符串,反斜杠会被吃掉。
const PROJECTS = [
  'D:\\Code\\AI_Project\\ClaudeDeck',
  'D:\\Code\\AI_Project\\SwitchDeck',
  'C:\\Users\\12054\\Documents\\notes-vault',
]

function writeConfig(activeWorkspace) {
  // activeWorkspace 必须也在项目清单里 —— 侧栏只列 projects
  const paths = activeWorkspace && !PROJECTS.includes(activeWorkspace)
    ? [activeWorkspace, ...PROJECTS]
    : PROJECTS
  writeFileSync(
    join(UD, 'config.json'),
    JSON.stringify(
      {
        baseUrl: '',
        apiKeyCipher: null,
        projects: paths.map((path) => ({
          path,
          name: path.split(/[\\/]/).filter(Boolean).pop(),
          collapsed: path !== activeWorkspace,
        })),
        activeWorkspace,
        model: null,
        effort: 'high',
        permissionMode: 'default',
      },
      null,
      2,
    ),
  )
}

let pass = 0
let fail = 0
function eq(label, actual, expected) {
  const good = actual === expected
  good ? pass++ : fail++
  console.log(`  ${good ? 'PASS' : 'FAIL'}  ${label} — ${actual}${good ? '' : ` (期望 ${expected})`}`)
}
function ok(label, cond, detail = '') {
  cond ? pass++ : fail++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

let app
try {
  // ---- 屏幕 C:选择项目 ----
  writeConfig(null)
  app = await electron.launch({ args: ['.', `--user-data-dir=${UD}`], cwd: ROOT })
  let page = await app.firstWindow()
  await page.waitForSelector('.card', { timeout: 20_000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)

  console.log('屏幕 C · 路径截断 §04')
  const paths = await page.$$eval('.project-pick .path', (n) => n.map((e) => e.textContent))
  const names = await page.$$eval('.project-pick .name', (n) => n.map((e) => e.textContent))
  names.forEach((n, i) => console.log(`        ${n}  ←  ${paths[i]}`))
  ok('路径按 §04 顶掉中间', paths.length > 0 && paths.every((p) => p.includes('…')))
  ok('项目名只取末级', names[0] === 'ClaudeDeck', names.join(' / '))
  await page.screenshot({ path: join(SHOT, 'screen-C-projects.png') })
  await app.close()

  // ---- 屏幕 D:主界面 ----
  writeConfig(WS)
  app = await electron.launch({ args: ['.', `--user-data-dir=${UD}`], cwd: ROOT })
  page = await app.firstWindow()
  await page.waitForSelector('.composer textarea', { timeout: 20_000 })
  await page.evaluate(() => document.fonts.ready)
  // 等模型列表填充,否则量到的是「加载中…」
  await page
    .waitForFunction(
      () => (document.querySelector('[data-control="model"]')?.textContent ?? '').trim().length > 1 &&
        !(document.querySelector('[data-control="model"]')?.textContent ?? '').includes('…'),
      { timeout: 30_000 },
    )
    .catch(() => {})

  console.log('\n屏幕 D · 尺寸对照 token')
  const dims = await page.evaluate(() => {
    const cs = getComputedStyle(document.body)
    const num = (name) => Math.round(parseFloat(cs.getPropertyValue(name)))
    const ta = document.querySelector('.composer textarea')
    return {
      sidebar: Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),
      composerMinH: Math.round(parseFloat(getComputedStyle(ta).minHeight)),
      composerMaxH: Math.round(parseFloat(getComputedStyle(ta).maxHeight)),
      prose: num('--w-prose'),
      bubble: num('--w-bubble'),
    }
  })
  eq('侧栏宽度 = --w-sidebar', dims.sidebar, 264)
  eq('输入框起始高 = --h-composer-min', dims.composerMinH, 46)
  eq('输入框封顶高 = --h-composer-max', dims.composerMaxH, 180)
  eq('正文封顶 = --w-prose', dims.prose, 720)
  eq('气泡封顶 = --w-bubble', dims.bubble, 560)

  // §01:陶土只出现在三处(当前项、主按钮、等你决定的卡片)。
  // 侧栏里就只剩「当前会话」和项目行的 ＋ —— 别的地方冒出陶土就是画错了。
  // 这类偏差是 CSS 优先级悄悄盖掉造成的,肉眼很难发现,所以钉在这里。
  console.log('\n侧栏配色 · §01 / §05')
  const sb = await page.evaluate(() => {
    const cs = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const s = getComputedStyle(el)
      return { color: s.color, bg: s.backgroundColor }
    }
    return {
      add: cs('.project-line .project-add'),
      newSession: cs('.new-session'),
      hasBrandDot: !!document.querySelector('.sidebar-brand .brand-dot'),
    }
  })
  const ACCENT = 'rgb(167, 95, 56)'
  const ACCENT_TINT = 'rgb(244, 237, 229)'
  ok('项目 ＋ 用陶土色', sb.add?.color === ACCENT, sb.add?.color)
  ok('项目 ＋ 用陶土浅底', sb.add?.bg === ACCENT_TINT, sb.add?.bg)
  ok('新建会话不是实心主按钮', sb.newSession?.bg === 'rgba(0, 0, 0, 0)', sb.newSession?.bg)
  ok('侧栏品牌位不带呼吸点', !sb.hasBrandDot)

  console.log('\n三档宽度 · §09')
  for (const w of [940, 1200, 1600]) {
    await page.setViewportSize({ width: w, height: 800 })
    await page.waitForTimeout(250)
    const r = await page.evaluate(() => {
      const btn = document.querySelector('.composer [data-state]')
      return {
        hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        sidebar: Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),
        btnH: btn ? Math.round(btn.getBoundingClientRect().height) : -1,
      }
    })
    ok(`${w}px 无横向滚动`, !r.hScroll)
    eq(`${w}px 侧栏仍为 264`, r.sidebar, 264)
    ok(`${w}px 发送按钮不换行`, r.btnH > 0 && r.btnH <= 44, `${r.btnH}px`)
    if (w === 1200) await page.screenshot({ path: join(SHOT, 'screen-D-main.png') })
  }

  // 深色 · §16:同一批变量名换一组值,布局不动
  console.log('\n深色 · §16')
  await page.setViewportSize({ width: 1200, height: 800 })
  const light = await page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    sidebar: Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),
  }))

  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
  await page.waitForTimeout(300)
  const dark = await page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    ink: getComputedStyle(document.body).color,
    sidebar: Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }))

  ok('切到深色后底色确实变了', dark.bg !== light.bg, `${light.bg} → ${dark.bg}`)
  eq('深色底 = --bg #1a1917', dark.bg, 'rgb(26, 25, 23)')
  eq('深色正文 = --ink #eae4d9', dark.ink, 'rgb(234, 228, 217)')
  // 「圆角、间距、字号、布局全部不变」—— 布局一行都不该动
  eq('深色下侧栏仍为 264', dark.sidebar, light.sidebar)
  ok('深色下无横向滚动', !dark.hScroll)
  await page.screenshot({ path: join(SHOT, 'screen-D-dark.png') })

  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'))
  await page.waitForTimeout(200)

  // 三个弹层各截一张,用于和设计终稿 §08 逐项对照
  console.log('\n控件条弹层 · §08')
  await page.setViewportSize({ width: 1200, height: 800 })
  for (const [control, name] of [
    ['permission', 'popover-permission'],
    ['model', 'popover-model'],
    ['effort', 'popover-effort'],
  ]) {
    await page.click(`[data-control="${control}"]`)
    await page.waitForSelector('.popover', { timeout: 5_000 })
    await page.waitForTimeout(200)
    const box = await page.evaluate(() => {
      const p = document.querySelector('.popover')
      const r = p.getBoundingClientRect()
      return { w: Math.round(r.width), rows: p.querySelectorAll('.pop-row, .effort-stop').length }
    })
    ok(`${control} 弹层已开`, box.rows > 0, `${box.w}px 宽 · ${box.rows} 项`)
    await page.screenshot({ path: join(SHOT, `${name}.png`) })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
  }
} finally {
  await app?.close().catch(() => {})
  rmSync(UD, { recursive: true, force: true })
  rmSync(WS, { recursive: true, force: true })
}

console.log(`\n${pass} 通过,${fail} 失败`)
console.log(`截图:${SHOT}`)
process.exit(fail === 0 ? 0 : 1)
