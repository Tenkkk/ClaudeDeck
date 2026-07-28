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

/*
 * ⚠️ page.waitForFunction 的签名是 (fn, arg, options)。
 * 只传两个参数的话,{ timeout } 会被当成**传给页面函数的实参**,超时悄悄退回
 * 默认的 30 秒 —— 我原先十几处都这么写,注释里写着 90 秒,实际一直是 30 秒,
 * 直到某次回答慢了才暴露。没有实参就显式写 undefined 占住那一位。
 */

/** 等本轮真正结束 —— 发送⇄停止共用一个位置,必须等它回到 send 态 */
async function settle(page) {
  await page.waitForSelector('.composer [data-state="send"]', { timeout: 120_000 })
}

/** 发一条消息:先确认按钮处于 send 态,再点 */
async function send(page) {
  await settle(page)
  await page.click('.composer [data-state="send"]')
}

/** 在模型弹层里按显示名挑一个。弹层没开就先点开。 */
async function pickModel(page, label) {
  const open = await page.$$eval('.pop-desc', (n) => n.length)
  if (open === 0) await page.click('[data-control="model"]')
  await page.waitForSelector('.popover .pop-row', { timeout: 10_000 })
  await page.evaluate((l) => {
    const row = [...document.querySelectorAll('.popover .pop-row')].find((r) =>
      r.querySelector('.pop-title')?.textContent?.includes(l),
    )
    if (row) row.click()
  }, label)
  await page.waitForTimeout(400)
}

/**
 * 只跑指定的几节:
 *
 *   node scripts/e2e.mjs --only 10,11
 *
 * 每跑一次全量要十几分钟、几十次真实 API 调用,而多数时候我只改了一节 ——
 * 为了看一条断言从「你好」重跑一遍整个套件毫无意义。
 *
 * 第 0 节(引导与桥接)永远跑,它是别的节的地基。各节的变量互不引用,
 * 所以单开某一节不会引用到未定义的东西;但**状态是累积的** ——
 * 比如第 3 节要有历史会话、第 8 节要有会话可删,单跑它们可能因为
 * 前置状态不在而失败,那是预期内的,不是回归。
 */
