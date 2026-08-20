/**
 * 演示动线 —— 驱动真实 Electron 窗口走一遍主要功能,供全屏录屏使用。
 *
 *   npm run build && node scripts/demo.mjs           # 正式跑
 *   npm run build && node scripts/demo.mjs --fast    # 空跑校验:节奏压到最短
 *
 * 顺序按「最能说明这软件是什么」排:聊天 → 切模型 → 切会话,再补其余功能。
 *
 * 会产生真实 API 调用。用独立的 --user-data-dir 与临时工作目录,不碰真实配置,
 * 录进画面的路径也不会泄露本机目录结构。
 *
 * ── 录屏相关的两个讲究 ─────────────────────────────────────────────
 *
 * 1. Playwright 的点击走 CDP,**不会移动真实的系统光标**。不管的话录出来是
 *    「真光标僵在原地、界面自己在动」。所以这里注入一个假光标做补间移动,
 *    同时给整个文档加 `cursor: none` —— 窗口最大化盖住整屏后,系统光标落在
 *    客户区内就不再绘制,画面里只剩那个受控的假光标。
 *
 * 2. 每一步都有字幕条。没有字幕的演示视频,观众只能看见控件在闪。
 *
 * 动线里的每一段都包在 step() 里:某一段挂了只丢那一段并继续往下走。
 * 录屏是一次性的,不能因为一个选择器没命中就废掉整条片子。
 */
import { _electron as electron } from 'playwright'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const FAST = process.argv.includes('--fast')

/** 节奏。空跑时压到最短,只验走位对不对,不管好不好看。 */
const T = FAST
  ? { beat: 60, read: 120, cursor: 90, type: 5, caption: 200 }
  : { beat: 500, read: 1500, cursor: 620, type: 42, caption: 900 }

const UD = mkdtempSync(join(tmpdir(), 'cd-demo-ud-'))
const WS = join(tmpdir(), 'claudedeck-demo')
rmSync(WS, { recursive: true, force: true })
mkdirSync(join(WS, '.claude'), { recursive: true })
mkdirSync(join(WS, 'src', 'lib'), { recursive: true })

// 演示项目要有点真东西 —— 空目录的文件树没什么可看的
writeFileSync(join(WS, 'CLAUDE.md'), '# 演示项目\n\n这个目录只用于录制演示。\n')
writeFileSync(join(WS, 'README.md'), '# demo\n\n一个用于演示的小项目。\n')
writeFileSync(join(WS, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2))
writeFileSync(
  join(WS, '.claude', 'settings.json'),
  JSON.stringify({ permissions: { allow: [], deny: [] } }, null, 2),
)
writeFileSync(join(WS, 'src', 'index.ts'), "export { greet } from './lib/greet'\n")
writeFileSync(
  join(WS, 'src', 'lib', 'greet.ts'),
  'export const greet = (name: string) => `hello, ${name}`\n',
)

writeFileSync(
  join(UD, 'config.json'),
  JSON.stringify(
    {
      baseUrl: '',
      apiKeyCipher: null,
      projects: [{ path: WS, name: 'claudedeck-demo', collapsed: false }],
      activeWorkspace: WS,
      model: null,
      effort: 'medium',
      permissionMode: 'default',
      theme: 'light',
    },
    null,
    2,
  ),
)

const app = await electron.launch({ args: ['.', `--user-data-dir=${UD}`], cwd: ROOT })
const page = await app.firstWindow()
await page.waitForSelector('.composer textarea', { timeout: 60_000 })
await page.evaluate(() => document.fonts.ready)

