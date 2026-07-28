import { useCallback, useEffect, useState } from 'react'
import { CaretIcon, FolderIcon } from './Icons.js'
import type { FileEntry } from '../../../shared/ipc.js'

/**
 * 项目文件树 —— 中栏的浏览形态。
 *
 * 取代了原来那个只认 `.claude` 的节点:`.claude` 现在只是树里的一个普通文件夹,
 * 而每个项目都能展开,不再只有当前聚焦的那个。
 *
 * **一次只列一层。** 展开哪层问哪层 —— 一次性递归整个项目,遇到 node_modules
 * 就是几十万个条目,界面直接没了。
 *
 * 筛选只匹配**已经展开过的**那些名字,并且明说这一点。做成「输入即全项目搜索」
 * 就得先把整棵树读进内存,那正是上面要避开的事;含糊其辞地只筛一部分、
 * 又让人以为是全量,更糟。
 */
export default function FileTree({
  projectPath,
  projectName,
  onClose,
  onOpenFile,
}: {
  projectPath: string
  projectName: string
  onClose: () => void
  onOpenFile: (relPath: string) => void
}): React.JSX.Element {
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({})
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(
    async (relDir: string) => {
      const rows = await window.api.files.list(projectPath, relDir)
      setChildren((c) => ({ ...c, [relDir]: rows }))
    },
    [projectPath],
  )

  useEffect(() => {
    setChildren({})
    setOpen(new Set())
    setLoading(true)
    void load('').then(() => setLoading(false))
  }, [load])

  function toggle(entry: FileEntry): void {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(entry.path)) {
        next.delete(entry.path)
      } else {
        next.add(entry.path)
        if (!children[entry.path]) void load(entry.path)
      }
      return next
    })
  }

  const q = filter.trim().toLowerCase()
  const hit = (e: FileEntry): boolean => q === '' || e.name.toLowerCase().includes(q)

  /** 递归画一层。深度只影响缩进,数据是按需取的 */
  function rows(relDir: string, depth: number): React.JSX.Element[] {
    const list = children[relDir] ?? []
    return list.flatMap((e) => {
      const expanded = open.has(e.path)
      // 筛选时,目录只要自己或展开后的子项命中就留着
      const keep = hit(e) || (e.kind === 'dir' && expanded)
      if (!keep) return []

      const row = (
        <button
          key={e.path}
          className={`file-row${e.kind === 'dir' ? ' dir' : ''}`}
          style={{ paddingLeft: `${depth * 12 + 12}px` }}
          title={e.path}
          onClick={() => (e.kind === 'dir' ? toggle(e) : onOpenFile(e.path))}
        >
          {e.kind === 'dir' ? (
            <>
              <CaretIcon size={11} className={expanded ? 'file-caret open' : 'file-caret'} />
              <FolderIcon size={12} className="file-icon" />
            </>
          ) : (
            <span className="file-caret-space" />
          )}
          <span className="file-name">{e.name}</span>
          {/* 能改的标一下 —— 树里绝大多数文件是只读的,别让人改半天才发现存不下 */}
          {e.kind === 'file' && e.editable && <span className="file-tag">可改</span>}
        </button>
      )

      return expanded && e.kind === 'dir' ? [row, ...rows(e.path, depth + 1)] : [row]
    })
  }

  const drawn = rows('', 0)

  return (
    <aside className="midcol">
      <div className="midcol-head">
        <div className="midcol-title">
          <span className="midcol-name">文件</span>
        </div>
        <span className="midcol-crumb">{projectName}</span>
        <button className="ghost icon-btn" title="关闭" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="file-filter">
        <input
          value={filter}
          placeholder="筛选已展开的文件名"
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="file-list">
        {loading && <div className="hint file-empty">正在读取…</div>}
        {!loading && drawn.length === 0 && (
          <div className="hint file-empty">{q ? '没有匹配的文件名。' : '这个目录是空的。'}</div>
        )}
        {drawn}
      </div>
    </aside>
  )
}
