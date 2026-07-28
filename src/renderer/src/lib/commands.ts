import type { SlashCommandItem } from '../../../shared/ipc.js'

/**
 * 命令面板的过滤与排序。
 *
 * 列表本身是 SDK 的 `supportedCommands()` 给的,但**怎么排是这边的事** ——
 * SDK 不提供检索排序。放在 lib 里而不是组件里,是为了能进单元测试:
 * 排序错了肉眼很难发现(它看起来只是"顺序有点怪"),必须靠断言钉住。
 */

/** 组内顺序。和面板上的分组标题一致 */
const GROUP_ORDER: SlashCommandItem['source'][] = ['builtin', 'project', 'skill']

/**
 * 命中程度。数字越小越靠前,-1 表示没命中。
 *
 * 名字上的匹配一定压过描述上的 —— 敲 `/mcp` 却把
 * `/fewer-permission-prompts`(描述里出现了 "MCP tool calls")排在 `/mcp`
 * 前面,是这个面板最容易犯、也最气人的错。
 */
export function rank(c: SlashCommandItem, q: string): number {
  const name = c.name.toLowerCase()
  const aliases = (c.aliases ?? []).map((a) => a.toLowerCase())

  if (name === q) return 0
  if (aliases.includes(q)) return 1
  if (name.startsWith(q)) return 2
  if (aliases.some((a) => a.startsWith(q))) return 3
  if (name.includes(q)) return 4
  if (aliases.some((a) => a.includes(q))) return 5
  if (c.description.toLowerCase().includes(q)) return 6
  return -1
}

/**
 * **相关度第一,分组只是同分时的次序。**
 *
 * 别把它写成「先按组分,组内再排相关度」—— 那样一条只在描述里蹭到关键词的
 * 内置命令,照样会压过一条名字前缀就对上的项目命令。用户抱怨的正是这个,
 * 换个地方犯还是犯。
 */
export function flatten(commands: SlashCommandItem[], filter: string): SlashCommandItem[] {
  const q = filter.toLowerCase()
  return commands
    .map((c) => ({ c, r: rank(c, q) }))
    .filter((x) => x.r >= 0)
    .sort(
      (a, b) =>
        a.r - b.r ||
        GROUP_ORDER.indexOf(a.c.source) - GROUP_ORDER.indexOf(b.c.source) ||
        // 再同分就按名字长度:敲 `/mc` 时 `/mcp` 该排在 `/mcp-something` 前面
        a.c.name.length - b.c.name.length ||
        a.c.name.localeCompare(b.c.name),
    )
    .map((x) => x.c)
}
