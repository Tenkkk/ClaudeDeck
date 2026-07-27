import type { DiffHunk, ToolRow, TodoItem } from '../shared/ipc.js'

/**
 * 把 SDK 的工具调用压成界面能直接画的一行。
 *
 * 输入形状(BashInput / FileEditInput / FileReadInput / TodoWriteInput)与
 * 输出形状(BashOutput / structuredPatch)都是按工具各自定义的。把这份知识
 * 收在主进程一个文件里,渲染层就只认 ToolRow,SDK 改形状也只需要改这里。
 *
 * 认不出的工具一律降级成 `other`,只显示名字 —— 不猜、不硬画。
 */

interface Rec {
  [k: string]: unknown
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

/** 请求发出时就知道的部分。结果还没回来。 */
export function rowFromToolUse(id: string, name: string, input: unknown): ToolRow {
  const arg = (input ?? {}) as Rec

  switch (name) {
    case 'Read':
      return { id, tool: 'read', path: str(arg.file_path) ?? '' }

    case 'Bash':
      return {
        id,
        tool: 'bash',
        command: str(arg.command) ?? '',
        description: str(arg.description),
      }

    case 'Edit':
      // 加删行数与 hunk 要等结果里的 structuredPatch,这里先占位
      return { id, tool: 'edit', path: str(arg.file_path) ?? '', added: 0, removed: 0, hunks: [] }

    case 'TodoWrite': {
      const raw = Array.isArray(arg.todos) ? arg.todos : []
      const todos: TodoItem[] = raw.map((t) => {
        const item = (t ?? {}) as Rec
        const status = item.status
        return {
          content: str(item.content) ?? '',
          status:
            status === 'in_progress' || status === 'completed' || status === 'pending'
              ? status
              : 'pending',
        }
      })
      return { id, tool: 'todo', todos }
    }

    default:
      return { id, tool: 'other', name }
  }
}

/** 结果回来后补全同一行。返回新对象,调用方按 id 替换。 */
export function applyToolResult(row: ToolRow, result: unknown): ToolRow {
  const out = (result ?? {}) as Rec

  if (row.tool === 'bash') {
    return {
      ...row,
      stdout: str(out.stdout),
      stderr: str(out.stderr),
      interrupted: out.interrupted === true,
    }
  }

  if (row.tool === 'edit') {
    const patch = Array.isArray(out.structuredPatch) ? out.structuredPatch : []
    const hunks: DiffHunk[] = []
    let added = 0
    let removed = 0

    for (const h of patch) {
      const hunk = (h ?? {}) as Rec
      const lines = Array.isArray(hunk.lines) ? hunk.lines.filter((l): l is string => typeof l === 'string') : []
      for (const line of lines) {
        if (line.startsWith('+')) added++
        else if (line.startsWith('-')) removed++
      }
      hunks.push({
        oldStart: typeof hunk.oldStart === 'number' ? hunk.oldStart : 0,
        newStart: typeof hunk.newStart === 'number' ? hunk.newStart : 0,
        lines,
      })
    }

    return { ...row, added, removed, hunks }
  }

  return row
}
