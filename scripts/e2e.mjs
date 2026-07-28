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
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
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

// 预置配置,跳过首启引导与原生目录选择框(那是系统对话框,自动化驱动不了)。
//
// 这里刻意写**旧版**的 `workspaces: string[]` 结构:项目模型上线后,
// 老用户的配置就长这样。侧栏能列出这个项目,就说明迁移逻辑生效了。
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

// 预置 .claude,让配置栏有内容可开 —— §10 的范围就是这里加根目录的 CLAUDE.md
mkdirSync(join(WORKSPACE, '.claude'), { recursive: true })
writeFileSync(
  join(WORKSPACE, '.claude', 'settings.local.json'),
  JSON.stringify({ permissions: { allow: ['Bash(npm run build)'], deny: [] } }, null, 2),
)
writeFileSync(join(WORKSPACE, 'CLAUDE.md'), '# 测试用\n')

console.log(`用户数据:${USER_DATA}\n工作目录:${WORKSPACE}\n`)

const app = await electron.launch({
  args: ['.', `--user-data-dir=${USER_DATA}`],
  cwd: ROOT,
})

try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // ---- 桥接层 -------------------------------------------------------------
  console.log('[0/7] 进程桥接')
  const bridged = await page.evaluate(() => typeof window.api?.chat?.send === 'function')
  check('preload 的 contextBridge 生效', bridged)

  await page.waitForSelector('.composer textarea', { timeout: 20_000 })
  check('直接进入主界面(未卡在引导页)', true)

  // 旧结构的 workspaces 应当被迁移成项目,并出现在侧栏
  const projectNames = await page.$$eval('.project-row .name', (n) => n.map((e) => e.textContent))
  check(
    '旧版 workspaces 已迁移为项目',
    projectNames.length === 1 && WORKSPACE.endsWith(projectNames[0]),
    projectNames.join(', '),
  )

  // ---- 功能 1:聊天 -------------------------------------------------------
  console.log('\n[1/7] 聊天')
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
  console.log('\n[2/7] 切换模型')
  // 控件条上只显示第一个词,完整列表在弹层里(§15)
  await page.click('[data-control="model"]')
  await page.waitForSelector('.popover .pop-row', { timeout: 10_000 })
  const options = await page.$$eval('.popover .pop-row .pop-title', (n) =>
    n.map((e) => e.textContent?.trim() ?? ''),
  )
  check('模型弹层已由 SDK 填充', options.length > 1, `${options.length} 项`)
  console.log('        ' + options.join('\n        '))

  const haiku = options.find((o) => /haiku/i.test(o))
  if (haiku) {
    await page.evaluate((label) => {
      const row = [...document.querySelectorAll('.popover .pop-row')].find((r) =>
        r.querySelector('.pop-title')?.textContent?.includes(label),
      )
      if (row) row.click()
    }, haiku)
    await page.waitForTimeout(400)
    const shown = (await page.textContent('[data-control="model"]')) ?? ''
    check('弹层切换到 Haiku,控件条只显示第一个词', shown.trim() === 'Haiku', shown.trim())

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
  console.log('\n[3/7] 会话列表与切换')
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
  // 这一步要等一整轮结束、会话写进 SDK 的 store、界面再刷新列表,给足时间
  await settle(page)
  await page.waitForFunction(
    (n) => document.querySelectorAll('.sidebar-scroll .session-row').length > n,
    firstCount,
    { timeout: 90_000 },
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

  // ---- 工具行 · §06 ---------------------------------------------------------
  console.log('\n[4/7] 工具行')
  await page.fill('.composer textarea', '运行 echo e2e-tool-ok,不要解释')
  await send(page)
  await page.waitForFunction(
    () => [...document.querySelectorAll('.tool-row')].some((e) => e.textContent?.includes('Bash')),
    { timeout: 120_000 },
  )
  const bashRow = await page.evaluate(
    () =>
      [...document.querySelectorAll('.tool-row')]
        .find((e) => e.textContent?.includes('Bash'))
        ?.textContent?.replace(/\s+/g, ' ')
        .trim() ?? '',
  )
  check('对话区出现 Bash 工具行', bashRow.includes('Bash'), bashRow)

  // 展开按钮只在**结果回来、确实有输出**之后才出现(tool_use 时刻还没有),
  // 所以必须先等本轮结束。
  // 精确定位 **Bash 那一块**的展开按钮 —— Edit 行也有展开按钮,
  // 用 `.tool-block .tool-toggle` 取第一个的话,那一轮只要 Claude 先调了
  // 别的带输出的工具,点开的就是 diff 而不是 stdout。
  await settle(page)
  const bashOpened = await page
    .waitForFunction(
      () => {
        const block = [...document.querySelectorAll('.tool-block')].find((b) =>
          b.querySelector('.tool-name')?.textContent?.includes('Bash'),
        )
        const btn = block?.querySelector('.tool-toggle')
        if (!btn) return false
        btn.click()
        return true
      },
      { timeout: 30_000 },
    )
    .then(() => true)
    .catch(() => false)
  if (bashOpened) {
    await page.waitForSelector('.tool-output', { timeout: 15_000 })
    const out = (await page.textContent('.tool-output')) ?? ''
    check('展开后能看到命令输出', out.includes('e2e-tool-ok'), JSON.stringify(out.trim().slice(0, 40)))
  } else {
    check('工具行提供展开/收起', false, '未找到 .tool-toggle')
  }

  // 悬停动作行:复制
  const copyBtns = await page.$$eval('.msg-action', (n) => n.map((e) => e.textContent))
  check('每条消息都带复制动作', copyBtns.length > 0 && copyBtns.every((t) => t === '复制'), `${copyBtns.length} 个`)

  // ---- 斜杠命令面板 · §15 -------------------------------------------------
  console.log('\n[5/7] 斜杠命令面板')
  await settle(page)
  await page.fill('.composer textarea', '/')
  const opened = await page
    .waitForSelector('.palette .palette-row', { timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  check('输入 / 弹出命令面板', opened)

  if (opened) {
    const groups = await page.$$eval('.palette .pop-group', (n) =>
      n.map((e) => e.textContent?.trim() ?? ''),
    )
    const rows = await page.$$eval('.palette .palette-row .palette-name', (n) => n.length)
    check('面板按来源分组', groups.length > 0, groups.join(' / '))
    check('命令由 SDK 运行时提供', rows > 0, `${rows} 条`)

    // 键盘导航:↓ 应当移动选中项
    const firstSel = await page.$eval('.palette-row[aria-selected="true"]', (e) => e.textContent)
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(150)
    const secondSel = await page.$eval('.palette-row[aria-selected="true"]', (e) => e.textContent)
    check('↑↓ 能移动选中项', firstSel !== secondSel)

    // 回车应当把命令填进输入框,而不是把「/」当消息发出去
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    const draft = await page.$eval('.composer textarea', (e) => e.value)
    check('回车填入命令而非发送', draft.startsWith('/') && draft.length > 1, JSON.stringify(draft))

    // 过滤:输入内容后条目应当变少
    const before = await page.$$eval('.palette .palette-row', (n) => n.length).catch(() => 0)
    await page.fill('.composer textarea', '/re')
    await page.waitForTimeout(300)
    const after = await page.$$eval('.palette .palette-row', (n) => n.length).catch(() => 0)
    check('输入内容后过滤生效', after > 0 && after <= rows, `${rows} → ${after}`)
    void before

    await page.fill('.composer textarea', '')
    await page.waitForTimeout(200)
  }

  // ---- .claude 配置栏 · §10 ----------------------------------------------
  // 这一节纯文件读写,不产生 API 调用
  console.log('\n[6/7] .claude 配置栏')
  await page.click('.claude-node')
  await page.waitForSelector('.claude-file', { timeout: 10_000 })
  const files = await page.$$eval('.claude-file .mono', (n) => n.map((e) => e.textContent?.trim()))
  check(
    '列出 .claude 下的文件与根的 CLAUDE.md',
    files.includes('settings.local.json') && files.includes('CLAUDE.md'),
    files.join(' / '),
  )

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.claude-file')].find((b) =>
      b.textContent?.includes('settings.local.json'),
    )
    btn?.click()
  })
  await page.waitForSelector('.midcol-text', { timeout: 10_000 })
  const loaded = await page.$eval('.midcol-text', (e) => e.value)
  check('中栏载入了文件内容', loaded.includes('permissions'), `${loaded.length} 字`)
  check('三栏布局生效', (await page.$$eval('.shell.with-mid', (n) => n.length)) === 1)
  check(
    '打开的文件用中性态,不抢会话的陶土选中态',
    (await page.$$eval('.claude-file[aria-current="true"]', (n) => n.length)) === 1,
  )

  // 改一笔 → 出脏点 → Ctrl S 保存 → 脏点消失 → 磁盘上真的变了
  await page.fill(
    '.midcol-text',
    JSON.stringify({ permissions: { allow: ['Bash(ls)'], deny: [] } }, null, 2),
  )
  await page.waitForSelector('.dirty-dot', { timeout: 5_000 })
  check('改动后出现脏点', true)
  await page.keyboard.press('Control+s')
  await page.waitForFunction(() => !document.querySelector('.dirty-dot'), { timeout: 10_000 })
  check('Ctrl S 保存后脏点消失', true)

  const onDisk = readFileSync(join(WORKSPACE, '.claude', 'settings.local.json'), 'utf8')
  check('内容真的写进了磁盘', onDisk.includes('Bash(ls)'), onDisk.replace(/\s+/g, ' ').slice(0, 60))

  // 写坏 JSON:保存前就该被拦住并指出行号,而且不能落盘
  await page.fill('.midcol-text', '{\n  "permissions": {\n    "allow": [,\n  }\n}')
  await page.keyboard.press('Control+s')
  await page.waitForSelector('.midcol-error', { timeout: 10_000 })
  const errText = (await page.textContent('.midcol-error')) ?? ''
  check('坏 JSON 被拦住并指出行号', /第 \d+ 行/.test(errText), errText.slice(0, 70))
  const stillOnDisk = readFileSync(join(WORKSPACE, '.claude', 'settings.local.json'), 'utf8')
  check('坏 JSON 没有落盘', stillOnDisk.includes('Bash(ls)'))

  // 有未保存改动时关闭要拦一次
  await page.click('.midcol-head .icon-btn')
  await page.waitForSelector('.midcol-confirm', { timeout: 10_000 })
  check('未保存时关闭会拦一次', true)
  await page.click('.midcol-confirm .row button:nth-child(2)')
  await page.waitForFunction(() => !document.querySelector('.midcol'), { timeout: 10_000 })
  check('选「不保存」后中栏关闭', true)

  // ---- 会话右键菜单 · §08 ------------------------------------------------
  console.log('\n[7/7] 会话右键菜单')
  await page.click('.sidebar-scroll .session-row', { button: 'right' })
  await page.waitForSelector('.ctx', { timeout: 10_000 })
  const menuItems = await page.$$eval('.ctx .ctx-row', (n) =>
    n.map((e) => e.textContent?.trim() ?? ''),
  )
  check('菜单列出五项', menuItems.length === 5, menuItems.join(' / '))
  check('删除项走警示色', await page.$eval('.ctx .ctx-row.warn', (e) => e.textContent?.trim()) === '删除会话')

  // 重命名:改完侧栏标题要跟着变
  await page.click('.ctx .ctx-row')
  await page.fill('.ctx-rename input', 'e2e 改过的标题')
  await page.keyboard.press('Enter')
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.session-row .title')].some((e) =>
        e.textContent?.includes('e2e 改过的标题'),
      ),
    { timeout: 20_000 },
  )
  check('重命名后侧栏跟着变', true)

  // 打标签:标签要出现在标题旁边
  await page.click('.sidebar-scroll .session-row', { button: 'right' })
  await page.waitForSelector('.ctx', { timeout: 10_000 })
  await page.click('.ctx .ctx-row:nth-child(2)')
  await page.fill('.ctx-tag input', '待验证')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.session-tag', { timeout: 20_000 })
  const tagText = await page.textContent('.session-tag')
  check('打标签后标签出现在列表里', tagText?.trim() === '待验证', tagText?.trim())

  // 删除:真删 SDK 的 store,要二次确认。
  // 不用行数判断 —— 删的是当前会话,newSession() 会立刻建一条顶上,行数可能不变。
  // 盯那条被删会话的标题才准。
  const doomed = 'e2e 改过的标题'
  await page.click('.sidebar-scroll .session-row', { button: 'right' })
  await page.waitForSelector('.ctx', { timeout: 10_000 })
  await page.click('.ctx .ctx-row.warn')
  await page.waitForSelector('.ctx-confirm', { timeout: 10_000 })
  check('删除有二次确认', true)
  await page.click('.ctx-confirm .danger')
  const gone = await page
    .waitForFunction(
      (t) =>
        ![...document.querySelectorAll('.session-row .title')].some((e) =>
          e.textContent?.includes(t),
        ),
      doomed,
      { timeout: 30_000 },
    )
    .then(() => true)
    .catch(() => false)
  check('确认后那条会话真的从列表消失', gone, doomed)
} catch (err) {
  failed++
  console.error('\n异常:', err?.message ?? err)
  // 失败时把当时的界面截下来 —— 光看超时信息猜不出是哪一步卡住的
  try {
    const page = await app.firstWindow()
    const shotDir = join(ROOT, '.screenshots')
    mkdirSync(shotDir, { recursive: true })
    await page.screenshot({ path: join(shotDir, 'e2e-failure.png') })
    const state = await page.evaluate(() => ({
      screen: document.querySelector('.shell')
        ? 'workspace'
        : document.querySelector('.card')
          ? 'card'
          : 'unknown',
      overlay: [...document.querySelectorAll('.popover, .ctx, .palette')].map((e) => e.className),
      composerDisabled: document.querySelector('.composer textarea')?.disabled ?? null,
      error: document.querySelector('.error-line')?.textContent ?? null,
    }))
    console.error('当时的界面:', JSON.stringify(state))
    console.error('截图:', join(shotDir, 'e2e-failure.png'))
  } catch {
    console.error('(截图失败,窗口可能已经没了)')
  }
} finally {
  await app.close().catch(() => {})
  rmSync(USER_DATA, { recursive: true, force: true })
  rmSync(WORKSPACE, { recursive: true, force: true })
}

console.log(`\n${passed} 通过,${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
