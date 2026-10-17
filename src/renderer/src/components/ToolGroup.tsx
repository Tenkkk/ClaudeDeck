import { memo, useState } from 'react'
import type { ToolRow as Row } from '../../../shared/ipc.js'
import { CaretIcon } from './Icons.js'
import ToolRow from './ToolRow.js'

/** 连续执行过程折叠成一组,不改变工具记录本身。 */
export default memo(function ToolGroup({ rows, running }: { rows: Row[]; running: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const pending = running ? rows.findLast((row) => !row.done) : undefined
  const counts = new Map<Row['tool'], number>()
  for (const row of rows) counts.set(row.tool, (counts.get(row.tool) ?? 0) + 1)
  const labels: Partial<Record<Row['tool'], (count: number) => string>> = {
    read: (n) => `读取 ${n} 次`,
    bash: (n) => `执行 ${n} 条命令`,
    search: (n) => `搜索 ${n} 次`,
    edit: (n) => `修改 ${n} 次`,
    task: (n) => `子 Agent ${n} 项`,
    other: (n) => `其他 ${n} 项`,
  }
  const summary = [...counts].map(([tool, count]) => labels[tool]?.(count)).filter(Boolean).join(' · ')

  return (
    <div className="tool-group">
      <button className="tool-group-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <CaretIcon size={11} className={`thought-caret${open ? ' open' : ''}`} />
        <span>执行记录</span>
        <span className="tool-group-summary">{summary}</span>
      </button>
      {pending && <div className="tool-group-current" role="status">{currentAction(pending)}</div>}
      {open && (
        <div className="tool-group-body">
          {rows.map((row) => <ToolRow key={row.id} row={row} />)}
        </div>
      )}
    </div>
  )
})

function currentAction(row: Row): string {
  switch (row.tool) {
    case 'read': return `正在读取 ${row.path.split(/[\\/]/).pop() || '文件'}`
    case 'bash': return row.description ? `正在执行: ${row.description}` : '正在执行命令'
    case 'search': return `正在搜索 ${row.pattern}`
    case 'edit': return `正在修改 ${row.path.split(/[\\/]/).pop() || '文件'}`
    case 'task': return `子 Agent: ${row.description}`
    case 'other': return `正在调用 ${row.name}`
    default: return '正在处理'
  }
}
