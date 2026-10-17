import { crc32, inflateRawSync } from 'node:zlib'
import { MAX_ATTACHMENT_BYTES, MAX_TEXT_BYTES } from '../shared/attachments.js'

/** 只读 Office ZIP 的中央目录;不解压到磁盘、不运行宏、拒绝加密与解压炸弹。 */
function officeEntries(data: Buffer): Map<string, Buffer> {
  let end = data.length - 22
  const floor = Math.max(0, data.length - 65_557)
  while (end >= floor && data.readUInt32LE(end) !== 0x06054b50) end--
  if (end < floor || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6)) throw new Error('不是受支持的 Office 文档。')
  const count = data.readUInt16LE(end + 10)
  let pos = data.readUInt32LE(end + 16)
  const result = new Map<string, Buffer>()
  let expanded = 0
  if (count > 4096) throw new Error('文档包含过多压缩条目。')
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || data.readUInt32LE(pos) !== 0x02014b50) throw new Error('Office 压缩目录损坏。')
    const flags = data.readUInt16LE(pos + 8)
    const method = data.readUInt16LE(pos + 10)
    const packed = data.readUInt32LE(pos + 20)
    const checksum = data.readUInt32LE(pos + 16)
    const size = data.readUInt32LE(pos + 24)
    const nameLength = data.readUInt16LE(pos + 28)
    const offset = data.readUInt32LE(pos + 42)
    const next = pos + 46 + nameLength + data.readUInt16LE(pos + 30) + data.readUInt16LE(pos + 32)
    if (next > end) throw new Error('Office 压缩目录损坏。')
    const name = data.subarray(pos + 46, pos + 46 + nameLength).toString('utf8')
    pos = next
    if (!/^(word\/document\.xml|ppt\/slides\/slide\d+\.xml|xl\/(sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml))$/.test(name)) continue
    if (flags & 1) throw new Error('暂不支持加密文档。')
    expanded += size
    if (expanded > MAX_ATTACHMENT_BYTES || size > MAX_ATTACHMENT_BYTES) throw new Error('文档解压后过大。')
    if (offset + 30 > data.length || data.readUInt32LE(offset) !== 0x04034b50) throw new Error('Office 压缩条目损坏。')
    const start = offset + 30 + data.readUInt16LE(offset + 26) + data.readUInt16LE(offset + 28)
    if (start + packed > data.length || ![0, 8].includes(method)) throw new Error('不支持此文档的压缩方式。')
    const bytes = data.subarray(start, start + packed)
    const value = method === 0 ? bytes : inflateRawSync(bytes, { maxOutputLength: Math.min(size + 1, MAX_ATTACHMENT_BYTES) })
    if (value.length !== size || crc32(value) !== checksum || result.has(name)) throw new Error('Office 文档条目不一致。')
    result.set(name, value)
  }
  return result
}

function entities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, key: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (named[key]) return named[key]
    const code = key.startsWith('#x') ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10)
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

function attribute(tag: string, key: string): string {
  return entities(new RegExp(`(?:^|\\s)${key}=["']([^"']*)["']`).exec(tag)?.[1] ?? '')
}

function textRuns(xml: string): string {
  return entities(xml.replace(/<(?:\w+:)?tab\b[^>]*\/>/g, '\t')
    .replace(/<\/(?:\w+:)?(?:p|tr)>/g, '\n').replace(/<\/(?:\w+:)?tc>/g, '\t')
    .replace(/<(?:\w+:)?br\b[^>]*\/>/g, '\n').replace(/<[^>]+>/g, ''))
}

export function decodeText(data: Buffer): string {
  let text: string
  if (data[0] === 0xff && data[1] === 0xfe) text = new TextDecoder('utf-16le', { fatal: true }).decode(data)
  else if (data[0] === 0xfe && data[1] === 0xff) text = new TextDecoder('utf-16be', { fatal: true }).decode(data)
  else text = new TextDecoder('utf-8', { fatal: true }).decode(data)
  if (text.includes('\0')) throw new Error('该文件不是受支持的文本,请先转换为 UTF-8。')
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw new Error('提取文字超过 2MB,请拆分后添加。')
  return text
}

export function extractOffice(data: Buffer, extension: string): string {
  const entries = officeEntries(data)
  const xml = (name: string): string => {
    const value = entries.get(name)
    if (!value) throw new Error(`文档缺少 ${name},可能损坏或已加密。`)
    const source = new TextDecoder('utf-8', { fatal: true }).decode(value)
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('不支持含外部实体的文档。')
    return source
  }
  let text = ''
  if (extension === 'docx') text = textRuns(xml('word/document.xml'))
  else if (extension === 'pptx') {
    const slides = [...entries.keys()].filter((name) => /^ppt\/slides\//.test(name))
      .sort((a, b) => Number(/slide(\d+)/.exec(a)?.[1]) - Number(/slide(\d+)/.exec(b)?.[1]))
    text = slides.map((name, i) => `## 第 ${i + 1} 页\n${textRuns(xml(name))}`).join('\n\n')
  } else {
    const shared = entries.has('xl/sharedStrings.xml')
      ? [...xml('xl/sharedStrings.xml').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1])) : []
    const relations = new Map([...xml('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*?)\/?\s*>/g)]
      .map((m) => [attribute(m[1], 'Id'), attribute(m[1], 'Target')]))
    const sheets = [...xml('xl/workbook.xml').matchAll(/<sheet\b([^>]*?)\/?\s*>/g)]
    text = sheets.map((sheet) => {
      const target = relations.get(attribute(sheet[1], 'r:id')) ?? ''
      const name = target.startsWith('/') ? target.slice(1) : `xl/${target}`
      if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) throw new Error('工作表引用不受支持。')
      const cells = [...xml(name).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
        const body = c[2] ?? ''
        const type = attribute(c[1], 't')
        const value = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ''
        const formula = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1]
        const shown = type === 's' ? shared[Number(value)] ?? '' : type === 'inlineStr'
          ? textRuns(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '') : entities(value)
        return `${attribute(c[1], 'r')}: ${shown}${formula ? ` [公式: ${entities(formula)}]` : ''}`
      })
      return `## 工作表: ${attribute(sheet[1], 'name')}\n${cells.join('\n')}`
    }).join('\n\n')
  }
  if (!text.trim()) throw new Error('文档未提取到文字(可能只有图片),请转成 PDF 或图片后添加。')
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw new Error('提取文字超过 2MB,请拆分后添加。')
  return text
}
