/**
 * 纯函数单元测试 —— 不需要 API、不需要窗口,跑得起来就该跑。
 *
 *   npm run unit
 *
 * 直接导入 src 下的真实模块(Node 24 原生支持 .ts 类型剥离),
 * 不在测试里重打一遍实现 —— 重打的那份和线上跑的那份会分叉。
 */
import { truncatePath, relativeTime } from '../src/renderer/src/lib/path.ts'
import { rowFromToolUse, applyToolResult } from '../src/main/tools.ts'
import { fieldsFromSchema, coerceValues } from '../src/main/elicit.ts'
import { askCardFromPayload, askAnswerPatch, planCardFromPayload } from '../src/main/dialogs.ts'
import { resolveInScope, validateJson } from '../src/main/claudedir.ts'
import { bundledExecutablePath } from '../src/main/binary.ts'
import { clampSidebar, clampMidcol, SIDEBAR, MIDCOL, CHAT_MIN } from '../src/renderer/src/lib/columns.ts'
import { parseMarkdown, parseInline } from '../src/renderer/src/lib/markdown.ts'
import { flatten } from '../src/renderer/src/lib/commands.ts'
import { unexpandSlashCommand } from '../src/main/history.ts'
import { resolveInProject, isEditable } from '../src/main/claudedir.ts'

let passed = 0
let failed = 0

function eq(label, actual, expected) {
  if (actual === expected) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    console.log(`  FAIL  ${label}`)
    console.log(`        期望 ${JSON.stringify(expected)}`)
    console.log(`        实际 ${JSON.stringify(actual)}`)
  }
}

console.log('truncatePath —— 设计终稿 §04')

// 保留盘符 + 末两级,中间用 … 顶掉
eq(
  '四级路径顶掉中间',
  truncatePath(String.raw`D:\Code\AI_Project\ClaudeDeck`),
  String.raw`D:\…\AI_Project\ClaudeDeck`,
)
eq(
  '五级路径同样只留末两级',
  truncatePath(String.raw`C:\Users\12054\Documents\notes-vault`),
  String.raw`C:\…\Documents\notes-vault`,
)

// 三级及以内不动
eq('三级路径原样返回', truncatePath(String.raw`C:\Users\12054`), String.raw`C:\Users\12054`)
eq('两级路径原样返回', truncatePath(String.raw`D:\a`), String.raw`D:\a`)

// 正斜杠也要认
eq(
  '正斜杠路径',
  truncatePath('/home/tenk/code/claudedeck'),
  String.raw`home\…\code\claudedeck`,
)

// 末两级超过 44 字符时,从末级中间截 —— 末级是项目名,掐头会认不出
//
// 已知边界:parent 很长时会把末级的预算挤得很小(这里 parent 占 31 字,
// 末级只剩 12 字,截成 a-rea…me-here)。符合 §04 的字面规定,但项目名
// 已接近认不出。若要改,应当是「优先保末级、转而截 parent」——那是设计决定,
// 不是实现细节,所以先按规格实现并在此标注。
{
  const src = String.raw`C:\Users\somebody\very-long-parent-directory-name\a-really-long-project-name-here`
  const out = truncatePath(src)
  eq('超长末两级被截断', out.includes('…') && out.startsWith('C:\\…\\very-long-parent-directory-name\\'), true)

  const leaf = out.slice(out.lastIndexOf('\\') + 1)
  const srcLeaf = 'a-really-long-project-name-here'
  eq('末级从中间截,头部保留', leaf.startsWith(srcLeaf.slice(0, 4)), true)
  eq('末级从中间截,尾部保留', leaf.endsWith(srcLeaf.slice(-4)), true)
  eq('末级长度不超预算', leaf.length <= 12, true)
}

// parent 本身就吃满预算时,整条让给末级
{
  const out = truncatePath(
    String.raw`C:\x\an-extremely-long-parent-name-that-eats-the-entire-budget\leafname`,
  )
  eq('预算不足时只留末级', out, String.raw`C:\…\leafname`)
}

console.log('\nrelativeTime')
{
  const now = new Date(2026, 6, 27, 15, 32, 0).getTime()
  eq('今天给时分', relativeTime(new Date(2026, 6, 27, 9, 5, 0).getTime(), now), '09:05')
  eq('昨天带前缀', relativeTime(new Date(2026, 6, 26, 22, 47, 0).getTime(), now), '昨天 22:47')
  eq('更早给月日', relativeTime(new Date(2026, 6, 24, 11, 8, 0).getTime(), now), '7/24 11:08')
}

