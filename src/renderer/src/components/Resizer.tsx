import { useState } from 'react'

/**
 * 两栏之间那道竖线上的拖拽手柄。
 *
 * 手柄本身是透明的,压在边框上,比边框宽一些 —— 边框只有 1px,真让人去拖
 * 1px 是在为难人;宽出来的部分只影响命中范围,看上去还是那道线。
 *
 * 数学不在这里做:组件只把指针位置报出去,夹在什么范围由 lib/columns 决定,
 * 那部分是纯函数,能单测。
 */
export default function Resizer({
  className,
  label,
  onDrag,
  onNudge,
}: {
  className: string
  label: string
  onDrag: (clientX: number) => void
  onNudge: (delta: number) => void
}): React.JSX.Element {
  const [dragging, setDragging] = useState(false)

  return (
    <div
      className={`resizer ${className}${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(true)
      }}
      onPointerMove={(e) => {
        if (dragging) onDrag(e.clientX)
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId)
        setDragging(false)
      }}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          onNudge(-16)
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          onNudge(16)
        }
      }}
    />
  )
}
