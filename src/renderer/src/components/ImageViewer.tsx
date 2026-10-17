import { useEffect, useRef, useState } from 'react'
import ImageMenu, { ImageGlyph } from './ImageMenu.js'

/** 查看器只有画布可滚动;工具栏和菜单不随大图移动。 */
export default function ImageViewer({ src, source, label, project, width, height, onClose }: {
  src: string; source: string; label: string; project?: string; width: number; height: number; onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [scale, setScale] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [menuBusy, setMenuBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const savingRef = useRef(false)
  const alive = useRef(true)
  const padding = viewport.width < 640 ? 48 : 128
  const fit = Math.min((viewport.width - padding) / Math.max(width, 1), (viewport.height - 100) / Math.max(height, 1), 1)
  const zoom = scale ?? Math.max(0.01, fit)
  const imageWidth = width * zoom
  const imageHeight = height * zoom

  useEffect(() => {
    alive.current = true
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current
    dialog?.showModal()
    dialog?.querySelector<HTMLButtonElement>('[aria-label="关闭图片预览"]')?.focus()
    const resize = (): void => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', resize)
    return () => { alive.current = false; window.removeEventListener('resize', resize); dialog?.close(); if (previous?.isConnected) previous.focus() }
  }, [])

  async function save(): Promise<void> {
    if (savingRef.current || menuBusy || !project) return
    savingRef.current = true
    setSaving(true)
    setNote(null)
    try {
      if (typeof window.api.files.imageAction !== 'function') throw new Error('图片操作接口尚未加载,请重启应用。')
      const result = await window.api.files.imageAction(project, source, 'save')
      if (!result.ok) throw new Error(result.error)
      if (alive.current && !result.canceled) setNote('图片副本已保存。')
    } catch (err) { if (alive.current) setNote(err instanceof Error ? err.message : String(err)) }
    finally { savingRef.current = false; if (alive.current) setSaving(false) }
  }

  return <dialog ref={ref} className="image-viewer" aria-label={`图片预览:${label}`}
    onCancel={(e) => { e.preventDefault(); onClose() }}
    onKeyDown={(e) => {
      if (e.key !== 'Tab' || e.defaultPrevented) return
      const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)') ?? [])
      const first = controls[0], last = controls.at(-1)
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }}>
    <div className="image-viewer-toolbar">
      <span className="image-viewer-title" title={source}><ImageGlyph name="image" /><span>{label}</span></span>
      <div className="image-viewer-controls">
        <select aria-label="图片缩放" value={scale ?? 'fit'} onChange={(e) => setScale(e.target.value === 'fit' ? null : Number(e.target.value))}>
          <option value="fit">{Math.round(fit * 100)}% · 适应</option>
          {[0.25, 0.5, 1, 1.5, 2].map((value) => <option key={value} value={value}>{value * 100}%</option>)}
        </select>
        <button className="image-control" aria-label="下载图片副本" title="下载副本" disabled={saving || menuBusy || !project} onClick={() => void save()}><ImageGlyph name="save" /></button>
        <button autoFocus className="image-control" aria-label="关闭图片预览" title="关闭 (Esc)" onClick={onClose}><ImageGlyph name="close" /></button>
      </div>
    </div>
    <div className="image-viewer-canvas" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <img src={src} alt={label} draggable={false} referrerPolicy="no-referrer" style={{ width: imageWidth, height: imageHeight }} />
    </div>
    <span className="image-viewer-menu" style={{ left: Math.min(viewport.width - 56, (viewport.width + Math.min(imageWidth, viewport.width - padding)) / 2 + 12),
      top: Math.max(76, (viewport.height + 60 - Math.min(imageHeight, viewport.height - 100)) / 2) }}>
      <ImageMenu project={project} source={source} onAdded={onClose} disabled={saving} onBusyChange={setMenuBusy}
        layoutKey={`${viewport.width}:${viewport.height}:${zoom}`} />
    </span>
    {note && <span className="image-viewer-note" role="status">{note}</span>}
  </dialog>
}
