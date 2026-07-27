/**
 * 端到端测试 —— 驱动真实的 Electron 窗口,验证三个功能在 UI 上跑得通。
 *
 *   npm run build && node scripts/e2e.mjs
 *
 * 与 smoke.mjs 的分工:smoke 验 SDK 那一层,这里验 IPC / preload / 渲染层
 * 那一层 —— 也就是「点了按钮之后事情有没有真的发生」。
 *
 * 用独立的 --user-data-dir 启动,不会读写你真实的 ClaudeDeck 配置。
 * 会产生少量真实 API 调用。
 */
import { _electron as electron } from 'playwright'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const USER_DATA = mkdtempSync(join(tmpdir(), 'claudedeck-e2e-ud-'))
const WORKSPACE = mkdtempSync(join(tmpdir(), 'claudedeck-e2e-ws-'))

/** 等本轮真正结束 —— 发送⇄停止共用一个位置,必须等它回到 send 态 */
async function settle(page) {
  await page.waitForSelector('.composer [data-state="send"]', { timeout: 120_000 })
}

/** 发一条消息:先确认按钮处于 send 态,再点 */
async function send(page) {
  await settle(page)
  await page.click('.composer [data-state="send"]')
}

let passed = 0
let failed = 0
function check(label, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// 预置配置,跳过首启引导与原生目录选择框(那是系统对话框,自动化驱动不了)
mkdirSync(USER_DATA, { recursive: true })
writeFileSync(
  join(USER_DATA, 'config.json'),
  JSON.stringify(
    {
      baseUrl: '',
      apiKeyCipher: null,
      workspaces: [WORKSPACE],
      activeWorkspace: WORKSPACE,
      model: null,
      effort: 'low',
      permissionMode: 'bypassPermissions',
    },
    null,
    2,
  ),
)

console.log(`用户数据:${USER_DATA}\n工作目录:${WORKSPACE}\n`)

const app = await electron.launch({
  args: ['.', `--user-data-dir=${USER_DATA}`],
  cwd: ROOT,
})

try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // ---- 桥接层 -------------------------------------------------------------
  console.log('[0/3] 进程桥接')
  const bridged = await page.evaluate(() => typeof window.api?.chat?.send === 'function')
  check('preload 的 contextBridge 生效', bridged)

  await page.waitForSelector('.composer textarea', { timeout: 20_000 })
  check('直接进入主界面(未卡在引导页)', true)

  // ---- 功能 1:聊天 -------------------------------------------------------
  console.log('\n[1/3] 聊天')
  await page.fill('.composer textarea', '只回复两个字:你好')
  await send(page)

  await page.waitForFunction(
    () => document.querySelectorAll('.msg-claude').length > 0,
    { timeout: 90_000 },
  )
  const reply = (await page.textContent('.msg-claude')) ?? ''
  check('界面上出现 Claude 的回复', reply.trim().length > 0, JSON.stringify(reply.trim().slice(0, 30)))

  const userBubble = await page.textContent('.msg-user')
  check('用户消息也在界面上', (userBubble ?? '').includes('你好'))

  await settle(page)

  // ---- 功能 2:切换模型 ---------------------------------------------------
  console.log('\n[2/3] 切换模型')
  const options = await page.$$eval('select[data-control="model"]', (sels) =>
    Array.from(sels[0].options).map((o) => ({ value: o.value, label: o.textContent })),
  )
  check('模型下拉已由 SDK 填充', options.length > 1, `${options.length} 项`)
  console.log('        ' + options.map((o) => `${o.label} (${o.value})`).join('\n        '))

  const haiku = options.find((o) => /haiku/i.test(o.value))
  if (haiku) {
    await page.selectOption('select[data-control="model"]', haiku.value)
    const now = await page.$eval('select[data-control="model"]', (s) => s.value)
    check('下拉切换到 Haiku', now === haiku.value, now)

    const before = await page.$$eval('.msg-claude', (n) => n.length)
    await page.fill('.composer textarea', '只回复两个字:收到')
    await send(page)
    await page.waitForFunction(
      (n) => document.querySelectorAll('.msg-claude').length > n,
      before,
      { timeout: 90_000 },
    )
    check('切换模型后仍能继续对话(历史未丢)', true,
      `助手消息 ${before} → ${before + 1}`)
    const stillThere = await page.textContent('.msg-user')
    check('切换后第一条用户消息仍在', (stillThere ?? '').includes('你好'))
  } else {
    check('下拉中存在 Haiku 选项', false)
  }

  // ---- 功能 3:会话列表与切换 ---------------------------------------------
  console.log('\n[3/3] 会话列表与切换')
  await page.waitForFunction(
    () => document.querySelectorAll('.sidebar-scroll .session-row').length > 0,
    { timeout: 30_000 },
  )
  const firstCount = await page.$$eval('.sidebar-scroll .session-row', (n) => n.length)
  check('侧边栏出现历史会话', firstCount > 0, `${firstCount} 条`)

  // 新建一个会话,让列表里有两条可切换
  await page.click('.sidebar-new button')
  await page.fill('.composer textarea', '只回复两个字:第二')
  await send(page)
  await page.waitForFunction(
    () => document.querySelectorAll('.msg-claude').length > 0,
    { timeout: 90_000 },
  )
  await page.waitForFunction(
    (n) => document.querySelectorAll('.sidebar-scroll .session-row').length > n,
    firstCount,
    { timeout: 30_000 },
  )
  const secondCount = await page.$$eval('.sidebar-scroll .session-row', (n) => n.length)
  check('新会话进入列表', secondCount > firstCount, `${firstCount} → ${secondCount}`)

  // 点回第一条,历史应当被载入
  const items = await page.$$('.sidebar-scroll .session-row')
  await items[items.length - 1].click()
  await page.waitForFunction(
    () => {
      const bodies = Array.from(document.querySelectorAll('.msg-user'))
      return bodies.some((b) => b.textContent?.includes('你好'))
    },
    { timeout: 30_000 },
  )
  check('点击旧会话载入了它的历史', true, '找到第一轮的「你好」')

  const marked = await page.$$eval('.session-row[aria-current="true"]', (n) => n.length)
  check('被选中的会话有选中态', marked === 1, `${marked} 个高亮`)
} catch (err) {
  failed++
  console.error('\n异常:', err?.message ?? err)
} finally {
  await app.close().catch(() => {})
  rmSync(USER_DATA, { recursive: true, force: true })
  rmSync(WORKSPACE, { recursive: true, force: true })
}

console.log(`\n${passed} 通过,${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
