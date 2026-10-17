import { useEffect, useRef, useState } from 'react'
import { FolderIcon, PlusIcon } from './Icons.js'
import type { AppConfig } from '../../../shared/ipc.js'

export default function CreateProjectDialog({ onClose, onCreated, returnFocus }: {
  onClose: () => void
  onCreated: (config: AppConfig) => Promise<void>
  returnFocus: HTMLElement | null
}): React.JSX.Element {
  const ref = useRef<HTMLFormElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const selectionRef = useRef<{ token: string; path: string } | null>(null)
  const submitting = useRef(false)
  const [selection, setSelection] = useState<{ token: string; path: string } | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ref.current?.querySelector('input')?.focus()
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (!submitting.current) closeRef.current()
      } else if (e.key === 'Tab') {
        const controls = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])]
        const first = controls[0]
        const last = controls.at(-1)
        if (!controls.includes(document.activeElement as HTMLElement) ||
          (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          e.preventDefault()
          const target = e.shiftKey ? last : first
          target?.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (selectionRef.current) void window.api.projects.discardSelection(selectionRef.current.token).catch(() => {})
      // 等背景解除 inert 后再恢复焦点。
      requestAnimationFrame(() => {
        if (returnFocus?.isConnected) returnFocus.focus()
      })
    }
  }, [returnFocus])

  async function run(action: () => Promise<void>): Promise<void> {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  async function chooseDirectory(): Promise<void> {
    const next = await window.api.projects.selectDirectory()
    if (!next) return
    selectionRef.current = next
    setSelection(next)
  }

  return (
    <div className="dialog-veil project-create" onClick={(e) => {
      if (e.target === e.currentTarget && !submitting.current) onClose()
    }}>
      <form ref={ref} className="card" role="dialog" aria-modal="true" aria-labelledby="create-project-title"
        aria-busy={busy} onSubmit={(e) => {
          e.preventDefault()
          if (!selection) return
          void run(async () => {
            const config = await window.api.projects.create(selection.token, name.trim())
            selectionRef.current = null
            await onCreated(config)
          })
        }}>
        <div className="project-create-head">
          <h1 id="create-project-title">创建项目</h1>
          <button type="button" className="ghost icon-btn" aria-label="关闭创建项目" disabled={busy} onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="m4 4 8 8m0-8-8 8" />
            </svg>
          </button>
        </div>
        <label className="project-create-name">
          <FolderIcon size={18} />
          <input aria-label="项目名称" placeholder="项目名称（选填,默认使用文件夹名）" value={name} disabled={busy}
            onChange={(e) => setName(e.target.value)} />
        </label>
        <section aria-labelledby="project-source-label">
          <div id="project-source-label">源文件夹</div>
          <div className="project-create-source">
            <span className={selection ? 'project-create-path' : 'hint'} title={selection?.path}>
              {selection ? selection.path : '在此电脑上添加文件夹'}
            </span>
            <button type="button" className="ghost" disabled={busy} onClick={() => void run(chooseDirectory)}>
              <FolderIcon size={16} />
              {!selection && <PlusIcon size={12} />}
              {selection ? '更换文件夹' : '添加'}
            </button>
          </div>
        </section>
        {error && <div className="project-menu-error" role="alert">{error}</div>}
        <div className="project-create-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>取消</button>
          <button type="submit" className="primary" disabled={busy || !selection}>
            {busy ? '处理中…' : '创建项目'}
          </button>
        </div>
      </form>
    </div>
  )
}
