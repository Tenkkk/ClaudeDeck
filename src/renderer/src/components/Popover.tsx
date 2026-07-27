import { useEffect, useRef } from 'react'

/**
 * 弹层外壳 —— 设计终稿 §08「共用规格」。
 *
 * 背景 --raised,1px --border,圆角 8(带正文的用 10),阴影是全局唯一有阴影的东西。
 * 模型、斜杠命令、子进程、项目切换、权限、努力都按这套画,差别只在行内容。
 *
 * 从下往上弹:控件条在窗口底部,菜单必须朝上开。
 */
export default function Popover({
  open,
  onClose,
  align = 'left',
  width,
  prose = false,
  children,
}: {
  open: boolean
  onClose: () => void
  align?: 'left' | 'right'
  width?: number
  prose?: boolean
  children: React.ReactNode
}): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent): void {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose()
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
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={ref}
      className={`popover${prose ? ' prose' : ''}`}
      style={{ [align]: 0, width } as React.CSSProperties}
      role="menu"
    >
      {children}
    </div>
  )
}
