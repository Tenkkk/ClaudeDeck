import { useEffect, useMemo, useRef } from 'react'
import type { SlashCommandItem } from '../../../shared/ipc.js'

const GROUPS: { key: SlashCommandItem['source']; label: string; note?: string }[] = [
  { key: 'builtin', label: '内置' },
  { key: 'project', label: '项目命令', note: '.claude/commands' },
  { key: 'skill', label: 'Skill', note: '.claude/skills' },
]

/**
 * 斜杠命令面板 —— 设计终稿 §15。
 *
 * 列表由 supportedCommands() 运行时给,**界面不写死任何一条**,只按来源分三组。
 * 会话中途 SDK 会推新列表(在子目录里发现 skill),收到就整体替换。
 * 只在行首第一个字符是 `/` 时才弹。
 */
export default function CommandPalette({
  commands,
  filter,
  index,
  onIndex,
  onPick,
}: {
  commands: SlashCommandItem[]
  filter: string
  index: number
  onIndex: (i: number) => void
  onPick: (c: SlashCommandItem) => void
}): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)

  const matched = useMemo(() => {
    const q = filter.toLowerCase()
    return commands.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.aliases?.some((a) => a.toLowerCase().includes(q)) ||
        c.description.toLowerCase().includes(q),
    )
  }, [commands, filter])

  // 选中项跟着键盘滚进视野
  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (matched.length === 0) return null

  let cursor = -1

  return (
    <div className="palette popover" ref={ref}>
      <div className="palette-list">
        {GROUPS.map((g) => {
          const rows = matched.filter((c) => c.source === g.key)
          if (rows.length === 0) return null
          return (
            <div key={g.key}>
              <div className="pop-group">
                {g.label}
                {g.note && <span className="palette-note"> · {g.note}</span>}
              </div>
              {rows.map((c) => {
                cursor += 1
                const i = cursor
                return (
                  <button
                    key={c.name}
                    className="palette-row"
                    aria-selected={i === index}
                    onMouseEnter={() => onIndex(i)}
                    onClick={() => onPick(c)}
                  >
                    <span className="palette-name">/{c.name}</span>
                    <span className="palette-desc">{c.description}</span>
                    {c.argumentHint && <span className="palette-hint">{c.argumentHint}</span>}
                    {c.aliases && c.aliases.length > 0 && (
                      <span className="palette-alias">
                        {c.aliases.map((a) => `/${a}`).join(' ')}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
      <div className="palette-keys">↑↓ 选择 · Enter 确认 · Esc 取消</div>
    </div>
  )
}

/** 面板里当前可见的命令,按分组顺序拍平 —— 键盘导航要用同一个顺序。 */
export function flatten(commands: SlashCommandItem[], filter: string): SlashCommandItem[] {
  const q = filter.toLowerCase()
  const matched = commands.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.aliases?.some((a) => a.toLowerCase().includes(q)) ||
      c.description.toLowerCase().includes(q),
  )
  return GROUPS.flatMap((g) => matched.filter((c) => c.source === g.key))
}
