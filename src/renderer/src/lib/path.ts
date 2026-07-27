/**
 * 路径截断 —— 设计终稿 §04。
 *
 * 规则:保留盘符 + 末两级,中间用 … 顶掉。
 * 末两级本身超过 44 字符时,再从**末级中间**截 —— 末级是项目名,掐头会认不出。
 *
 * 截断只在渲染层做,不改数据;完整路径通过 title 属性给悬停。
 */

const MAX_TAIL = 44

export function truncatePath(full: string): string {
  const parts = full.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 3) return full

  const drive = parts[0]
  const parent = parts[parts.length - 2]
  let leaf = parts[parts.length - 1]

  if (parent.length + 1 + leaf.length > MAX_TAIL) {
    const budget = MAX_TAIL - parent.length - 1
    // 预算太小就整条让给末级,parent 这一层已经没有意义了
    if (budget < 8) return `${drive}\\…\\${middleEllipsis(leaf, MAX_TAIL)}`
    leaf = middleEllipsis(leaf, budget)
  }

  return `${drive}\\…\\${parent}\\${leaf}`
}

/** 从中间截,两头都留住 —— 项目名的头和尾都是识别线索。 */
function middleEllipsis(text: string, max: number): string {
  if (text.length <= max) return text
  const half = Math.floor((max - 1) / 2)
  return `${text.slice(0, half)}…${text.slice(text.length - (max - 1 - half))}`
}

/** 侧栏与列表里的相对时间。今天给时分,昨天给「昨天」,更早给月/日。 */
export function relativeTime(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const today = new Date(now)
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()

  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (sameDay) return hhmm

  const yesterday = new Date(now - 86_400_000)
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return `昨天 ${hhmm}`
  }

  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`
}
