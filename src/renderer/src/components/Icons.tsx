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
 * 齿轮 —— 标题栏左上角的系统设置。
 *
 * 齿廓由脚本按「齿顶 6.5 / 齿根 5.0 / 八齿 / 居中 (8,8)」算出来,包围盒
 * 1.6–14.4,四边都留了余量。手写的那版有坐标跑到了 0 以外,左边被画布裁掉。
 *
 * 不用「圆心 + 八根辐条」那种画法:在 14px 下它就是一个太阳。
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
      strokeWidth="1.2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6.91 3.12L6.88 1.60L9.12 1.60L9.09 3.12L10.68 3.78L11.74 2.68L13.32 4.26L12.22 5.32L12.88 6.91L14.40 6.88L14.40 9.12L12.88 9.09L12.22 10.68L13.32 11.74L11.74 13.32L10.68 12.22L9.09 12.88L9.12 14.40L6.88 14.40L6.91 12.88L5.32 12.22L4.26 13.32L2.68 11.74L3.78 10.68L3.12 9.09L1.60 9.12L1.60 6.88L3.12 6.91L3.78 5.32L2.68 4.26L4.26 2.68L5.32 3.78Z" />
      <circle cx="8" cy="8" r="2.2" />
    </svg>
  )
}

/**
 * 外观 —— 侧栏底部那颗。半边太阳半边月,一眼就是「亮色/深色」。
 * 那个位置装的正是主题与账号,不是系统设置。
 */
export function AppearanceIcon({ size = 14, className }: Props): React.JSX.Element {
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
      <circle cx="8" cy="8" r="4" />
      {/* 右半边填实 = 深色那一半 */}
      <path d="M8 4a4 4 0 0 1 0 8z" fill="currentColor" stroke="none" />
      <path d="M8 1v1M8 14v1M15 8h-1M2 8H1M12.9 3.1l-.7.7M3.8 12.2l-.7.7M12.9 12.9l-.7-.7M3.8 3.8l-.7-.7" />
    </svg>
  )
}

/** 侧栏开关:一个方框加一条竖线,左边那格就是侧栏 */
export function PanelIcon({ size = 14, className }: Props): React.JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6" />
      <line x1="6.4" y1="2.8" x2="6.4" y2="13.2" />
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
