/**
 * 内联 SVG 图标。
 *
 * 不用 📁 🔍 这类字符:打包的四套拉丁字体没有这些字形,靠系统回落会出豆腐块
 * (第 2 步已经踩过一次)。画出来的在任何字体环境下都一样。
 *
 * 统一 currentColor 描边,尺寸由 font-size 之外的显式 props 控制。
 */

interface Props {
  size?: number
  className?: string
}

export function FolderIcon({ size = 13, className }: Props): React.JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.8 4.2h4l1.3 1.6h7.1v6.6a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1V4.2Z" />
    </svg>
  )
}

/**
 * 齿轮 —— 侧栏底部的设置入口。
 *
 * 八齿画法:一个圆心 + 八根短辐条,比描一圈齿廓的路径在 13px 下清楚得多
 * (齿廓那种画法缩到这个尺寸会糊成一团)。
 */
export function GearIcon({ size = 14, className }: Props): React.JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="2.4" />
      <path d="M8 1.6v1.8M8 12.6v1.8M14.4 8h-1.8M3.4 8H1.6M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3M12.5 12.5l-1.3-1.3M4.8 4.8 3.5 3.5" />
    </svg>
  )
}

export function SearchIcon({ size = 14, className }: Props): React.JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.4" />
      <path d="M10.3 10.3 14 14" />
    </svg>
  )
}

export function PlusIcon({ size = 12, className }: Props): React.JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}

/** 勾选框里的勾。 */
export function CheckIcon({ size = 10, className }: Props): React.JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 6.2 4.7 9 10 3" />
    </svg>
  )
}

/**
 * 折叠箭头。展开时由 CSS 旋转 90°。
 *
 * 用描边的 chevron 而不是填充三角:同样的尺寸下描边看得更清,
 * 也和设计稿里那个细字形一致。
 */
export function CaretIcon({ size = 12, className }: Props): React.JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </svg>
  )
}