console.log('\ntools —— 工具行归一化 §06')
{
  // Read
  const read = rowFromToolUse('t1', 'Read', { file_path: 'src/main/chat.ts' })
  eq('Read 取 file_path', read.tool === 'read' && read.path, 'src/main/chat.ts')

  // Bash:请求时只有命令,结果回来才有输出
  let bash = rowFromToolUse('t2', 'Bash', { command: 'npm run typecheck', description: '类型检查' })
  eq('Bash 取 command', bash.tool === 'bash' && bash.command, 'npm run typecheck')
  eq('Bash 请求时没有 stdout', bash.stdout, undefined)

  bash = applyToolResult(bash, { stdout: 'ok\n', stderr: '', interrupted: false })
  eq('Bash 结果填入 stdout', bash.stdout, 'ok\n')
  eq('Bash 未中断', bash.interrupted, false)

  const cut = applyToolResult(rowFromToolUse('t3', 'Bash', { command: 'sleep 99' }), {
    stdout: '',
    stderr: 'killed',
    interrupted: true,
  })
  eq('Bash 中断标记', cut.interrupted, true)
  eq('Bash stderr', cut.stderr, 'killed')

  // Edit:加删行数要从 structuredPatch 里数出来
  let edit = rowFromToolUse('t4', 'Edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y' })
  eq('Edit 请求时加删为 0', edit.tool === 'edit' && edit.added === 0 && edit.removed === 0, true)

  edit = applyToolResult(edit, {
    structuredPatch: [
      {
        oldStart: 168,
        oldLines: 6,
        newStart: 168,
        newLines: 9,
        lines: [' async setEffort(level) {', '-  await this.q?.close()', '+  const next = await this.reopen(level)', '+  this.q = next', ' }'],
      },
    ],
  })
  eq('Edit 数出新增行', edit.added, 2)
  eq('Edit 数出删除行', edit.removed, 1)
  eq('Edit 保留 hunk 起始行', edit.hunks[0]?.oldStart, 168)
  // diff 头要写成 @@ 168,6 → 168,9 @@,所以行数也得留着
  eq('Edit 保留 oldLines', edit.hunks[0]?.oldLines, 6)
  eq('Edit 保留 newLines', edit.hunks[0]?.newLines, 9)
  eq('Edit 保留全部行', edit.hunks[0]?.lines.length, 5)

  // TodoWrite:只看输入,不需要结果 —— 探针里 Claude 没调它,靠这里覆盖
  const todo = rowFromToolUse('t5', 'TodoWrite', {
    todos: [
      { content: '读 chat.ts 的 resume 段', status: 'completed', activeForm: '正在读' },
      { content: '改成原子操作', status: 'in_progress', activeForm: '正在改' },
      { content: '加过渡态', status: 'pending', activeForm: '待办' },
    ],
  })
  eq('TodoWrite 条目数', todo.tool === 'todo' && todo.todos.length, 3)
  eq('TodoWrite 保留状态', todo.tool === 'todo' && todo.todos[1].status, 'in_progress')

  // 认不出的工具降级,不猜、不硬画
  const other = rowFromToolUse('t6', 'SomeFutureTool', { whatever: 1 })
  eq('未知工具降级为 other', other.tool === 'other' && other.name, 'SomeFutureTool')

  // 畸形输入不能把界面搞崩
  eq('Read 缺 file_path 不抛', rowFromToolUse('t7', 'Read', undefined).tool, 'read')
  eq('TodoWrite 的 todos 不是数组时为空', rowFromToolUse('t8', 'TodoWrite', { todos: 'nope' }).todos.length, 0)
  eq('TodoWrite 非法状态降级为 pending', rowFromToolUse('t9', 'TodoWrite', { todos: [{ content: 'x', status: 'bogus' }] }).todos[0].status, 'pending')
  eq('Edit 结果无 structuredPatch 不抛', applyToolResult(rowFromToolUse('t10', 'Edit', {}), {}).hunks.length, 0)
  eq('Bash 结果为 null 不抛', applyToolResult(rowFromToolUse('t11', 'Bash', {}), null).interrupted, false)
}

