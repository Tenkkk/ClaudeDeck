import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ImageAction } from '../../../shared/ipc.js'

export const ImageChatContext = createContext<((project: string, source: string) => Promise<void>) | null>(null)

const PATHS = {
  add: 'M12 5v14M5 12h14',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  reveal: 'M3 6h7l2 3h9v11H3z',
  save: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  close: 'm6 6 12 12M6 18 18 6',
  image: 'M3 3h18v18H3zM3 17l6-6 5 5 3-3 4 4',
}

export function ImageGlyph({ name }: { name: keyof typeof PATHS | 'more' }): React.JSX.Element {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'more' ? <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>
      : <path d={PATHS[name]} />}
  </svg>
}

export default function ImageMenu({ project, source, onAdded, disabled, onBusyChange, layoutKey }: {
  project?: string; source: string; onAdded?: () => void; disabled?: boolean; onBusyChange?: (busy: boolean) => void; layoutKey?: string
}): React.JSX.Element {
  const addToChat = useContext(ImageChatContext)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const ref = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLSpanElement>(null)
  const pending = useRef(false)
  const alive = useRef(true)
  const local = !/^(https?|data):/i.test(source)
  const actions: { kind: ImageAction | 'add'; label: string; disabled?: boolean; title?: string }[] = [
    { kind: 'add', label: '添加到聊天', disabled: !addToChat },
    { kind: 'copy', label: '复制图片' },
    { kind: 'reveal', label: '从资源管理器打开', disabled: !local, title: local ? undefined : '此图片没有本地原文件,请先下载副本' },
    { kind: 'save', label: '下载副本' },
  ]

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (!note) return
    const timer = setTimeout(() => setNote(null), note.error ? 8000 : 4000)
    return () => clearTimeout(timer)
  }, [note])
  const close = (): void => { setOpen(false); trigger.current?.focus() }
  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const button = trigger.current?.getBoundingClientRect()
      const menu = panel.current?.getBoundingClientRect()
      if (!button || !menu) return
      const left = button.left + menu.width <= window.innerWidth - 8 ? button.left : button.right - menu.width
      setPosition({ left: Math.max(8, Math.min(left, window.innerWidth - menu.width - 8)),
        top: Math.max(8, Math.min(button.bottom + 4, window.innerHeight - menu.height - 8)) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, layoutKey])
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [open])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open])

  async function act(kind: ImageAction | 'add'): Promise<void> {
    if (pending.current || disabled) return
    pending.current = true
    setBusy(true)
    onBusyChange?.(true)
    setNote(null)
    close()
    try {
      if (!project) throw new Error('请先选择项目。')
      if (kind === 'add') {
        if (!addToChat) throw new Error('当前视图不能添加附件。')
        await addToChat(project, source)
        if (alive.current) { setNote({ text: '已添加到聊天附件,尚未发送。' }); onAdded?.() }
      } else {
        if (typeof window.api.files.imageAction !== 'function') throw new Error('图片操作接口尚未加载,请重启应用。')
        const result = await window.api.files.imageAction(project, source, kind)
        if (!result.ok) throw new Error(result.error)
        if (alive.current && !result.canceled) setNote({ text: kind === 'copy' ? '图片已复制。' : kind === 'reveal' ? '已在资源管理器中定位。' : '图片副本已保存。' })
      }
    } catch (err) {
      if (alive.current) setNote({ text: err instanceof Error ? err.message : String(err), error: true })
    } finally {
      pending.current = false
      if (alive.current) { setBusy(false); onBusyChange?.(false) }
    }
  }

  return <span ref={ref} className={`image-menu${open || busy ? ' active' : ''}`}>
    <button ref={trigger} className="image-control" aria-label="图片操作" aria-haspopup="menu" aria-expanded={open}
      disabled={busy || disabled || !project} title="图片操作" onClick={() => setOpen(!open)}><ImageGlyph name="more" /></button>
    {open && <span ref={panel} className="image-menu-panel" role="menu" aria-label="图片操作菜单" style={position}
      onKeyDown={(e) => {
        const buttons = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault(); e.stopPropagation()
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
            : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          buttons[next]?.focus()
        } else if (e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault(); e.stopPropagation(); close()
        }
      }}>
      {actions.map((action) => <button role="menuitem" key={action.kind} disabled={action.disabled} title={action.title}
        onClick={() => void act(action.kind)}><ImageGlyph name={action.kind} /><span>{action.label}</span></button>)}
    </span>}
    {note && <span className={`image-action-note${note.error ? ' error' : ''}`} role={note.error ? 'alert' : 'status'}>{note.text}</span>}
  </span>
}
