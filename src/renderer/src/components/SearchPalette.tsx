import { useEffect, useMemo, useRef, useState } from 'react'
import { relativeTime } from '../lib/path.js'
import type { Project, SessionListItem } from '../../../shared/ipc.js'

interface Hit {
  project: Project
  session: SessionListItem
}

/**
 * 会话搜索 —— 居中浮层,跨全部项目。
 *
 * 数据用界面已有的 sessionsByProject,不新增 IPC:侧栏本来就把所有项目的
 * 会话都取回来了,再为搜索单开一条通道等于同一份数据取两次。
 *
 * 只匹配标题和首句。不搜正文 —— 那要把每个会话的全文读进来,
 * 几百条会话就是几十兆;真要做全文搜索,那是另一件事,不该在这里假装做到了。
 */
export default function SearchPalette({
  projects,
  sessionsByProject,
  onPick,
  onClose,
}: {
  projects: Project[]
  sessionsByProject: Record<string, SessionListItem[]>
  onPick: (projectPath: string, sessionId: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const hits = useMemo(() => {
    const all: Hit[] = projects.flatMap((p) =>
      (sessionsByProject[p.path] ?? []).map((s) => ({ project: p, session: s })),
    )
    const key = q.trim().toLowerCase()
    const matched = key
      ? all.filter(
          (h) =>
            h.session.title.toLowerCase().includes(key) ||
            h.session.preview.toLowerCase().includes(key) ||
            h.project.name.toLowerCase().includes(key),
        )
      : all
    // 没输入时按时间给最近的,输入了也按时间 —— 会话没有别的可排的维度
    return matched.sort((a, b) => b.session.lastModified - a.session.lastModified).slice(0, 50)
  }, [projects, sessionsByProject, q])

  // 结果变了就把选中项拉回第一条,否则光标会停在一个已经不存在的位置
  useEffect(() => setAt(0), [q])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [at])

  return (
    <div className="search-veil" onClick={onClose}>
      <div className="search-panel" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="search-input"
          value={q}
          placeholder="搜索会话与项目"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setAt((i) => (hits.length === 0 ? 0 : (i + 1) % hits.length))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setAt((i) => (hits.length === 0 ? 0 : (i - 1 + hits.length) % hits.length))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const hit = hits[at]
              if (hit) onPick(hit.project.path, hit.session.sessionId)
            }
          }}
        />

        <div className="search-list" ref={listRef}>
          {hits.length === 0 && <div className="hint search-empty">没有匹配的会话。</div>}
          {hits.map((h, i) => (
            <button
              key={`${h.project.path}-${h.session.sessionId}`}
              className="search-row"
              aria-selected={i === at}
              onMouseEnter={() => setAt(i)}
              onClick={() => onPick(h.project.path, h.session.sessionId)}
            >
              <span className="search-title">{h.session.title}</span>
              {/* 跨项目搜索必须写清是哪个项目的,否则同名会话分不出来 */}
              <span className="search-meta">
                {h.project.name} · {relativeTime(h.session.lastModified)}
              </span>
            </button>
          ))}
        </div>

        <div className="search-keys">↑↓ 选择 · Enter 打开 · Esc 关闭</div>
      </div>
    </div>
  )
}
