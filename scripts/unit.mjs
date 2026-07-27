/**
 * 纯函数单元测试 —— 不需要 API、不需要窗口,跑得起来就该跑。
 *
 *   npm run unit
 *
 * 直接导入 src 下的真实模块(Node 24 原生支持 .ts 类型剥离),
 * 不在测试里重打一遍实现 —— 重打的那份和线上跑的那份会分叉。
 */
import { truncatePath, relativeTime } from '../src/renderer/src/lib/path.ts'

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

console.log(`\n${passed} 通过,${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
