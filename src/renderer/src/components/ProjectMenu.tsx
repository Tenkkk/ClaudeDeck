import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Project } from '../../../shared/ipc.js'

/** 项目目录不能在这里改动:它同时是会话归属和文件权限边界。 */
export default function ProjectMenu({
  project,
  at,
  onClose,
  onRename,
  onRemove,
}: {
  project: Project
  at: { x: number; y: number }
  onClose: () => void
  onRename: (name: string) => Promise<void>
  onRemove: () => Promise<void>
}): React.JSX.Element {
  const [panel, setPanel] = useState<'menu' | 'edit' | 'remove'>('menu')
  const [name, setName] = useState(project.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(at)

  useLayoutEffect(() => {
    function place(): void {
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) return
      setPosition({
        x: Math.max(8, Math.min(at.x, window.innerWidth - rect.width - 8)),
        y: Math.max(8, Math.min(at.y, window.innerHeight - rect.height - 8)),
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [at, panel, error, busy])

  useEffect(() => {
    const target = ref.current?.querySelector<HTMLInputElement | HTMLButtonElement>(
      panel === 'edit' ? 'input' : 'button',
    )
    target?.focus()
    if (target instanceof HTMLInputElement) target.select()
  }, [panel])

  useEffect(() => {
    function onDown(e: MouseEvent): void {
      if (!submitting.current && !ref.current?.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (!submitting.current) onClose()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  async function submit(action: () => Promise<void>): Promise<void> {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      await action()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return (
    <div
      ref={ref}
      className={`ctx popover project-menu${panel === 'menu' ? '' : ' prose'}`}
      style={{ left: position.x, top: position.y, width: panel === 'menu' ? 220 : 340 }}
      role={panel === 'menu' ? 'menu' : 'dialog'}
      aria-label={panel === 'menu' ? '项目菜单' : panel === 'edit' ? '编辑项目' : '移除项目'}
      aria-busy={busy}
      onKeyDown={(e) => {
        if (panel !== 'menu') return
        if (e.key === 'Tab') {
          onClose()
          return
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
        e.preventDefault()
        const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
          : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
        buttons[next]?.focus()
      }}
    >
      {panel === 'menu' ? (
        <>
          <button role="menuitem" className="ctx-row" onClick={() => setPanel('edit')}>
            编辑项目
          </button>
          <div className="ctx-sep" />
          <button role="menuitem" className="ctx-row warn" onClick={() => setPanel('remove')}>
            移除项目
          </button>
        </>
      ) : (
        <form className="ctx-confirm" onSubmit={(e) => {
          e.preventDefault()
          if (panel === 'edit' && !name.trim()) return
          void submit(panel === 'edit' ? () => onRename(name.trim()) : onRemove)
        }}>
          <strong>{panel === 'edit' ? '编辑项目' : `移除「${project.name}」?`}</strong>
          {panel === 'edit' ? (
            <>
              <label htmlFor="project-name">项目名称</label>
              <input id="project-name" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
              <label htmlFor="project-path">项目目录(只读)</label>
              <input id="project-path" value={project.path} readOnly />
              <p>仅修改显示名称,不会移动目录或改变会话归属。</p>
            </>
          ) : (
            <p>只从项目列表移除,不会删除磁盘目录或会话历史。该项目正在运行的任务会被停止。</p>
          )}
          {error && <div className="project-menu-error" role="alert">{error}</div>}
          <div className="row">
            <button type="button" disabled={busy} onClick={onClose}>取消</button>
            <button type="submit" className={panel === 'edit' ? 'primary' : 'danger'}
              disabled={busy || (panel === 'edit' && !name.trim())}>
              {busy ? '处理中…' : panel === 'edit' ? '保存' : '移除'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