// 铺满屏幕。录屏是全屏的,窗口没铺开就会把桌面一起录进去。
await app.evaluate(async ({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  w.maximize()
  w.focus()
})
await page.waitForTimeout(600)

// ── 假光标 + 字幕条 + 隐藏真实光标 ──────────────────────────────
await page.addStyleTag({
  content: `
    *, *::before, *::after { cursor: none !important; }
    #__demo-cur {
      position: fixed; left: 0; top: 0; width: 22px; height: 22px;
      z-index: 2147483647; pointer-events: none; will-change: transform;
      transform: translate(-40px, -40px);
      filter: drop-shadow(0 1px 2px rgba(0,0,0,.45));
    }
    #__demo-ring {
      position: fixed; left: 0; top: 0; width: 34px; height: 34px;
      margin: -17px 0 0 -17px; border-radius: 50%;
      z-index: 2147483646; pointer-events: none; opacity: 0;
      border: 2px solid currentColor; color: #c8663d;
    }
    #__demo-ring.hit { animation: __demo-hit 420ms ease-out; }
    @keyframes __demo-hit {
      from { opacity: .9; transform: scale(.35); }
      to   { opacity: 0;  transform: scale(1.15); }
    }
    #__demo-cap {
      position: fixed; left: 50%; bottom: 34px; transform: translateX(-50%);
      z-index: 2147483647; pointer-events: none;
      max-width: 76vw; padding: 10px 20px; border-radius: 999px;
      background: rgba(24,20,17,.86); color: #f7f3ee;
      font: 500 15px/1.5 system-ui, "Segoe UI", sans-serif;
      letter-spacing: .01em; white-space: nowrap;
      opacity: 0; transition: opacity 320ms ease;
      backdrop-filter: blur(6px);
    }
    #__demo-cap.on { opacity: 1; }
  `,
})

await page.evaluate(() => {
  const cur = document.createElement('div')
  cur.id = '__demo-cur'
  cur.innerHTML =
    '<svg viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 1.5 L4 17.5 L8.3 13.4 L11 19.4 L13.9 18.1 L11.2 12.2 L17 12.2 Z" ' +
    'fill="#fff" stroke="#16120f" stroke-width="1.4" stroke-linejoin="round"/></svg>'
  const ring = document.createElement('div')
  ring.id = '__demo-ring'
  const cap = document.createElement('div')
  cap.id = '__demo-cap'
  document.body.append(cur, ring, cap)
  // 光标的补间交给 CSS,脚本只管改 transform
  window.__demoCursor = (x, y, ms) => {
    cur.style.transition = `transform ${ms}ms cubic-bezier(.32,.72,.28,1)`
    cur.style.transform = `translate(${x - 3}px, ${y - 2}px)`
    ring.style.transition = cur.style.transition
    ring.style.transform = `translate(${x}px, ${y}px)`
  }
  window.__demoHit = () => {
    ring.classList.remove('hit')
    void ring.offsetWidth
    ring.classList.add('hit')
  }
  window.__demoCap = (text) => {
    if (!text) return cap.classList.remove('on')
    cap.textContent = text
    cap.classList.add('on')
  }
})

const beat = (ms = T.beat) => page.waitForTimeout(ms)

/** 打字幕。传空收起。 */
async function cap(text) {
  await page.evaluate((t) => window.__demoCap(t), text ?? '')
  if (text) await beat(T.caption)
}

/** 把光标移到某个坐标,等补间走完 */
async function moveTo(x, y, ms = T.cursor) {
  await page.evaluate(([a, b, c]) => window.__demoCursor(a, b, c), [x, y, ms])
  await page.waitForTimeout(ms + 60)
}

/** 移到元素中心 —— 坐标和点击都在同一次取值上,避免两套基准对不上 */
async function moveToEl(sel, nth = 0) {
  const box = await page.evaluate(
    ([s, i]) => {
      const el = document.querySelectorAll(s)[i]
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    },
    [sel, nth],
  )
  if (!box) throw new Error(`没找到元素:${sel} [${nth}]`)
  await moveTo(box.x, box.y)
  return box
}

/** 走过去、按一下 */
async function tap(sel, nth = 0) {
  await moveToEl(sel, nth)
  await page.evaluate(() => window.__demoHit())
  await page.evaluate(
    ([s, i]) => document.querySelectorAll(s)[i]?.click(),
    [sel, nth],
  )
  await beat()
}

/** 可见地打字 */
async function typeInto(sel, text) {
  await moveToEl(sel)
  await page.click(sel)
  await page.fill(sel, '')
  await page.type(sel, text, { delay: T.type })
  await beat(300)
}

/** 等本轮结束 —— 发送⇄停止共用一个位置,必须等它回到 send 态 */
const settle = () =>
  page.waitForSelector('.composer [data-state="send"]', { timeout: 180_000 })

/** 发出去 */
async function send() {
  await tap('.composer [data-state="send"]')
}

/**
 * 权限卡如果冒出来就批准它。
 * permissionMode 是 default,所以跑工具会拦一下 —— 这本身值得录进去。
 */
async function approveIfAsked(ms = 25_000) {
  const card = await page.waitForSelector('.card', { timeout: ms }).catch(() => null)
  if (!card) return false
  await cap('工具调用会先拦下来问一次 —— 批准之后才动手')
  await beat(T.read)
  const btn = '.card button'
  await moveToEl(btn)
  await page.evaluate(() => window.__demoHit())
  await page.evaluate(() => document.querySelector('.card button')?.click())
  await beat()
  return true
}

let failed = 0
/** 每段独立兜底:挂了只丢这一段,不废掉整条片子 */
async function step(title, fn) {
  process.stdout.write(`▶ ${title}\n`)
  try {
    await fn()
  } catch (e) {
    failed++
    process.stdout.write(`  ✗ ${title} —— ${e.message}\n`)
    await cap('')
    // 顺手收掉可能开着的浮层,免得污染后面几段
    await page.keyboard.press('Escape').catch(() => {})
    await beat()
  }
}

const theme = (t) => page.evaluate((x) => (document.documentElement.dataset.theme = x), t)

// ════════════════════════════════════════════════════════════════
//  1. 聊天
// ════════════════════════════════════════════════════════════════
await step('聊天:流式正文 + 思考过程', async () => {
  await cap('ClaudeDeck —— 把 Claude Code 装进桌面客户端')
  await beat(T.read)
  await cap('先聊一句。正文是流式渲染的 Markdown,思考过程会单独收起')
  await typeInto(
    '.composer textarea',
    '用两句话说明「纯函数」和「有副作用」为什么不能共存。',
  )
  await send()
  await page.waitForSelector('.msg-claude', { timeout: 120_000 })
  await beat(T.read)
  // 思考块出现就展开给人看
  const th = await page.$('.thinking')
  if (th) {
    await cap('思考过程也在这里 —— 点开能看 Claude 是怎么想的')
    await tap('.thinking')
    await beat(T.read)
  }
  await settle()
  await beat(T.read)
})

await step('聊天:工具调用与权限卡', async () => {
  await cap('让它真的动手跑个命令')
  await typeInto('.composer textarea', '运行 node -v,然后用一句话说明输出是什么。')
  await send()
  await approveIfAsked()
  await page.waitForSelector('.tool-row', { timeout: 120_000 })
  await cap('工具行给的是完整命令,不是截断的一行 —— 点开看输出')
  await beat(T.beat)
  await tap('.tool-toggle')
  await beat(T.read)
  await settle()
  await beat(T.beat)
})

await step('聊天:上下文环', async () => {
  await cap('上下文用量收在输入框左下角,点开看分类明细')
  await tap('.ctx-ring')
  // `.ctx` 是会话行的右键菜单,不是这个面板 —— 面板的分类项是 .ctx-row-item
  await page.waitForSelector('.ctx-row-item', { timeout: 10_000 })
  await beat(T.read + 400)
  await page.keyboard.press('Escape')
  await beat()
})

// ════════════════════════════════════════════════════════════════
//  2. 切换模型
// ════════════════════════════════════════════════════════════════
await step('切模型:列表由 SDK 给出', async () => {
  await cap('模型列表不是写死的 —— 由 SDK 运行时给出,带各自的说明')
  await tap('[data-control="model"]')
  await page.waitForSelector('.popover .pop-row', { timeout: 15_000 })
  await beat(T.read + 500)

  const rows = await page.$$eval('.popover .pop-row .pop-title', (n) =>
    n.map((e) => (e.textContent ?? '').trim()),
  )
  // 挑一个跟当前不同的:优先第二项,只有一项就算了
  const pick = rows.length > 1 ? 1 : 0
  await cap(`切到「${rows[pick] ?? '另一个模型'}」—— 中途切换,历史不动`)
  await moveToEl('.popover .pop-row', pick)
  await page.evaluate(() => window.__demoHit())
  await page.evaluate((i) => document.querySelectorAll('.popover .pop-row')[i]?.click(), pick)
  await beat(T.read)
})

await step('切模型:历史确实还在', async () => {
  await cap('接着问 —— 换了模型,前面聊的它照样接得上')
  await typeInto('.composer textarea', '用一句话总结我们刚才聊了什么。')
  await send()
  await settle()
  await beat(T.read)
})

await step('切模型:努力程度可拖拽', async () => {
  await cap('努力程度是可以拖的 —— 松手才提交,切换原地生效,对话不中断')
  await tap('[data-control="effort"]')
  const t = await page.$('.effort-track')
  if (t) {
    const box = await t.boundingBox()
    await moveTo(box.x + box.width * 0.2, box.y + box.height / 2)
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2)
    await page.mouse.down()
    for (const f of [0.35, 0.5, 0.68, 0.85]) {
      await page.mouse.move(box.x + box.width * f, box.y + box.height / 2)
      await moveTo(box.x + box.width * f, box.y + box.height / 2, 160)
    }
    await page.mouse.up()
    await beat(T.read)
  }
  await page.keyboard.press('Escape')
  await beat()
})

