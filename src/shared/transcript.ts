import type { ToolRow, TranscriptItem } from './ipc.js'

/**
 * 直播与回放共用的 transcript 组装规则。
 *
 * 两边各写一份的话,规则必然走岔 —— 回放里待办摊开成十几张卡、
 * 正文与工具行顺序相反,都是这么来的。工具行怎么进、结果怎么补,
 * 只在这里定一次;直播流(渲染层)与历史重建(主进程)都用它。
 */

/**
 * §06:Claude 会反复写 TodoWrite,同一次会话里只保留一张卡、原地更新,
 * 否则十几张待办卡会把对话冲掉。去重放在组装这一层。
 */
export function appendTool(items: TranscriptItem[], row: ToolRow): TranscriptItem[] {
  const base =
    row.tool === 'todo'
      ? items.filter((i) => !(i.kind === 'tool' && i.row.tool === 'todo'))
      : items
  return [...base, { kind: 'tool', row }]
}

/** 结果回来时按 id 就地替换那一行,保持顺序。 */
export function replaceTool(items: TranscriptItem[], row: ToolRow): TranscriptItem[] {
  return items.map((i) => (i.kind === 'tool' && i.row.id === row.id ? { kind: 'tool', row } : i))
}