const ONLY = (() => {
  const at = process.argv.indexOf('--only')
  if (at < 0) return null
  return new Set((process.argv[at + 1] ?? '').split(',').map((s) => Number(s.trim())))
})()
const want = (n) => ONLY === null || ONLY.has(n)
if (ONLY) console.log(`只跑第 ${[...ONLY].join('、')} 节
`)

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
  console.log('[0/11] 进程桥接')
  const bridged = await page.evaluate(() => typeof window.api?.chat?.send === 'function')
  check('preload 的 contextBridge 生效', bridged)

  await page.waitForSelector('.composer textarea', { timeout: 20_000 })
  check('直接进入主界面(未卡在引导页)', true)

  // 无边框窗口:标题栏是自绘的,那三颗窗口按钮必须在 —— 少一颗就只能
  // 去任务管理器结束进程
  const ctl = await page.$$eval('.titlebar .win-ctl', (n) => n.length)
  check('自绘标题栏有三颗窗口按钮', ctl === 3, `${ctl} 颗`)
  const dragRegion = await page.$eval('.titlebar', (e) => getComputedStyle(e).webkitAppRegion)
  check('标题栏是拖拽区', dragRegion === 'drag', dragRegion)
  const btnRegion = await page.$eval('.titlebar-right', (e) => getComputedStyle(e).webkitAppRegion)
  check('按钮区不是拖拽区', btnRegion === 'no-drag', btnRegion)

  // 侧栏收起
  await page.click('.titlebar-left .win-btn')
  await page.waitForFunction(() => !document.querySelector('.sidebar'), undefined, {
    timeout: 5_000,
  })
  check('侧栏能收起', (await page.$$eval('.shell.no-sidebar', (n) => n.length)) === 1)
  await page.click('.titlebar-left .win-btn')
  await page.waitForSelector('.sidebar', { timeout: 5_000 })
  check('侧栏能再展开', true)

  // 新建会话移到品牌行,不再有那一整行与快捷键标注
  const brandBtn = await page.$$eval('.sidebar-brand .icon-btn', (n) => n.length)
  check('新建会话在品牌行', brandBtn === 1)
  check('原来那一整行已去掉', (await page.$$eval('.new-session', (n) => n.length)) === 0)

  // 旧结构的 workspaces 应当被迁移成项目,并出现在侧栏
  const projectNames = await page.$$eval('.project-row .name', (n) => n.map((e) => e.textContent))
  check(
    '旧版 workspaces 已迁移为项目',
    projectNames.length === 1 && WORKSPACE.endsWith(projectNames[0]),
    projectNames.join(', '),
  )

  // ---- 功能 1:聊天 -------------------------------------------------------
  if (want(1)) {
    console.log('\n[1/11] 聊天')
    await page.fill('.composer textarea', '只回复两个字:你好')
    await send(page)

    await page.waitForFunction(
      () => document.querySelectorAll('.msg-claude').length > 0,
      undefined,
      { timeout: 90_000 },
    )
    const reply = (await page.textContent('.msg-claude')) ?? ''
    check('界面上出现 Claude 的回复', reply.trim().length > 0, JSON.stringify(reply.trim().slice(0, 30)))

    const userBubble = await page.textContent('.msg-user')
    check('用户消息也在界面上', (userBubble ?? '').includes('你好'))

    await settle(page)

    // ---- 功能 2:切换模型 ---------------------------------------------------
  }
  if (want(2)) {
    console.log('\n[2/11] 切换模型')
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
  }
  if (want(3)) {
    console.log('\n[3/11] 会话列表与切换')
    await page.waitForFunction(
      () => document.querySelectorAll('.sidebar-scroll .session-row').length > 0,
      undefined,
      { timeout: 30_000 },
    )
    const firstCount = await page.$$eval('.sidebar-scroll .session-row', (n) => n.length)
    check('侧边栏出现历史会话', firstCount > 0, `${firstCount} 条`)

    // 新建一个会话,让列表里有两条可切换
    await page.click('.sidebar-brand .icon-btn')
    await page.fill('.composer textarea', '只回复两个字:第二')
    await send(page)
    await page.waitForFunction(
      () => document.querySelectorAll('.msg-claude').length > 0,
      undefined,
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
      undefined,
      { timeout: 30_000 },
    )
    check('点击旧会话载入了它的历史', true, '找到第一轮的「你好」')

    const marked = await page.$$eval('.session-row[aria-current="true"]', (n) => n.length)
    check('被选中的会话有选中态', marked === 1, `${marked} 个高亮`)

    // ---- 工具行 · §06 ---------------------------------------------------------
  }
  if (want(4)) {
    console.log('\n[4/11] 工具行')
    await page.fill('.composer textarea', '运行 echo e2e-tool-ok,不要解释')
    await send(page)
    await page.waitForFunction(
      () => [...document.querySelectorAll('.tool-row')].some((e) => e.textContent?.includes('Bash')),
      undefined,
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
    // .msg-action 现在既是「复制」也是「↳ 分支」,只数复制那一种
    const copyBtns = await page.$$eval('.msg-action', (n) =>
      n.map((e) => e.textContent?.trim() ?? '').filter((t) => t === '复制'),
    )
    check('每条消息都带复制动作', copyBtns.length > 0, `${copyBtns.length} 个`)

    // ---- 斜杠命令面板 · §15 -------------------------------------------------
  }
  if (want(5)) {
    console.log('\n[5/11] 斜杠命令面板')
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

    // ---- 从这条重答:分支与文件回退 · §12 -----------------------------------
  }
  if (want(6)) {
    console.log('\n[6/11] 分支与文件回退')
    // 消息 id 是每轮结束后从 store 重载才有的 —— 直播流里的用户消息不带 uuid
    const forkable = await page
      .waitForFunction(
        () => [...document.querySelectorAll('.msg-action')].some((b) => b.textContent?.includes('↳')),
        undefined,
        { timeout: 30_000 },
      )
      .then(() => true)
      .catch(() => false)
    check('消息上出现「↳」分支入口', forkable)

    if (forkable) {
      const beforeFork = await page.$$eval('.sidebar-scroll .session-row', (n) => n.length)
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.msg-action')].find((b) =>
          b.textContent?.includes('从这里重答'),
        )
        btn?.click()
      })
      await page.waitForSelector('.fork-card', { timeout: 10_000 })
      check('弹出分支确认', true)

      // 「能回退 N 个文件」必须来自真的 dryRun,不能是编的
      await page.waitForFunction(
        () => !document.querySelector('.fork-check .hint')?.textContent?.includes('正在确认'),
        undefined,
        { timeout: 20_000 },
      )
      const rewindHint = (await page.textContent('.fork-check .hint')) ?? ''
      check('回退提示来自真实的 dryRun', rewindHint.length > 0 && !rewindHint.includes('正在确认'), rewindHint.slice(0, 50))

      await page.click('.fork-card .primary')
      await page.waitForFunction(
        (n) => document.querySelectorAll('.sidebar-scroll .session-row').length > n,
        beforeFork,
        { timeout: 60_000 },
      )
      const afterFork = await page.$$eval('.sidebar-scroll .session-row', (n) => n.length)
      check('分支后侧栏多出一条', afterFork > beforeFork, `${beforeFork} → ${afterFork}`)
      const titles = await page.$$eval('.session-row .title', (n) => n.map((e) => e.textContent ?? ''))
      check('分支标题带「分支」', titles.some((t) => t.includes('分支')), titles.find((t) => t.includes('分支')) ?? titles.join(' / '))
    }

    // ---- .claude 配置栏 · §10 ----------------------------------------------
    // 这一节纯文件读写,不产生 API 调用
  }
  if (want(7)) {
    console.log('\n[7/11] 文件树与配置读写')
    // 每个项目下都有「文件」入口(原先只有当前聚焦的项目才有 .claude 节点)
    const fileNodes = await page.$$eval('.claude-node', (n) => n.length)
    const projectCount = await page.$$eval('.project-row', (n) => n.length)
    check('每个项目都有文件入口', fileNodes === projectCount, `${fileNodes} / ${projectCount} 个项目`)

    await page.click('.claude-node')
    await page.waitForSelector('.file-row', { timeout: 10_000 })
    const rootNames = await page.$$eval('.file-row .file-name', (n) => n.map((e) => e.textContent?.trim()))
    check(
      '列出项目根:.claude 是里面的一个普通文件夹',
      rootNames.includes('.claude') && rootNames.includes('CLAUDE.md'),
      rootNames.join(' / '),
    )
    check('三栏布局生效', (await page.$$eval('.shell.with-mid', (n) => n.length)) === 1)

    // 展开 .claude —— 一次只列一层,展开才有下一层
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.file-row')].find((b) =>
        b.textContent?.trim().startsWith('.claude'),
      )
      row?.click()
    })
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.file-row .file-name')].some(
          (e) => e.textContent?.trim() === 'settings.local.json',
        ),
      undefined,
      { timeout: 10_000 },
    )
    check('展开目录才列出下一层', true, 'settings.local.json')

    // 可写的标出来,源码之类只读
    const editableTags = await page.$$eval('.file-tag', (n) => n.length)
    check('可改的文件标了出来', editableTags > 0, `${editableTags} 个`)

    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.file-row')].find(
        (b) => b.querySelector('.file-name')?.textContent?.trim() === 'settings.local.json',
      )
      row?.click()
    })
    await page.waitForSelector('.midcol-text', { timeout: 10_000 })
    const loaded = await page.$eval('.midcol-text', (e) => e.value)
    check('中栏载入了文件内容', loaded.includes('permissions'), `${loaded.length} 字`)

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

    // 有未保存改动时,返回和关闭都要拦一次,而且拦完要按当初点的那一颗走。
    // 先试「返回」:确认之后应当退回文件树,而不是把整栏关掉。
    await page.click('.midcol-back')
    await page.waitForSelector('.midcol-confirm', { timeout: 10_000 })
    check('未保存时返回会拦一次', true)
    await page.click('.midcol-confirm .row button:nth-child(2)')
    await page.waitForFunction(
      () => document.querySelectorAll('.midcol-text').length === 0,
      undefined,
      { timeout: 10_000 },
    )
    check('选「不保存」后退回文件树', (await page.$$eval('.file-row', (n) => n.length)) > 0)

    // 源码类文件只读 —— 看得见不等于能改
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.file-row')].find(
        (b) => b.querySelector('.file-name')?.textContent?.trim() === 'CLAUDE.md',
      )
      row?.click()
    })
    await page.waitForSelector('.midcol-text', { timeout: 10_000 })
    check('CLAUDE.md 可写,不标只读', (await page.$$eval('.midcol-ro', (n) => n.length)) === 0)

    // ✕ 是关掉整栏,不是退回树 —— 两颗按钮各管各的
    await page.click('.midcol-head .icon-btn:last-of-type')
    await page.waitForFunction(() => !document.querySelector('.midcol'), undefined, {
      timeout: 10_000,
    })
    check('✕ 关掉整栏', (await page.$$eval('.shell.with-mid', (n) => n.length)) === 0)

    // 搜索面板:跨项目按标题过滤,Esc 关闭
    await page.click('.titlebar-left .win-btn:last-child')
    await page.waitForSelector('.search-panel', { timeout: 10_000 })
    const allRows = await page.$$eval('.search-row', (n) => n.length)
    check('搜索面板列出会话', allRows > 0, `${allRows} 条`)
    // 关键词从现有标题里取,不写死 —— 标题是 Claude 生成的,写死就等着它变
    const sample = await page.$eval('.search-title', (e) => (e.textContent ?? '').trim().slice(-3))
    await page.fill('.search-input', sample)
    await page.waitForTimeout(250)
    const hits = await page.$$eval('.search-title', (n) => n.map((e) => e.textContent?.trim() ?? ''))
    check(
      '过滤生效且结果都相关',
      hits.length > 0 && hits.length <= allRows && hits.every((t) => t.includes(sample)),
      `「${sample}」→ ${hits.length}/${allRows}`,
    )
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.search-panel'), undefined, {
      timeout: 5_000,
    })
    check('Esc 关闭搜索', true)

    // 设置对话框:接管情况 + 凭据 + 主题 + 关于
    await page.click('.settings-btn')
    await page.waitForSelector('.dialog', { timeout: 10_000 })
    const setText = await page.$eval('.dialog-body', (e) => e.textContent ?? '')
    check('设置里写明 Claude Code 来源', /随安装包分发|系统 PATH/.test(setText))
    check('设置里有 Base URL 与密钥', /Base URL/.test(setText) && /API Key/.test(setText))
    check('密钥不回读明文', (await page.$eval('.dialog input[type=password]', (e) => e.value)) === '')
    await page.click('.dialog-head .icon-btn')
    await page.waitForFunction(() => !document.querySelector('.dialog'), undefined, {
      timeout: 5_000,
    })

    // 展开全部之后要能收回去
    const expandBtn = await page.$('.expand-all')
    if (expandBtn) {
      const before = await page.$$eval('.session-row', (n) => n.length)
      await expandBtn.click()
      const expanded = await page.$$eval('.session-row', (n) => n.length)
      await page.click('.expand-all')
      const collapsed = await page.$$eval('.session-row', (n) => n.length)
      check('展开全部之后能收回去', expanded > before && collapsed === before, `${before} → ${expanded} → ${collapsed}`)
    }

    // ---- 会话右键菜单 · §08 ------------------------------------------------
  }
  if (want(8)) {
    console.log('\n[8/11] 会话右键菜单')
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
      undefined,
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

    // ---- 实测反馈的七项 ------------------------------------------------------
    // 这一节全是用户装完之后逐条指出来的问题。钉在这儿,免得下次又要靠手点才发现。
  }
  if (want(9)) {
    console.log('\n[9/11] 实测反馈的七项')

    // 1 模型弹层:有描述,没有那列没意义的编号
    await page.click('[data-control="model"]')
    await page.waitForSelector('.pop-row', { timeout: 10_000 })
    const modelDescs = await page.$$eval('.pop-desc', (n) => n.map((e) => e.textContent?.trim() ?? ''))
    check('模型带上了描述', modelDescs.length > 0 && modelDescs[0].length > 0, modelDescs[0] ?? '')
    const indexCol = await page.$$eval('.pop-index', (n) => n.length)
    check('去掉了 CLI 的键盘序号', indexCol === 0, `${indexCol} 个`)

    // 3a 档位由模型决定:Haiku 的 ModelInfo 里没有 supportedEffortLevels,
    //    也就是它根本不支持努力程度,控件该是禁用的而不是画五个点让人白点。
    await pickModel(page, 'Haiku')
    const effortDisabled = await page.$eval('[data-control="effort"]', (e) => e.disabled)
    check('选中 Haiku 时努力控件禁用', effortDisabled === true)

    // 3b 换回支持努力的模型,滑块要能拖
    await pickModel(page, 'Default')
    const effortBack = await page.$eval('[data-control="effort"]', (e) => e.disabled)
    check('换回 Default 后努力控件恢复', effortBack === false)

    await page.click('[data-control="effort"]')
    await page.waitForSelector('.effort-track', { timeout: 10_000 })
    const track = await page.$('.effort-track')
    const box = await track.boundingBox()
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 8 })
    const draggedTo = await page.$eval('.effort-track', (e) => e.getAttribute('aria-valuenow'))
    await page.mouse.up()
    check('努力滑块能拖动', draggedTo === '5', `拖到第 ${draggedTo} 档`)

    // 2 两栏之间的竖线能拖,且拖不过下限
    const beforeW = await page.$eval('.shell', (e) => e.style.getPropertyValue('--w-sidebar'))
    const rb = await (await page.$('.resizer-sidebar')).boundingBox()
    await page.mouse.move(rb.x + rb.width / 2, rb.y + 200)
    await page.mouse.down()
    await page.mouse.move(rb.x + 120, rb.y + 200, { steps: 6 })
    await page.mouse.up()
    const afterW = await page.$eval('.shell', (e) => e.style.getPropertyValue('--w-sidebar'))
    check('侧栏竖线能拖动', beforeW !== afterW, `${beforeW} → ${afterW}`)
    // 手柄跟着侧栏移动了,坐标必须重新取 —— 拿旧坐标去按,按的是空处,
    // 那样这条断言只会空过一遍
    const rb2 = await (await page.$('.resizer-sidebar')).boundingBox()
    await page.mouse.move(rb2.x + rb2.width / 2, rb2.y + 200)
    await page.mouse.down()
    await page.mouse.move(rb2.x - 400, rb2.y + 200, { steps: 6 })
    await page.mouse.up()
    const floored = await page.$eval('.shell', (e) => e.style.getPropertyValue('--w-sidebar'))
    check(
      '拖到底也不会小于最小宽度',
      floored !== afterW && parseInt(floored, 10) === 200,
      `${afterW} → ${floored}`,
    )

    // 5 左下角是齿轮,点开是完整设置(不再是那个小浮窗)
    const gear = await page.$$eval('.settings-btn', (n) => n.length)
    check('左下角出现齿轮入口', gear === 1)
    await page.click('.settings-btn')
    await page.waitForSelector('.dialog-body', { timeout: 10_000 })
    const aboutText = await page.$eval('.dialog-body', (e) => e.textContent ?? '')
    check('设置里有版本信息', /ClaudeDeck/.test(aboutText), aboutText.slice(-40).trim())
    await page.click('.dialog-head .icon-btn')
    await page.waitForFunction(() => !document.querySelector('.dialog'), undefined, {
      timeout: 5_000,
    })

    // 4 /model 不该被当成消息发出去
    const msgsBefore = await page.$$eval('.msg-user', (n) => n.length)
    await page.fill('.composer textarea', '/model')
    await page.click('.composer [data-state="send"]')
    await page.waitForTimeout(500)
    const msgsAfter = await page.$$eval('.msg-user', (n) => n.length)
    check('/model 没有被发给 agent', msgsBefore === msgsAfter, `${msgsBefore} → ${msgsAfter}`)
    const popped = await page.$$eval('.pop-desc', (n) => n.length)
    check('/model 直接把模型弹层点开了', popped > 0)
    await page.keyboard.press('Escape')

    // 6 + 7:一发出去,侧栏立刻多一条,同时出现等待态
    await page.click('.sidebar-brand .icon-btn')
    await settle(page)
    const rowsBefore = await page.$$eval('.session-row', (n) => n.length)
    await page.fill('.composer textarea', '只回复两个字:好的')
    await page.click('.composer [data-state="send"]')

    // 3 秒 —— 这条断言的意义就在「及时」。上一版给了 30 秒宽限,
    // 于是「答完才出现」也算通过,等于什么都没测。
    const grew = await page
      .waitForFunction((n) => document.querySelectorAll('.session-row').length > n, rowsBefore, {
        timeout: 3_000,
      })
      .then(() => true)
      .catch(() => false)
    check('一发消息侧栏就多出这条(3 秒内)', grew, `${rowsBefore} 条起`)
    // 而且此刻这一轮还没答完 —— 否则「及时」是碰巧的
    const stillBusy = await page.$$eval('.composer [data-state="stop"]', (n) => n.length)
    check('出现时这一轮还在跑', stillBusy === 1)

    const thinkingText = await page
      .waitForSelector('.thinking', { timeout: 30_000 })
      .then((el) => el.textContent())
      .catch(() => null)
    check('等待时有进行中的反馈', thinkingText !== null, thinkingText?.trim())
    check('反馈里带着已用时长', /秒/.test(thinkingText ?? ''), thinkingText?.trim())
    await settle(page)
    const stillThinking = await page.$$eval('.thinking', (n) => n.length)
    check('答完就收起', stillThinking === 0)

    // ---- Claude 反问你 · §13 ---------------------------------------------------
    // 这条以前是「实现了但触发不到」。实测发现它根本不走 onUserDialog,而是走
    // canUseTool —— 直接放行的话工具就在无人作答的情况下跑完,模型收到
    // "The user did not answer the questions."。这一节就是钉住那条通道。
  }
  if (want(10)) {
    console.log('\n[10/11] Claude 反问你')
    await page.fill(
      '.composer textarea',
      '用 AskUserQuestion 问我一个问题,两个选项,第一个选项的 label 必须是「甲方案」。只做这一件事,不要解释。',
    )
    await page.click('.composer [data-state="send"]')

    const cardUp = await page
      .waitForSelector('.ask-card', { timeout: 120_000 })
      .then(() => true)
      .catch(() => false)
    check('反问卡真的弹出来了', cardUp)

    if (cardUp) {
      const opts = await page.$$eval('.ask-option .pop-title', (n) => n.map((e) => e.textContent?.trim()))
      check('卡里列出了选项', opts.length >= 2, opts.join(' / '))

      // 选中不等于提交 —— 卡片里有独立的「提交」按钮,要走完真实路径
      await page.click('.ask-option')
      const submitLabel = await page.$eval('.ask-card .row .primary', (e) => e.textContent?.trim())
      check('选完才让提交', submitLabel === '提交', submitLabel)
      await page.click('.ask-card .row .primary')

      // 作答后卡片收起,本轮继续走完
      const gone = await page
        .waitForFunction(() => document.querySelectorAll('.ask-card').length === 0, { timeout: 30_000 })
        .then(() => true)
        .catch(() => false)
      check('作答后卡片收起', gone)

      await settle(page)
      // 模型必须真的收到答案 —— 收不到的话它会说「你没选」
      const tail = await page.$$eval('.msg-claude', (n) => n[n.length - 1]?.textContent ?? '')
      check('模型没有收到「没人作答」', !/没.{0,2}(选|回答|作答)|did not answer/.test(tail), tail.trim().slice(0, 60))
    }

    // /mcp 由界面接管:直接问 SDK 要状态,画成面板。
    // 不再把命令发出去换一段「详情请去终端看」的降级文本回来。
    const before = await page.$$eval('.msg-claude', (n) => n.length)
    await page.fill('.composer textarea', '/mcp')
    await page.click('.composer [data-state="send"]')
    const panel = await page
      .waitForSelector('.mcp-panel', { timeout: 20_000 })
      .then(() => true)
      .catch(() => false)
    check('/mcp 画出服务面板', panel)
    if (panel) {
      // 面板是自己去取数据的,「正在读取…」也带 .hint —— 必须等它真的读完,
      // 否则选择器立刻就满足,断言测的是加载态
      await page.waitForFunction(
        () => !(document.querySelector('.mcp-panel')?.textContent ?? '').includes('正在读取'),
        undefined,
        { timeout: 30_000 },
      )
      const names = await page.$$eval('.mcp-name', (n) => n.map((e) => e.textContent?.trim()))
      const head = await page.$eval('.mcp-panel', (e) => e.textContent ?? '')
      check('面板里有服务或明确说没有', names.length > 0 || /没有配置/.test(head), names.join(', ').slice(0, 60))
      const statuses = await page.$$eval('.mcp-status', (n) => n.map((e) => e.textContent?.trim()))
      check('每个服务标了连接状态', names.length === statuses.length, statuses.join(', ').slice(0, 60))

      // 能点进去看工具 —— 原生 /mcp 就是可以回车进去的
      const openable = await page.$$('.mcp-main:not([disabled])')
      if (openable.length > 0) {
        await openable[0].click()
        const tools = await page
          .waitForSelector('.mcp-tool-name', { timeout: 10_000 })
          .then(() => page.$$eval('.mcp-tool-name', (n) => n.map((e) => e.textContent?.trim())))
          .catch(() => [])
        check('点进服务能看到工具清单', tools.length > 0, `${tools.length} 个 · ${tools.slice(0, 3).join(', ')}`)
      } else {
        check('点进服务能看到工具清单', false, '没有可展开的服务')
      }
      const toggles = await page.$$eval('.mcp-action', (n) => n.map((e) => e.textContent?.trim()))
      check('每个服务给了启停入口', toggles.some((t) => t === '停用' || t === '启用'), toggles.join(', ').slice(0, 40))
    }
    const after = await page.$$eval('.msg-claude', (n) => n.length)
    check('/mcp 没有被当成消息发出去', after === before, `${before} → ${after}`)

    // /agents —— supportedAgents() 一直在那儿,界面此前完全没用
    await page.fill('.composer textarea', '/agents')
    await page.click('.composer [data-state="send"]')
    const agentsUp = await page
      .waitForSelector('.agent-row', { timeout: 20_000 })
      .then(() => true)
      .catch(() => false)
    const agentNames = await page.$$eval('.agent-row .mcp-name', (n) => n.map((e) => e.textContent?.trim()))
    check('/agents 列出子 Agent', agentsUp, agentNames.slice(0, 4).join(', '))

    // 账号信息进了设置对话框
    await page.click('.settings-btn')
    await page.waitForSelector('.dialog-body', { timeout: 10_000 })
    const gearText = await page.$eval('.dialog-body', (e) => e.textContent ?? '')
    check('设置里能看到账号或版本', /ClaudeDeck/.test(gearText), gearText.slice(-60).trim())
    await page.click('.dialog-head .icon-btn')
    await page.waitForFunction(() => !document.querySelector('.dialog'), undefined, {
      timeout: 5_000,
    })

    // ---- 正文排版 --------------------------------------------------------------
    // 以前整块是纯文本,**粗体**、列表、```代码块``` 的原始符号直接印在界面上。
  }
  if (want(11)) {
    console.log('\n[11/11] 正文排版与思考')
    await page.fill(
      '.composer textarea',
      '直接输出这段 Markdown,不要解释、不要加别的内容:\n\n一句**加粗**的话。\n\n- 甲\n- 乙\n\n```js\nconst a = 1\n```',
    )
    await page.click('.composer [data-state="send"]')
    await settle(page)

    const strongs = await page.$$eval('.msg-claude strong', (n) => n.map((e) => e.textContent))
    check('粗体真的加粗了', strongs.length > 0, strongs.join(','))
    const bullets = await page.$$eval('.msg-claude .md-list li', (n) => n.length)
    check('列表画成了列表', bullets >= 2, `${bullets} 项`)
    const code = await page.$$eval('.msg-claude .md-code code', (n) => n.map((e) => e.textContent))
    check('代码块单独成块', code.length > 0, code.join('').trim().slice(0, 30))
    const copyBtn = await page.$$eval('.md-code-copy', (n) => n.length)
    check('代码块带复制', copyBtn > 0)
    // 原始符号不该再出现在正文里
    const raw = await page.$eval('.msg-claude', (e) => e.textContent ?? '')
    check('界面上不再出现原始 ** 与 ```', !raw.includes('**') && !raw.includes('```'), raw.slice(0, 40))

    // 上下文环取代了归属行里那行字
    const oldCtx = await page.$$eval('.crumb .context', (n) => n.length)
    check('归属行不再挂上下文百分比', oldCtx === 0)
    const ring = await page.$$eval('.ctx-ring', (n) => n.length)
    check('输入框旁出现上下文环', ring === 1)
    await page.click('.ctx-ring')
    await page.waitForSelector('.ctx-row-item', { timeout: 10_000 })
    const cats = await page.$$eval('.ctx-name', (n) => n.map((e) => e.textContent?.trim()))
    check('浮窗列出分类明细', cats.length >= 3, cats.slice(0, 4).join(' / '))
    await page.keyboard.press('Escape')
  }
} catch (err) {
  failed++
  console.error('\n异常:', err?.message ?? err)
  // 只有超时信息的话,「哪一步卡住」全靠猜 —— 把本文件里的那一帧打出来
  const frame = String(err?.stack ?? '')
    .split('\n')
    .find((l) => l.includes('e2e.mjs'))
  if (frame) console.error('出错位置:', frame.trim())
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
