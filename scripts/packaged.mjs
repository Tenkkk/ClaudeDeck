/**
 * 打包版冒烟 —— 只验一件事:**装完之后打得开、发得出、答得回来**。
 *
 *   npm run dist && node scripts/packaged.mjs
 *
 * 为什么单独有这么一支:e2e 跑的是 dev 构建,node_modules 摊在磁盘上,
 * SDK 自己就能找到 claude 可执行文件。打包后它被压进 app.asar,而
 * **asar 里的可执行文件 spawn 不起来** —— 这一整类「dev 好好的、装完打不开」
 * 的毛病,前面四层测试一条都照不到。0.1.0 就是这么交出去的。
 *
 * 用独立的 --user-data-dir 启动,不动你真实的 ClaudeDeck 配置。
 * 会产生少量真实 API 调用。
 */
import { _electron as electron } from 'playwright'
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const EXE = join(ROOT, 'release', 'win-unpacked', 'ClaudeDeck.exe')
const USER_DATA = mkdtempSync(join(tmpdir(), 'claudedeck-pkg-ud-'))
const WORKSPACE = mkdtempSync(join(tmpdir(), 'claudedeck-pkg-ws-'))

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

if (!existsSync(EXE)) {
  console.error(`没找到打包产物:${EXE}\n先跑 npm run dist`)
  process.exit(1)
}

mkdirSync(USER_DATA, { recursive: true })
writeFileSync(
  join(USER_DATA, 'config.json'),
  JSON.stringify(
    {
      baseUrl: '',
      apiKeyCipher: null,
      projects: [{ path: WORKSPACE, name: WORKSPACE.split(/[\\/]/).pop(), collapsed: false }],
      activeWorkspace: WORKSPACE,
      model: null,
      effort: 'low',
      permissionMode: 'bypassPermissions',
      theme: 'system',
    },
    null,
    2,
  ),
)

console.log(`可执行文件:${EXE}\n用户数据:${USER_DATA}\n`)

const app = await electron.launch({
  executablePath: EXE,
  args: [`--user-data-dir=${USER_DATA}`],
})

try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  console.log('[1/3] 起得来')
  await page.waitForSelector('.composer textarea', { timeout: 30_000 })
  check('打包版直接进入主界面', true)

  console.log('[2/3] 子进程起得来')
  await page.fill('.composer textarea', '只回复两个字:收到')
  await page.waitForSelector('.composer [data-state="send"]', { timeout: 30_000 })
  await page.click('.composer [data-state="send"]')

  // 回得来才说明 claude 可执行文件真的被拉起来了 —— 这是这支测试的全部意义
  await page.waitForSelector('.msg-claude', { timeout: 120_000 })
  await page.waitForSelector('.composer [data-state="send"]', { timeout: 120_000 })
  const reply = await page.$eval('.msg-claude', (e) => e.textContent?.trim() ?? '')
  check('打包版能拿到真实回复', reply.length > 0, reply.slice(0, 30))

  // 报错条一旦出现,内容原样打出来 —— 不要只说「失败了」
  const err = await page.$$eval('.error-line', (n) => n.map((e) => e.textContent))
  check('没有报错条', err.length === 0, err.join(' | ').slice(0, 200))

  console.log('[3/3] 会话起来之后该有的都有')
  // 这两处正是 0.1.0 装完之后空着的地方:数据都来自活着的 query
  // 模型名要等 query 起来报上来 —— 子进程没起来时这个按钮整个不出现
  const model = await page.$$eval('.model-btn', (n) => n.map((e) => e.textContent?.trim() ?? ''))
  check('右下角出现模型选择', model.length > 0, model.join(', '))

  // 版本行里的 CLI 版本,在打包版里必须来自应用自带的那份可执行文件
  // —— 它出得来,就说明 doctor 找到并成功启动了真身,而不是 asar 里那个壳。
  const foot = await page.$eval('.sidebar-foot', (e) => e.textContent ?? '')
  check('版本行报出 CLI 版本', /CLI\s+\d+\.\d+\.\d+/.test(foot), foot.trim())
  // 额度块拿不到就整块消失(API Key / Bedrock / Vertex 会话 available: false),
  // 所以这里只把实际内容打出来,不断言它一定在 —— 那取决于用的哪种凭据。
  console.log(`        侧栏底部实际内容:${foot.trim()}`)
} catch (err) {
  failed++
  console.log(`\n异常:${err.message}`)
  try {
    const page = await app.firstWindow()
    await page.screenshot({ path: join(ROOT, '.screenshots', 'packaged-fail.png') })
    console.log('失败截图:.screenshots/packaged-fail.png')
  } catch {
    /* 窗口都没起来,截不到就算了 */
  }
} finally {
  await app.close()
  rmSync(USER_DATA, { recursive: true, force: true })
  rmSync(WORKSPACE, { recursive: true, force: true })
}

console.log(`\n${passed} 通过,${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
