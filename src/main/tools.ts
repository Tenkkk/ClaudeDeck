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

/** 从 old/new 文本合成一个 diff hunk —— 结果还没回来时的预览,权限卡也用它 */
function hunkFromStrings(oldText: string, newText: string): DiffHunk | null {
  const oldLines = oldText ? oldText.split('\n') : []
  const newLines = newText ? newText.split('\n') : []
  if (oldLines.length === 0 && newLines.length === 0) return null
  return {
    oldStart: 1,
    oldLines: oldLines.length,
    newStart: 1,
    newLines: newLines.length,
    lines: [...oldLines.map((l) => `-${l}`), ...newLines.map((l) => `+${l}`)],
  }
}

function editRow(
  id: string,
  label: 'Edit' | 'Write' | 'MultiEdit',
  path: string,
  hunks: DiffHunk[],
): ToolRow {
  let added = 0
  let removed = 0
  for (const h of hunks) {
    for (const line of h.lines) {
      if (line.startsWith('+')) added++
      else if (line.startsWith('-')) removed++
    }
  }
  return { id, tool: 'edit', label, path, added, removed, hunks }
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

    /*
     * Edit / Write / MultiEdit 都从入参先合成预览 diff:批准之前就要看得见
     * 会改什么(权限卡直接复用这一行)。结果回来后 structuredPatch 是
     * 权威版本,会把预览替换掉。
     */
    case 'Edit': {
      const hunk = hunkFromStrings(str(arg.old_string) ?? '', str(arg.new_string) ?? '')
      return editRow(id, 'Edit', str(arg.file_path) ?? '', hunk ? [hunk] : [])
    }

    case 'Write': {
      const content = str(arg.content) ?? ''
      const hunk = hunkFromStrings('', content)
      return editRow(id, 'Write', str(arg.file_path) ?? '', hunk ? [hunk] : [])
    }

    case 'MultiEdit': {
      const edits = Array.isArray(arg.edits) ? arg.edits : []
      const hunks = edits.flatMap((e) => {
        const item = (e ?? {}) as Rec
        const hunk = hunkFromStrings(str(item.old_string) ?? '', str(item.new_string) ?? '')
        return hunk ? [hunk] : []
      })
      return editRow(id, 'MultiEdit', str(arg.file_path) ?? '', hunks)
    }

    case 'Grep':
    case 'Glob':
      return {
        id,
        tool: 'search',
        name,
        pattern: str(arg.pattern) ?? '',
        path: str(arg.path),
      }

    // 不画的话,子 Agent 在界面上完全不可见 —— 只知道「卡了很久」
    case 'Task':
      return {
        id,
        tool: 'task',
        description: str(arg.description) ?? str(arg.prompt)?.slice(0, 80) ?? '',
        agent: str(arg.subagent_type),
      }

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

/**
 * 结果回来后补全同一行。返回新对象,调用方按 id 替换。
 * `isError` 来自 tool_result 块的 is_error —— 成败态所有行统一盖。
 */
export function applyToolResult(row: ToolRow, result: unknown, isError = false): ToolRow {
  const out = (result ?? {}) as Rec
  const flags: { done: boolean; failed?: boolean } = { done: true }
  if (isError) flags.failed = true

  if (row.tool === 'bash') {
    return {
      ...row,
      ...flags,
      stdout: str(out.stdout),
      stderr: str(out.stderr),
      interrupted: out.interrupted === true,
    }
  }

  if (row.tool === 'edit') {
    const patch = Array.isArray(out.structuredPatch) ? out.structuredPatch : []
    // 结果不带 patch(纯新建之类)就保留入参合成的预览,别把它抹成空
    if (patch.length === 0) return { ...row, ...flags }

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
      const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
      hunks.push({
        oldStart: num(hunk.oldStart),
        oldLines: num(hunk.oldLines),
        newStart: num(hunk.newStart),
        newLines: num(hunk.newLines),
        lines,
      })
    }

    return { ...row, ...flags, added, removed, hunks }
  }

  if (row.tool === 'search') {
    const hits =
      typeof out.numFiles === 'number'
        ? out.numFiles
        : typeof out.numMatches === 'number'
          ? out.numMatches
          : undefined
    return { ...row, ...flags, hits }
  }

  return { ...row, ...flags }
}
