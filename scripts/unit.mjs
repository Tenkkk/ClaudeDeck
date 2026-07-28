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
import { askCardFromPayload, askResult, planCardFromPayload } from '../src/main/dialogs.ts'
import { resolveInScope, validateJson } from '../src/main/claudedir.ts'

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

  // 作答按题干原文回填 —— 这是工具的输出契约
  const result = askResult(card, {
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

  const freeform = askResult(card, { answers: {}, response: '四道题都不合适' })
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

console.log(`\n${passed} 通过,${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