console.log('\nelicit —— MCP 表单的 schema 映射 §14')
{
  const schema = {
    type: 'object',
    properties: {
      browser: { type: 'string', enum: ['chromium', 'firefox', 'webkit'], title: '浏览器' },
      headless: { type: 'boolean', default: true, description: 'headless · 默认开' },
      timeout: { type: 'number', default: 30000, unit: 'ms', title: '超时' },
      grep: { type: 'string', title: '只跑匹配的用例' },
      weird: { type: 'array' },
    },
    required: ['browser'],
  }
  const fields = fieldsFromSchema(schema)
  const by = Object.fromEntries(fields.map((f) => [f.key, f]))

  eq('字段数', fields.length, 5)
  eq('enum → 分段', by.browser.kind, 'enum')
  eq('enum 选项保留', by.browser.options?.join(','), 'chromium,firefox,webkit')
  eq('required 标记', by.browser.required, true)
  eq('boolean → 勾选', by.headless.kind, 'boolean')
  eq('boolean 默认值', by.headless.default, true)
  eq('number → 数字框', by.timeout.kind, 'number')
  eq('number 带单位', by.timeout.unit, 'ms')
  eq('title 优先于 key 当标签', by.timeout.label, '超时')
  eq('无 title 时用 key', by.weird.label, 'weird')
  eq('认不出的类型降级成输入框', by.weird.kind, 'string')
  eq('未列进 required 的字段非必填', by.grep.required, false)

  // 控件出来的都是字符串,回传前要按 schema 还原类型
  const content = coerceValues(fields, {
    browser: 'firefox',
    headless: true,
    timeout: '45000',
    grep: '',
  })
  eq('enum 原样', content.browser, 'firefox')
  eq('boolean 原样', content.headless, true)
  eq('number 还原成数字', content.timeout, 45000)
  eq('空串不回传', 'grep' in content, false)
  eq('没填的字段不回传', 'weird' in content, false)
}

console.log('\ndialogs —— user dialog 的 payload 归一化 §13 / §06')
{
  // 形状取自 CLI 二进制里那份 payload 校验器
  const askPayload = {
    requestId: 'r1',
    toolName: 'AskUserQuestion',
    permissionResult: { behavior: 'ask' },
    questions: [
      {
        question: '新 query 建不起来的时候,应该怎么处理?',
        header: '切换失败',
        multiSelect: false,
        options: [
          { label: '保留旧 query', description: '对话不中断。', preview: '<b>预览</b>' },
          { label: '直接报错', description: '不留着失效连接。' },
        ],
      },
      {
        question: '这次要顺手做掉哪几件?',
        header: '改动范围',
        multiSelect: true,
        options: [
          { label: '补一条 typecheck', description: '' },
          { label: '更新 CLAUDE.md', description: '' },
        ],
      },
    ],
  }

  const card = askCardFromPayload('a1', askPayload)
  eq('两道题都认出来', card?.questions.length, 2)
  eq('保留 header', card?.questions[0].header, '切换失败')
  eq('保留 multiSelect', card?.questions[1].multiSelect, true)
  eq('保留 preview', card?.questions[0].options[0].preview, '<b>预览</b>')
  eq('缺 description 补空串', card?.questions[1].options[0].description, '')

  // 作答按题干原文回填 —— 实测:用 header 当键校验过不了,模型照样收到「没人作答」
  const result = askAnswerPatch(card, {
    answers: {
      '新 query 建不起来的时候,应该怎么处理?': '直接报错',
      '这次要顺手做掉哪几件?': '补一条 typecheck, 更新 CLAUDE.md',
    },
    notes: { '切换失败': '' },
  })
  eq('answers 键是题干原文', result.answers['直接报错'] === undefined, true)
  eq('单选作答', result.answers['新 query 建不起来的时候,应该怎么处理?'], '直接报错')
  eq('多选逗号分隔', result.answers['这次要顺手做掉哪几件?'], '补一条 typecheck, 更新 CLAUDE.md')
  eq('空 note 不回传', result.annotations, undefined)

  const freeform = askAnswerPatch(card, { answers: {}, response: '四道题都不合适' })
  eq('自由作答走 response', freeform.response, '四道题都不合适')

  // 认不出形状一律返回 null,交给「安全取消」—— 宁可不画也不猜着画
  eq('questions 不是数组 → null', askCardFromPayload('x', { questions: 'nope' }), null)
  eq('questions 为空 → null', askCardFromPayload('x', { questions: [] }), null)
  eq('题目缺选项 → null', askCardFromPayload('x', { questions: [{ question: 'q', options: [] }] }), null)
  eq('payload 为 null → null', askCardFromPayload('x', null), null)

  // 计划卡
  eq('计划取 plan 字段', planCardFromPayload('p1', { plan: '1. 先做 A\n2. 再做 B' })?.plan.length > 0, true)
  eq('缺 plan → null', planCardFromPayload('p1', { requestId: 'r' }), null)
  eq('plan 是空串 → null', planCardFromPayload('p1', { plan: '   ' }), null)
}

