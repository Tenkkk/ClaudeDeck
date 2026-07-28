import { useEffect, useRef, useState } from 'react'
import type { SessionListItem } from '../../../shared/ipc.js'

type Panel = 'menu' | 'tag' | 'delete'

/**
 * 侧栏会话的右键菜单 —— 设计终稿 §08。
 *
 * 对应 renameSession / tagSession / forkSession / deleteSession。
 * 删除是真删 SDK 的 store,本地没有副本可以回滚,所以要二次确认,
 * 也是唯一一处用警示色做主按钮的地方。
 *
 * 「从这条分支 ↳」的 ↳ 在这套界面里只有一个意思:**会多出一条分支会话**。
 * SDK 没有 regenerate、也删不掉已写入的消息,所以重答只能是分支(坑 4.4)。
 */
export default function SessionMenu({
  session,
  knownTags,
  at,
  onClose,
  onRename,
  onTag,
  onFork,
  onOpenDir,
  onDelete,
}: {
  session: SessionListItem
  knownTags: string[]
  at: { x: number; y: number }
  onClose: () => void
  onRename: (title: string) => void
  onTag: (tag: string | null) => void
  onFork: () => void
  onOpenDir: () => void
  onDelete: () => void
}): React.JSX.Element {
  const [panel, setPanel] = useState<Panel>('menu')
  const [tagDraft, setTagDraft] = useState(session.tag ?? '')
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState(session.title)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent): void {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // 菜单贴着鼠标出,但不能被窗口下沿截掉
  const style: React.CSSProperties = {
    left: Math.min(at.x, window.innerWidth - 260),
    top: Math.min(at.y, window.innerHeight - 260),
  }

  if (panel === 'delete') {
    return (
      <div ref={ref} className="ctx popover prose" style={{ ...style, width: 320 }}>
        <div className="ctx-confirm">
          <strong>删掉「{session.title}」?</strong>
          <p>这条会话会从 Claude Code 的记录里真的消失,找不回来。它的分支不受影响。</p>
          <div className="row">
            <button onClick={onClose}>取消</button>
            <button className="danger" onClick={onDelete}>
              删除
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (panel === 'tag') {
    const others = knownTags.filter((t) => t !== tagDraft)
    return (
      <div ref={ref} className="ctx popover prose" style={{ ...style, width: 260 }}>
        <div className="ctx-tag">
          <input
            autoFocus
            value={tagDraft}
            placeholder="标签"
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onTag(tagDraft.trim() || null)
            }}
          />
          {others.length > 0 && (
            <div className="tag-chips">
              {others.map((t) => (
                <button key={t} className="tag-chip" onClick={() => onTag(t)}>
                  {t}
                </button>
              ))}
            </div>
          )}
          <div className="ctx-foot">
            <span className="card-keys" style={{ marginLeft: 0 }}>
              Enter 确认 · Esc 取消
            </span>
            <button className="ctx-clear" onClick={() => onTag(null)}>
              清除标签
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={ref} className="ctx popover" style={{ ...style, width: 240 }}>
      {renaming ? (
        <div className="ctx-rename">
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && titleDraft.trim()) onRename(titleDraft.trim())
            }}
          />
          <span className="card-keys" style={{ marginLeft: 0 }}>
            Enter 确认 · Esc 取消
          </span>
        </div>
      ) : (
        <button className="ctx-row" onClick={() => setRenaming(true)}>
          重命名
        </button>
      )}
      <button className="ctx-row" onClick={() => setPanel('tag')}>
        打标签…
      </button>
      <button className="ctx-row" onClick={onFork}>
        从这条分支 ↳
      </button>
      <button className="ctx-row" onClick={onOpenDir}>
        在资源管理器中打开目录
      </button>
      <div className="ctx-sep" />
      <button className="ctx-row warn" onClick={() => setPanel('delete')}>
        删除会话
      </button>
    </div>
  )
}
