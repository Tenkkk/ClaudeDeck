/**
 * 对比度验算 —— 设计终稿 §01 的硬性下限:
 *
 *   ≤14px 的文字一律 ≥4.5:1
 *   非文字的标记(圆点、勾选框、分隔线)≥3:1
 *
 * 两套主题都算。终稿在深色那节只声明了 13 个 token,其余是按它自己写的
 * 规则推导的(「深色不是浅色的反色 —— 主色提亮」),推导值必须过同一条线,
 * 否则就是拍脑袋。
 *
 *   npm run contrast
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CSS = readFileSync(resolve(import.meta.dirname, '../src/renderer/src/styles.css'), 'utf8')

/** 从 styles.css 里读出某个 :root 块的 token,避免测试和实现分叉。 */
function readTokens(selector) {
  const at = CSS.indexOf(selector)
  if (at < 0) throw new Error(`找不到 ${selector}`)
  const open = CSS.indexOf('{', at)
  const close = CSS.indexOf('\n}', open)
  const block = CSS.slice(open, close)
  const out = {}
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[m[1]] = m[2]
  }
  return out
}

function srgb(c) {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16)
  return (
    0.2126 * srgb((n >> 16) & 255) + 0.7152 * srgb((n >> 8) & 255) + 0.0722 * srgb(n & 255)
  )
}

function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

let pass = 0
let fail = 0

function check(theme, label, fg, bg, floor, tokens) {
  const f = tokens[fg]
  const b = tokens[bg]
  if (!f || !b) {
    fail++
    console.log(`  FAIL  ${theme} ${label} — 缺 token ${!f ? fg : bg}`)
    return
  }
  const r = ratio(f, b)
  const ok = r >= floor
  ok ? pass++ : fail++
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${theme} ${label.padEnd(26)} ${r.toFixed(2)}:1  (下限 ${floor})  ${fg} on ${bg}`,
  )
}

/** ≤14px 文字:≥4.5。非文字标记:≥3。 */
const TEXT = 4.5
const MARK = 3

function audit(theme, tokens) {
  console.log(`\n${theme}`)

  // 正文与各级说明文字,分别落在三种底上
  for (const bg of ['--bg', '--surface', '--raised']) {
    check(theme, `正文 on ${bg}`, '--ink', bg, TEXT, tokens)
    check(theme, `说明 on ${bg}`, '--ink-2', bg, TEXT, tokens)
    check(theme, `元数据 on ${bg}`, '--muted', bg, TEXT, tokens)
    check(theme, `最弱一档 on ${bg}`, '--muted-2', bg, TEXT, tokens)
  }

  // 未选中的圈与勾选框 —— 「一组可选项」这个信息全靠它们传达
  check(theme, '未选中标记', '--mark', '--surface', MARK, tokens)
  check(theme, '未选中标记 on 底', '--mark', '--bg', MARK, tokens)
  check(theme, '发丝线', '--border', '--surface', 1.2, tokens)

  // 用户气泡里的正文
  check(theme, '气泡正文', '--ink', '--bubble', TEXT, tokens)

  // 陶土底上的字
  check(theme, '陶土底上的字', '--accent-ink', '--accent-tint', TEXT, tokens)
  check(theme, '主按钮文字', '--surface', '--accent', MARK, tokens)

  // 警示与沙绿
  check(theme, '警示文字', '--warn', '--surface', TEXT, tokens)
  check(theme, '警示文字 on 警示底', '--warn', '--warn-tint', TEXT, tokens)
  // 沙绿用在分支名、子进程胶囊(--surface)、计划卡(--raised)、
  // 以及 diff 的 +N 计数(--bg)。纸底最难过线,三个都要算。
  check(theme, '沙绿 on --surface', '--live', '--surface', TEXT, tokens)
  check(theme, '沙绿 on --raised', '--live', '--raised', TEXT, tokens)
  check(theme, '沙绿 on --bg', '--live', '--bg', TEXT, tokens)

  // diff 两色上的正文
  check(theme, 'diff 加行正文', '--ink-2', '--diff-add', TEXT, tokens)
  check(theme, 'diff 删行正文', '--ink-2', '--diff-del', TEXT, tokens)
}

audit('亮色', readTokens(':root {'))
audit('深色', readTokens(":root[data-theme='dark']"))

console.log(`\n${pass} 通过,${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