console.log('\nclaudedir —— 路径必须锁死 §10')
{
  const P = process.platform === 'win32' ? 'D:\\proj' : '/proj'
  const inScope = (rel) => resolveInScope(P, rel)

  // 允许的两类
  eq('.claude 下的文件', inScope('.claude/settings.json') !== null, true)
  eq('.claude 子目录里的文件', inScope('.claude/commands/release.md') !== null, true)
  eq('项目根的 CLAUDE.md', inScope('CLAUDE.md') !== null, true)

  // 越界的一律 null —— 这些不是理论风险,IPC 的输入一律不可信
  eq('上跳一级', inScope('../secret.txt'), null)
  eq('从 .claude 里跳出去', inScope('.claude/../../etc/passwd'), null)
  eq('深度穿越', inScope('.claude/../../../Windows/System32/drivers/etc/hosts'), null)
  eq('项目根的其他文件', inScope('package.json'), null)
  eq('项目根的其他 md', inScope('README.md'), null)
  eq('.claude 目录本身', inScope('.claude'), null)

  // 前缀相同但不是同一个目录 —— 用 relative 判断而不是比字符串,就是为了挡这个
  eq('同级的 .claude-backup', inScope('.claude-backup/settings.json'), null)
  eq('同级的 .claudex', inScope('.claudex/x.json'), null)

  // 绝对路径也不能绕过
  eq('绝对路径', inScope(process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/passwd'), null)
}

console.log('\nclaudedir —— JSON 写坏要在保存前拦住并指出行号')
{
  eq('合法 JSON 放行', validateJson('{"a":1}'), null)
  eq('合法 JSON(带换行)放行', validateJson('{\n  "a": 1\n}'), null)

  const bad = validateJson('{\n  "permissions": {\n    "allow": [,\n  }\n}')
  eq('坏 JSON 被拦住', bad !== null, true)
  eq('给出的行号大于 1', (bad?.line ?? 0) > 1, true)

  const empty = validateJson('')
  eq('空内容也算坏', empty !== null, true)
}

// ---- 自带 claude 可执行文件的路径 ------------------------------------------
// e2e 跑的是 dev 构建,照不到这里 —— 装完打不开就是栽在这一段上。
{
  const win = bundledExecutablePath('C:\\app\\resources', 'win32', 'x64')
  eq('指向 unpacked,不是 asar 内部', win.includes('app.asar.unpacked'), true)
  eq('不留在 asar 里', /app\.asar[\\/]/.test(win), false)
  eq('文件名带 .exe', win.endsWith('claude.exe'), true)
  eq('包名带上平台与架构', win.includes('claude-agent-sdk-win32-x64'), true)

  const mac = bundledExecutablePath('/app/resources', 'darwin', 'arm64')
  // 分隔符由跑测试的这台机器决定(join 在 Windows 上吐反斜杠),
  // 所以这里只看结尾的文件名,不挑分隔符
  eq('非 Windows 不加 .exe', /[\\/]claude$/.test(mac), true)
  eq('非 Windows 的包名也对', mac.includes('claude-agent-sdk-darwin-arm64'), true)
}

// ---- 三栏宽度的夹逼 --------------------------------------------------------
{
  const wide = { viewport: 1600, midcol: MIDCOL.def, midOpen: false }
  eq('正常范围内原样返回', clampSidebar(300, wide), 300)
  eq('拖过窄夹到下限', clampSidebar(40, wide), SIDEBAR.min)
  eq('拖过宽夹到上限', clampSidebar(9999, wide), SIDEBAR.max)

  // 中栏开着时,侧栏的活动余地要相应变小
  const withMid = { viewport: 900, midcol: 320, midOpen: true }
  eq('中栏开着时给对话区留够', clampSidebar(9999, withMid), 900 - 320 - CHAT_MIN)

  // 窗口窄到怎么排都不够时,宁可挤对话区,也不能算出比下限还小的宽度
  eq('窗口过窄时不返回负值', clampSidebar(300, { viewport: 500, midcol: 320, midOpen: true }), SIDEBAR.min)

  eq('中栏同样夹在下限', clampMidcol(10, { viewport: 1600, sidebar: 264 }), MIDCOL.min)
  eq('中栏同样夹在上限', clampMidcol(9999, { viewport: 1600, sidebar: 264 }), MIDCOL.max)
  eq(
    '中栏也要给对话区留够',
    clampMidcol(9999, { viewport: 1000, sidebar: 264 }),
    1000 - 264 - CHAT_MIN,
  )
  eq('返回整数像素', Number.isInteger(clampMidcol(333.7, { viewport: 1600, sidebar: 264 })), true)
}

// ---- Markdown 解析 ---------------------------------------------------------
// 手写解析器最容易栽在边界上,所以这一段写得比别处密。
console.log('\nmarkdown —— 正文解析')
{
  const kinds = (src) => parseMarkdown(src).map((b) => b.kind).join(',')

  eq('标题', kinds('## 标题'), 'heading')
  eq('标题层级', parseMarkdown('### 三级')[0].level, 3)
  eq('分隔线', kinds('---'), 'hr')
  eq('引用', kinds('> 一句话'), 'quote')
  eq('无序列表', kinds('- 甲\n- 乙'), 'list')
  eq('有序列表', kinds('1. 甲\n2. 乙'), 'list')
  eq('有序列表记住起始号', parseMarkdown('3. 丙\n4. 丁')[0].start, 3)
  eq('列表项数', parseMarkdown('- 甲\n- 乙\n- 丙')[0].items.length, 3)
  eq('嵌套一层', parseMarkdown('- 甲\n  - 甲一')[0].items[0].children.length, 1)

  // 代码块:块内的一切都不再当 Markdown
  const code = parseMarkdown('```json\n{\n  "a": 1\n}\n```')[0]
  eq('围栏代码块', code.kind, 'code')
  eq('记住语言', code.lang, 'json')
  eq('原样保留块内内容', code.text, '{\n  "a": 1\n}')
  eq('块内的 # 不当标题', parseMarkdown('```\n# 不是标题\n```')[0].text, '# 不是标题')
  // 流式渲染时代码块常常是半截的,不能因为没闭合就整块吃掉
  eq('没闭合也成块', parseMarkdown('```sh\nnpm run build')[0].text, 'npm run build')

  // 表格
  const table = parseMarkdown('| 甲 | 乙 |\n|---|---|\n| 1 | 2 |')[0]
  eq('表格', table.kind, 'table')
  eq('表头两列', table.head.length, 2)
  eq('一行数据', table.rows.length, 1)

  // 行内
  const inline = (src) => parseInline(src).map((n) => n.kind).join(',')
  eq('粗体', inline('**重要**'), 'strong')
  eq('斜体', inline('*轻*'), 'em')
  eq('删除线', inline('~~划掉~~'), 'del')
  eq('行内代码', inline('`npm run build`'), 'code')
  eq('链接', inline('[点这里](https://example.com)'), 'link')
  eq('链接取到 href', parseInline('[x](https://example.com)')[0].href, 'https://example.com')
  eq('混排顺序', inline('前 **粗** 后'), 'text,strong,text')

  // 反引号里的星号是字面量,不能当粗体 —— 行内代码必须先切
  eq('代码里的星号不当粗体', inline('`**不是粗体**`'), 'code')
  eq('代码内容原样', parseInline('`**x**`')[0].text, '**x**')

  // 下划线在标识符中间不该触发斜体,否则 snake_case 会被吃掉半截
  eq('标识符里的下划线不当斜体', inline('some_long_name'), 'text')

  // 认不出的东西一律当文本,绝不吃内容
  eq('孤立的星号原样保留', parseInline('2 * 3 = 6')[0].text, '2 * 3 = 6')
  eq('空串不产出节点', parseInline('').length, 0)
  eq('HTML 当字面文本', parseInline('<script>x</script>')[0].kind, 'text')
}

// ---- 命令面板的排序 --------------------------------------------------------
// 这一段是照着实际踩到的样子写的:敲 /mcp,前三条却是描述里含 "MCP" 的别的命令。
console.log('\n命令面板 —— 相关度排序')
{
  const cmds = [
    { name: 'fewer-permission-prompts', description: 'Scan transcripts for Bash and MCP tool calls', argumentHint: '', source: 'builtin' },
    { name: 'doctor', description: 'Health-check setup, mcp diagnostics', argumentHint: '', source: 'builtin' },
    { name: 'claude-api', description: 'Reference for the Claude API — tool use, MCP, agents', argumentHint: '', source: 'builtin' },
    { name: 'mcp', description: 'Manage MCP servers', argumentHint: '', source: 'builtin' },
    { name: 'mcp-debug', description: '', argumentHint: '', source: 'project' },
    { name: 'usage', description: 'Show usage', aliases: ['cost', 'stats'], argumentHint: '', source: 'builtin' },
  ]
  const names = (q) => flatten(cmds, q).map((c) => c.name)

  eq('全等的排第一', names('mcp')[0], 'mcp')
  eq('描述命中的沉到后面', names('mcp').indexOf('doctor') > names('mcp').indexOf('mcp-debug'), true)
  eq('名字前缀压过描述', names('mcp')[1], 'mcp-debug')
  eq('前缀命中优先于包含', names('mc')[0], 'mcp')
  // 数组要比字符串 —— eq 用的是 ===,两个内容相同的数组永远不相等
  eq('别名也能搜到', names('cost').join(','), 'usage')
  eq('搜不到就不给', names('zzz').length, 0)
  eq('空关键词全给', names('').length, cmds.length)

  // 全等命中要越过分组置顶 —— 打全了名字就是要它,不该因为它是项目命令被沉下去
  const proj = [
    { name: 'mcpx', description: '', argumentHint: '', source: 'builtin' },
    { name: 'deploy', description: '', argumentHint: '', source: 'project' },
  ]
  eq('全等的越过分组置顶', flatten(proj, 'deploy')[0].name, 'deploy')
}

// ---- 历史里的斜杠命令还原 --------------------------------------------------
console.log('\n历史 —— 斜杠命令还原')
{
  const expanded =
    '<command-name>/config</command-name>\n        <command-message>config</command-message>\n        <command-args></command-args>'
  eq('还原成命令本身', unexpandSlashCommand(expanded), '/config')

  const withArgs =
    '<command-name>/mcp</command-name><command-message>mcp</command-message><command-args>reconnect pencil</command-args>'
  eq('带参数一并还原', unexpandSlashCommand(withArgs), '/mcp reconnect pencil')

  // CLI 存的名字有时不带斜杠
  eq('名字没斜杠也补上', unexpandSlashCommand('<command-name>context</command-name>'), '/context')

  // 认不出就原样返回,绝不吃内容
  eq('普通消息原样返回', unexpandSlashCommand('帮我看下 README'), '帮我看下 README')
  eq('半截标记原样返回', unexpandSlashCommand('<command-name>没闭合'), '<command-name>没闭合')
}

// ---- 文件树的路径收敛 ------------------------------------------------------
// 读的范围放宽到整个项目了,越界判断必须比原来更受得住推敲。
console.log('\n文件树 —— 路径收敛')
{
  const root = String.raw`D:\proj`
  eq('项目内的文件放行', resolveInProject(root, 'src/main/chat.ts') !== null, true)
  eq('项目根自己放行', resolveInProject(root, '.') !== null, true)
  eq('往上跳一层拒绝', resolveInProject(root, '../secrets.txt'), null)
  eq('绕一圈再往上跳也拒绝', resolveInProject(root, 'src/../../secrets.txt'), null)
  // Windows 跨盘符时 relative 返回的是绝对路径,不以 .. 开头 —— 只查前缀会放行
  eq('跨盘符的绝对路径拒绝', resolveInProject(root, String.raw`C:\Windows\win.ini`), null)
  // 同级的相似目录不能被当成在范围内
  eq('同名前缀的兄弟目录拒绝', resolveInProject(root, String.raw`..\proj-backup\x`), null)

  // 看得见不等于能改
  eq('源码不可写', isEditable(root, 'src/main/chat.ts'), false)
  eq('.claude 下的配置可写', isEditable(root, '.claude/settings.json'), true)
  eq('项目根的 CLAUDE.md 可写', isEditable(root, 'CLAUDE.md'), true)
  eq('别处的 CLAUDE.md 不可写', isEditable(root, 'docs/CLAUDE.md'), false)
}

console.log(`\n${passed} 通过,${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
