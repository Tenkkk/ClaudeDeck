/**
 * 一个够用的 Markdown 解析器 —— 只解析,不渲染。
 *
 * ## 为什么不装库
 *
 * CLAUDE.md 里记着一条:这个仓库增量 `npm install` 会产出错误的 lockfile
 * (electron-builder 的 win32 可选依赖会被漏掉),要修就得整个重装 ——
 * 而重装要重新拉 Electron 二进制和 265 MB 的 claude,在这台机器的网络环境下
 * 是个真实的风险。为一个 Markdown 库付这个代价不划算。
 *
 * 自己写还有个好处:解析是纯函数,能直接进单元测试。手写解析器最容易出的就是
 * 边界错误,有测试钉着才敢用。
 *
 * ## 安全
 *
 * 这里**只产出数据结构**,渲染层拿它生成 React 元素,全程不碰 innerHTML ——
 * 所以模型吐出来的 `<script>` 只会被当字面文本显示,没有注入面。
 *
 * ## 覆盖范围
 *
 * 标题、段落、围栏代码块、无序/有序列表(含嵌套一层)、引用、分隔线、表格,
 * 行内的粗体 / 斜体 / 行内代码 / 链接 / 删除线。
 * 认不出的行一律按普通段落走 —— 宁可少画一种样式,也不能把内容吃掉。
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'del'; children: Inline[] }
  | { kind: 'link'; href: string; children: Inline[] }

export type Block =
  | { kind: 'p'; content: Inline[] }
  | { kind: 'heading'; level: number; content: Inline[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'hr' }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }

export interface ListItem {
  content: Inline[]
  /** 缩进两级以上的子项。只做一层 —— 再深的层级在聊天气泡里也读不下去 */
  children: ListItem[]
}

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/
const HEADING = /^(#{1,6})\s+(.*)$/
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/
const UL = /^(\s*)[-*+]\s+(.*)$/
const OL = /^(\s*)(\d+)[.)]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  return parseBlocks(lines)
}

function parseBlocks(lines: string[]): Block[] {
  const out: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i++
      continue
    }

    // 围栏代码块 —— 必须排在最前面,块内的一切都不再当 Markdown 解析
    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[2][0]
      const len = fence[2].length
      const lang = fence[3] ?? ''
      const body: string[] = []
      i++
      while (i < lines.length) {
        const end = FENCE.exec(lines[i])
        if (end && end[2][0] === marker && end[2].length >= len && !end[3]) {
          i++
          break
        }
        body.push(lines[i])
        i++
      }
      // 没闭合也照样成块 —— 流式渲染时代码块常常是半截的
      out.push({ kind: 'code', lang, text: body.join('\n') })
      continue
    }

    if (HR.test(line)) {
      out.push({ kind: 'hr' })
      i++
      continue
    }

    const h = HEADING.exec(line)
    if (h) {
      out.push({ kind: 'heading', level: h[1].length, content: parseInline(h[2].trim()) })
      i++
      continue
    }

    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(QUOTE.exec(lines[i])![1])
        i++
      }
      out.push({ kind: 'quote', blocks: parseBlocks(body) })
      continue
    }

    // 表格:当前行像一行单元格,且下一行是分隔行
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = splitRow(line)
      i += 2
      const rows: Inline[][][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]))
        i++
      }
      out.push({ kind: 'table', head, rows })
      continue
    }

    if (UL.test(line) || OL.test(line)) {
      const [list, next] = parseList(lines, i)
      out.push(list)
      i = next
      continue
    }

    // 普通段落:直到空行或下一个块级结构
    const para: string[] = []
    while (i < lines.length && lines[i].trim() !== '') {
      const l = lines[i]
      if (FENCE.test(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l) || UL.test(l) || OL.test(l)) break
      para.push(l.trim())
      i++
    }
    if (para.length > 0) out.push({ kind: 'p', content: parseInline(para.join('\n')) })
  }

  return out
}

function parseList(lines: string[], start: number): [Block, number] {
  const first = UL.exec(lines[start]) ?? OL.exec(lines[start])!
  const ordered = OL.test(lines[start])
  const baseIndent = first[1].length
  const startNum = ordered ? Number.parseInt(OL.exec(lines[start])![2], 10) : 1

  const items: ListItem[] = []
  let i = start

  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      // 列表项之间允许一个空行;再往后如果不是列表就收尾
      const next = lines[i + 1]
      if (next === undefined || (!UL.test(next) && !OL.test(next))) break
      i++
      continue
    }

    const ul = UL.exec(line)
    const ol = OL.exec(line)
    if (!ul && !ol) break

    const indent = (ul ?? ol!)[1].length
    const text = ul ? ul[2] : ol![3]

    if (indent > baseIndent) {
      // 子项挂到上一条上;没有上一条就当同级,不丢内容
      const parent = items[items.length - 1]
      if (parent) parent.children.push({ content: parseInline(text), children: [] })
      else items.push({ content: parseInline(text), children: [] })
    } else if (indent < baseIndent) {
      break
    } else {
      items.push({ content: parseInline(text), children: [] })
    }
    i++
  }

  return [{ kind: 'list', ordered, start: startNum, items }, i]
}

function splitRow(line: string): Inline[][] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => parseInline(c.trim()))
}

/**
 * 行内解析。顺序要紧:行内代码最先切,切出来的内容不再往下解析 ——
 * 否则 `**` 这种写在反引号里的字面量会被当成粗体。
 */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let rest = src

  while (rest.length > 0) {
    const code = /^([\s\S]*?)(`+)([\s\S]*?)\2/.exec(rest)
    const link = /^([\s\S]*?)\[([^\]]*)\]\(([^)\s]+)[^)]*\)/.exec(rest)
    const strong = /^([\s\S]*?)(\*\*|__)(?=\S)([\s\S]*?\S)\2/.exec(rest)
    const del = /^([\s\S]*?)~~(?=\S)([\s\S]*?\S)~~/.exec(rest)
    const em = /^([\s\S]*?)(?<![*\w])(\*|_)(?=\S)([^*_]*?\S)\2(?![*\w])/.exec(rest)

    // 谁的前缀最短谁先生效 —— 也就是在原串里出现得最靠前的那个
    const cands = [
      code && { at: code[1].length, m: code, kind: 'code' as const },
      link && { at: link[1].length, m: link, kind: 'link' as const },
      strong && { at: strong[1].length, m: strong, kind: 'strong' as const },
      del && { at: del[1].length, m: del, kind: 'del' as const },
      em && { at: em[1].length, m: em, kind: 'em' as const },
    ].filter((x): x is NonNullable<typeof x> => x !== null)

    if (cands.length === 0) {
      out.push({ kind: 'text', text: rest })
      break
    }

    cands.sort((a, b) => a.at - b.at)
    const win = cands[0]
    const lead = win.m[1]
    if (lead) out.push({ kind: 'text', text: lead })

    if (win.kind === 'code') {
      out.push({ kind: 'code', text: win.m[3] })
    } else if (win.kind === 'link') {
      out.push({ kind: 'link', href: win.m[3], children: parseInline(win.m[2]) })
    } else if (win.kind === 'strong') {
      out.push({ kind: 'strong', children: parseInline(win.m[3]) })
    } else if (win.kind === 'del') {
      out.push({ kind: 'del', children: parseInline(win.m[2]) })
    } else {
      out.push({ kind: 'em', children: parseInline(win.m[3]) })
    }

    rest = rest.slice(win.m[0].length)
  }

  return out.filter((n) => n.kind !== 'text' || n.text !== '')
}