// ════════════════════════════════════════════════════════════════
//  3. 切换会话
// ════════════════════════════════════════════════════════════════
await step('切会话:新建', async () => {
  await cap('新建一个会话 —— 一发消息侧栏立刻就有,标题由 Claude 自己定')
  await tap('.sidebar-brand .new-session')
  await beat(T.beat)
  await typeInto('.composer textarea', '用一句话说明 Electron 是什么。')
  await send()
  await page
    .waitForFunction(() => document.querySelectorAll('.sidebar-scroll .session-row').length > 1, undefined, {
      timeout: 30_000,
    })
    .catch(() => {})
  await beat(T.read)
  await settle()
  await beat(T.beat)
})

await step('切会话:来回切,历史各自还原', async () => {
  const n = await page.$$eval('.sidebar-scroll .session-row', (e) => e.length)
  await cap(`侧栏按项目分组,这里有 ${n} 个会话 —— 点回上一个`)
  await tap('.sidebar-scroll .session-row', n > 1 ? 1 : 0)
  await page.waitForSelector('.msg-claude', { timeout: 20_000 })
  await beat(T.read + 500)
  await cap('再切回来 —— 两边的历史各自还原,互不串台')
  await tap('.sidebar-scroll .session-row', 0)
  await beat(T.read)
})

