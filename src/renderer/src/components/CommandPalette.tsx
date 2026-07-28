import { useEffect, useMemo, useRef } from 'react'
import { flatten } from '../lib/commands.js'
import type { SlashCommandItem } from '../../../shared/ipc.js'

export { flatten } from '../lib/commands.js'

const GROUP_LABEL: Record<SlashCommandItem['source'], { label: string; note?: string }> = {
  builtin: { label: '内置' },
  project: { label: '项目命令', note: '.claude/commands' },
  skill: { label: 'Skill', note: '.claude/skills' },
}

/**
 * 斜杠命令面板 —— 设计终稿 §15。
 *
 * 列表由 supportedCommands() 运行时给,**界面不写死任何一条**。
 * 会话中途 SDK 会推新列表(在子目录里发现 skill),收到就整体替换。
 * 只在行首第一个字符是 `/` 时才弹。
 *
 * ## 一份数据,一个顺序
 *
 * 这里画的每一行都直接来自 `flatten()`,**不再自己过滤一遍**。
 * 之前组件里另有一份过滤、并且按固定分组顺序渲染,而键盘导航用的是
 * `flatten()` 的顺序 —— 两者可以不一致,于是高亮的那条和眼睛看到的那条
 * 会对不上。索引和视觉必须出自同一个数组,否则这种错永远查不完。
 *
 * 分组标题在来源变化时插入。因为全等命中会越过分组置顶,同一个来源理论上
 * 可能出现两次标题 —— 那正好说明了「这条是精确命中,不是按组排的」。
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
  const rows = useMemo(() => flatten(commands, filter), [commands, filter])

  // 选中项跟着键盘滚进视野
  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (rows.length === 0) return null

  return (
    <div className="palette popover" ref={ref}>
      <div className="palette-list">
        {rows.map((c, i) => {
          const group = GROUP_LABEL[c.source]
          const newGroup = i === 0 || rows[i - 1].source !== c.source
          return (
            <div key={`${c.source}-${c.name}`}>
              {newGroup && (
                <div className="pop-group">
                  {group.label}
                  {group.note && <span className="palette-note"> · {group.note}</span>}
                </div>
              )}
              <button
                className="palette-row"
                aria-selected={i === index}
                onMouseEnter={() => onIndex(i)}
                onClick={() => onPick(c)}
              >
                <span className="palette-name">/{c.name}</span>
                <span className="palette-desc">{c.description}</span>
                {c.argumentHint && <span className="palette-hint">{c.argumentHint}</span>}
                {c.aliases && c.aliases.length > 0 && (
                  <span className="palette-alias">{c.aliases.map((a) => `/${a}`).join(' ')}</span>
                )}
              </button>
            </div>
          )
        })}
      </div>
      <div className="palette-keys">↑↓ 选择 · Enter 确认 · Esc 取消</div>
    </div>
  )
}
