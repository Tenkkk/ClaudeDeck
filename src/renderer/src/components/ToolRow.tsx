import { useState } from 'react'
import { CheckIcon } from './Icons.js'
import type { ToolRow as Row } from '../../../shared/ipc.js'

/** §06:超过 20 行的 patch 只显示前 8 行 + 「还有 N 行」 */
const DIFF_FULL_LIMIT = 20
const DIFF_HEAD_LINES = 8

/**
 * 对话区里的工具行 —— 设计终稿 §06。
 *
 * 默认只有一行标题;有输出的给「展开 / 收起」。stderr 与 interrupted 走
 * 警示色的左短线,但**不做成红框** —— 它是过程,不是失败。
 */
export default function ToolRow({ row }: { row: Row }): React.JSX.Element {
  if (row.tool === 'read') {
    return (
      <div className="tool-row">
        <span className="tool-name">Read</span>
        <span className="tool-sep">·</span>
        <span className="tool-arg">{row.path}</span>
      </div>
    )
  }

  if (row.tool === 'bash') return <BashRow row={row} />
  if (row.tool === 'edit') return <EditRow row={row} />
  if (row.tool === 'todo') return <TodoCard row={row} />

  return (
    <div className="tool-row">
      <span className="tool-name">{row.name}</span>
    </div>
  )
}

function BashRow({ row }: { row: Extract<Row, { tool: 'bash' }> }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const output = [row.stdout, row.stderr].filter(Boolean).join('\n').trimEnd()
  const hasOutput = output.length > 0
  const warn = row.interrupted === true || Boolean(row.stderr?.trim())

  /*
   * 多行命令必须整段摊开。
   *
   * 原先不管几行都压进一行、超出用省略号截掉 —— 一条 cd + export + 三个 grep
   * 的命令,界面上只看得到 `cd /d/Code/...`,而真正会动你机器的是后面那几行。
   * 要批准一件事,总得先看得见它。所以:单行照旧内联,多行另起一块全展开。
   */
  const command = row.command.trimEnd()
  const multiline = command.includes('\n')
  const headline = multiline ? (row.description ?? `${command.split('\n').length} 行命令`) : command

  return (
    <div className={`tool-block${warn ? ' warn' : ''}`}>
      <div className="tool-row">
        <span className="tool-name">Bash</span>
        <span className="tool-sep">·</span>
        <span className="tool-arg">{row.interrupted ? '已中断' : headline}</span>
        {hasOutput && (
          <button className="tool-toggle" onClick={() => setOpen((v) => !v)}>
            {open ? '收起' : '展开'}
          </button>
        )}
      </div>
      {multiline && !row.interrupted && (
        <pre className="tool-cmd">
          {command.split('\n').map((l, i) => (
            <span key={i} className="tool-cmd-line">
              {/* 只有第一行给提示符 —— 每行都画 $ 会让人以为这是几条独立命令 */}
              <span className="tool-cmd-mark">{i === 0 ? '$' : ' '}</span>
              {l}
            </span>
          ))}
        </pre>
      )}
      {open && hasOutput && <pre className="tool-output">{output}</pre>}
    </div>
  )
}

function EditRow({ row }: { row: Extract<Row, { tool: 'edit' }> }): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const lines = row.hunks.flatMap((h) => h.lines)
  const truncated = lines.length > DIFF_FULL_LIMIT
  const shown = truncated ? lines.slice(0, DIFF_HEAD_LINES) : lines

  return (
    <div className="tool-block">
      <div className="tool-row">
        <span className="tool-name">Edit</span>
        <span className="tool-sep">·</span>
        <span className="tool-arg">{row.path}</span>
        {row.added > 0 && <span className="diff-add-count">+{row.added}</span>}
        {row.removed > 0 && <span className="diff-del-count">−{row.removed}</span>}
        {lines.length > 0 && (
          <button className="tool-toggle" onClick={() => setOpen((v) => !v)}>
            {open ? '收起' : '展开'}
          </button>
        )}
      </div>

      {open && lines.length > 0 && (
        <div className="diff">
          {row.hunks[0] && (
            <div className="diff-hunk-head">
              @@ {row.hunks[0].oldStart},{row.hunks[0].oldLines} → {row.hunks[0].newStart},
              {row.hunks[0].newLines} @@
            </div>
          )}
          {shown.map((line, i) => {
            const sign = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : ''
            return (
              <div key={i} className={`diff-line${sign ? ` ${sign}` : ''}`}>
                {/* 加删记号放在左侧独立槽位,不混进正文 —— 否则复制出去会带上它们 */}
                <span className="diff-sign">{sign ? line[0] : ''}</span>
                <span className="diff-text">{line.slice(1)}</span>
              </div>
            )
          })}
          {truncated && <div className="diff-more">还有 {lines.length - DIFF_HEAD_LINES} 行</div>}
        </div>
      )}
    </div>
  )
}

/**
 * §06:Claude 会反复写这个清单,所以同一会话只保留一张卡、原地更新
 * (去重发生在 transcript 组装那一层)。正在做的那条带呼吸点。
 */
function TodoCard({ row }: { row: Extract<Row, { tool: 'todo' }> }): React.JSX.Element {
  const done = row.todos.filter((t) => t.status === 'completed').length

  return (
    <div className="todo-card">
      <div className="todo-head">
        计划 · {done} / {row.todos.length}
      </div>
      {row.todos.map((t, i) => (
        <div key={i} className={`todo-item ${t.status}`}>
          {/* 真勾选框:完成是实心带勾,其余是空框 —— 未选中时也必须看得见(§01 的 3:1 下限) */}
          <span className="todo-box" aria-hidden="true">
            {t.status === 'completed' && <CheckIcon size={9} />}
          </span>
          <span className="todo-text">{t.content}</span>
          {/* 正在做的那条带呼吸点,跟在文字后面 */}
          {t.status === 'in_progress' && <span className="todo-dot" />}
        </div>
      ))}
    </div>
  )
}