// ════════════════════════════════════════════════════════════════
//  4. 其余功能
// ════════════════════════════════════════════════════════════════
await step('斜杠命令面板', async () => {
  await cap('斜杠命令按相关度排序,项目自带的命令和 Skill 也在里面')
  await typeInto('.composer textarea', '/')
  await page.waitForSelector('.palette .palette-row', { timeout: 10_000 })
  await beat(T.read)
  await page.fill('.composer textarea', '')
  await beat()
})

await step('/mcp 服务面板', async () => {
  await cap('/mcp 不是一段纯文本 —— 是能进去的面板:工具清单、启停、重连')
  await typeInto('.composer textarea', '/mcp')
  await send()
  await page.waitForSelector('.mcp-panel', { timeout: 30_000 })
  await page
    .waitForFunction(
      () => !(document.querySelector('.mcp-panel')?.textContent ?? '').includes('正在读取'),
      undefined,
      { timeout: 30_000 },
    )
    .catch(() => {})
  await beat(T.read)
  const svc = await page.$('.mcp-main:not([disabled])')
  if (svc) {
    await cap('点进去能看到这个服务挂了哪些工具')
    await tap('.mcp-main:not([disabled])')
    await beat(T.read + 400)
  }
  await page.keyboard.press('Escape')
  await beat()
})

await step('/agents 子 Agent 清单', async () => {
  await cap('子 Agent 清单也是原生读出来的')
  await typeInto('.composer textarea', '/agents')
  await send()
  await page.waitForSelector('.agent-row', { timeout: 30_000 })
  await beat(T.read)
  await page.keyboard.press('Escape')
  await beat()
})

await step('Files 文件树', async () => {
  await cap('Files 直接开在中栏 —— 不用切出去翻文件')
  const crumb = (await page.$('.crumb-files')) ? '.crumb-files' : '.file-tag'
  await tap(crumb)
  await page.waitForSelector('.file-row', { timeout: 15_000 })
  await beat(T.beat)
  const rows = await page.$$eval('.file-row .file-name', (n) =>
    n.map((e) => (e.textContent ?? '').trim()),
  )
  const at = rows.findIndex((r) => r.endsWith('.ts') || r.endsWith('.md'))
  if (at >= 0) {
    await cap(`点开 ${rows[at]} —— 按会话的权限规则读,不绕过它`)
    await tap('.file-row', at)
    await beat(T.read + 500)
  }
  await tap('.midcol-head .icon-btn:last-of-type')
  await beat()
})

await step('搜索面板', async () => {
  await cap('放大镜是全局搜索 —— 跨项目跨会话找那句话')
  await tap('.titlebar-left .win-btn:nth-child(2)')
  await page.waitForSelector('.search-panel', { timeout: 15_000 })
  await typeInto('.search-input', '纯函数')
  await beat(T.read + 600)
  await page.keyboard.press('Escape')
  await beat()
})

await step('系统设置:CC 接管情况与中转 API', async () => {
  await cap('齿轮里是本机 Claude Code 的接管情况、中转 API,以及增量更新')
  await tap('.titlebar-left .win-btn:nth-child(3)')
  await page.waitForSelector('.dialog-body', { timeout: 15_000 })
  await beat(T.read + 800)
  const upd = await page.$('.dialog .update-actions button')
  if (upd) {
    await cap('更新是从 GitHub Releases 拉的 —— 只对安装版生效')
    await tap('.dialog .update-actions button')
    await beat(T.read + 600)
  }
  await tap('.dialog-head .icon-btn')
  await beat()
})

await step('侧栏收起 + 深色主题', async () => {
  await cap('侧栏能收起来,把画面让给对话')
  await tap('.titlebar-left .win-btn')
  await beat(T.read)
  await tap('.titlebar-left .win-btn')
  await beat(T.beat)
  await cap('深色主题是一等公民,不是把浅色调暗')
  await theme('dark')
  await beat(T.read + 900)
  await cap('')
  await beat(600)
})

console.log(
  failed === 0
    ? '\n动线跑完,没有断点。\n'
    : `\n动线跑完,其中 ${failed} 段没走通(已跳过)。\n`,
)

await app.close()
rmSync(UD, { recursive: true, force: true })
rmSync(WS, { recursive: true, force: true })
process.exit(failed === 0 ? 0 : 1)
