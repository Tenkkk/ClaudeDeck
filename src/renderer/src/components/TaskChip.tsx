import { useEffect, useState } from 'react'
import Popover from './Popover.js'
import type { BackgroundTask } from '../../../shared/ipc.js'

/** 最多显示两类,其余进 +N · §11 */
const SHOWN_TYPES = 2

/**
 * 子进程胶囊与任务清单 —— 设计终稿 §11。
 *
 * **没有后台任务时整颗消失,不留空位。** 插在权限胶囊右边。
 *
 * 标签直接用 SDK 给的 `task_type`(shell / subagent / monitor / workflow),
 * 不自己造词。
 *
 * 「查看输出」没有画:SDK 的推送里不带输出,shell 任务也没有可达的输出通道。
 * 画一个点了没反应的入口,比不画更糟。
 */
export default function TaskChip({
  tasks,
  onStop,
  onStopAll,
}: {
  tasks: BackgroundTask[]
  onStop: (id: string) => void
  onStopAll: () => void
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [, tick] = useState(0)

  // 时长要自己走 —— 每秒重画一次
  useEffect(() => {
    if (tasks.length === 0) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [tasks.length])

  // 没有后台任务时整颗消失,不留空位
  if (tasks.length === 0) return null

  const byType = new Map<string, number>()
  for (const t of tasks) byType.set(t.type, (byType.get(t.type) ?? 0) + 1)
  const entries = [...byType.entries()].sort((a, b) => b[1] - a[1])
  const shown = entries.slice(0, SHOWN_TYPES)
  const restCount = entries.slice(SHOWN_TYPES).reduce((s, [, n]) => s + n, 0)

  return (
    <div className="control-slot">
      <button className="chip pill live" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="dot" />
        {shown.map(([type, n]) => (
          <span key={type}>
            {type} {n}
          </span>
        ))}
        {restCount > 0 && <span className="task-rest">+{restCount}</span>}
      </button>

      <Popover open={open} onClose={() => setOpen(false)} width={320} prose>
        <div className="task-head">
          <span className="pop-group" style={{ padding: 0 }}>
            后台任务 · {tasks.length}
          </span>
          <button className="card-remember" onClick={onStopAll}>
            全部停止
          </button>
        </div>
        {tasks.map((t) => (
          <div key={t.id} className="task-row">
            <div className="task-meta">
              <span className="task-type">{t.type}</span>
              <span className="task-age">{elapsed(t.since)}</span>
              <button className="card-remember" onClick={() => onStop(t.id)}>
                停止
              </button>
            </div>
            <div className="task-desc">{t.description}</div>
          </div>
        ))}
      </Popover>
    </div>
  )
}

function elapsed(since: number): string {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}
