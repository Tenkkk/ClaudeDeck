/**
 * 三栏宽度的夹逼规则。
 *
 * 拖拽本身是几行事件,难的是「拖到什么程度该停下」:侧栏不能宽到把对话区
 * 挤没,中栏也不能。所以每一栏除了自己的上下限,还要减去另外两栏必须留出的
 * 宽度 —— 这段逻辑单独放这儿,因为它是纯函数,能直接进单元测试;写在事件
 * 处理里就只能靠手拖来验。
 */

/** 侧栏:窄于这个数,会话标题就只剩几个字了 */
export const SIDEBAR = { min: 200, max: 420, def: 264 }
/** .claude 中栏:窄于这个数,JSON 每行都要折 */
export const MIDCOL = { min: 240, max: 560, def: 320 }
/** 对话区无论如何要留出的宽度 */
export const CHAT_MIN = 360

function clamp(px: number, min: number, max: number): number {
  // max 可能被挤到比 min 还小(窗口本身就很窄),这时以 min 为准 ——
  // 宁可让对话区挤一点,也不能算出一个负宽度
  return Math.round(Math.min(Math.max(px, min), Math.max(min, max)))
}

export function clampSidebar(
  px: number,
  opts: { viewport: number; midcol: number; midOpen: boolean },
): number {
  const taken = (opts.midOpen ? opts.midcol : 0) + CHAT_MIN
  return clamp(px, SIDEBAR.min, Math.min(SIDEBAR.max, opts.viewport - taken))
}

export function clampMidcol(px: number, opts: { viewport: number; sidebar: number }): number {
  return clamp(px, MIDCOL.min, Math.min(MIDCOL.max, opts.viewport - opts.sidebar - CHAT_MIN))
}

const KEY = 'claudedeck.columns'

export interface ColumnWidths {
  sidebar: number
  midcol: number
}

/**
 * 宽度存在 localStorage,不进 config.json:这是纯粹的渲染层视觉偏好,
 * 不需要主进程知道,也不值得为它加一对 IPC。
 */
export function loadWidths(): ColumnWidths {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { sidebar: SIDEBAR.def, midcol: MIDCOL.def }
    const v = JSON.parse(raw) as Partial<ColumnWidths>
    return {
      sidebar: typeof v.sidebar === 'number' ? v.sidebar : SIDEBAR.def,
      midcol: typeof v.midcol === 'number' ? v.midcol : MIDCOL.def,
    }
  } catch {
    // 存坏了不该让整个界面起不来
    return { sidebar: SIDEBAR.def, midcol: MIDCOL.def }
  }
}

export function saveWidths(w: ColumnWidths): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(w))
  } catch {
    /* 存不上就算了,下次开回默认值 */
  }
}
