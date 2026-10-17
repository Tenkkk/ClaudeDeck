import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { attachmentKind, attachmentPrompt, IMAGE_TYPES, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_IMAGE_BYTES, MAX_TEXT_BYTES } from '../shared/attachments.js'
import type { AttachmentPreview, AttachmentResult, AttachmentSummary, ChatAttachment, ImageAttachment } from '../shared/ipc.js'
import { decodeText, extractOffice } from './documents.js'

interface StoredAttachment {
  summary: ChatAttachment
  owner: number
  project: string
  directory: string
  path: string
  text?: string
  image?: ImageAttachment
  sent: boolean
}

/** 凭证由主进程生成;渲染层不能通过路径读取任意本机文件。 */
export class AttachmentStore {
  private records = new Map<string, StoredAttachment>()

  constructor(private readonly root: string) {}

  async fromFile(owner: number, project: string, path: string): Promise<ChatAttachment> {
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_ATTACHMENT_BYTES) throw new Error('请选择不超过 20MB 的普通文件。')
    if (!attachmentKind(basename(path))) throw new Error('暂不支持此格式,音视频和旧版 Office 请先转换。')
    return this.add(owner, project, basename(path), await readFile(path))
  }

  async add(owner: number, project: string, name: string, bytes: Uint8Array, pasted = false): Promise<ChatAttachment> {
    if (typeof name !== 'string' || !name || name.length > 240 || /[\x00-\x1f\\/:]/.test(name)) throw new Error('附件名称无效。')
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('附件须非空且不超过 20MB。')
    const kind = attachmentKind(name)
    if (!kind || (pasted && kind !== 'text')) throw new Error('暂不支持此文件格式。')
    const data = Buffer.from(bytes)
    const extension = extname(name).slice(1).toLowerCase()
    let text: string | undefined
    let image: ImageAttachment | undefined
    if (kind === 'image') {
      if (data.length > MAX_IMAGE_BYTES) throw new Error('单张图片不能超过 5MB。')
      const detected = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
        : data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff ? 'image/jpeg'
        : /^GIF8[79]a$/.test(data.subarray(0, 6).toString('ascii')) ? 'image/gif'
        : data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP' ? 'image/webp' : null
      if (detected !== IMAGE_TYPES[extension]) throw new Error('图片内容与格式不符或已损坏。')
      image = { mediaType: detected as ImageAttachment['mediaType'], data: data.toString('base64') }
    } else if (kind === 'pdf') {
      if (!data.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('不是有效的 PDF 文件。')
      if (/\/Encrypt\b/.test(data.toString('latin1'))) throw new Error('暂不支持加密 PDF,请先解密。')
    } else {
      try {
        text = kind === 'text' ? decodeText(data) : extractOffice(data, extension)
      } catch (err) {
        throw new Error(`无法提取文字:${err instanceof Error ? err.message : String(err)}`)
      }
      if (!text.trim()) throw new Error('附件没有可读取的文字。')
      if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw new Error('文本不能超过 2MB。')
    }
    const id = randomUUID()
    const directory = join(this.root, id)
    await mkdir(directory, { recursive: true })
    const path = join(directory, `source.${extension}`)
    try {
      await writeFile(path, data)
      if (text !== undefined) await writeFile(join(directory, 'content.txt'), text, 'utf8')
      const summary: ChatAttachment = {
        id, name, size: data.length, kind, ...(pasted ? { pasted: true } : {}),
        ...(image ? { thumbnail: `data:${image.mediaType};base64,${image.data}` } : {}),
      }
      this.records.set(id, { summary, owner, project, directory,
        path: text !== undefined ? join(directory, 'content.txt') : path, text, image, sent: false })
      return summary
    } catch (err) {
      await this.cleanDirectory(directory)
      throw err
    }
  }

  private get(owner: number, project: string, id: string): StoredAttachment {
    const record = typeof id === 'string' ? this.records.get(id) : undefined
    if (!record || record.owner !== owner || record.project !== project) throw new Error('附件凭证失效或不属于此项目,请重新添加。')
    return record
  }

  preview(owner: number, project: string, id: string): AttachmentPreview {
    const record = this.get(owner, project, id)
    if (record.image) return { image: record.summary.thumbnail }
    if (record.text !== undefined) return { text: record.text }
    return { note: 'PDF 保留原始文件,发送后由 Claude Code 的 Read 工具按需读取;当前不提供 PDF 页面预览。' }
  }

  prepare(owner: number, project: string, ids: string[], text: string): {
    prompt: string; images: ImageAttachment[]; summaries: AttachmentSummary[]
  } {
    if (!Array.isArray(ids) || ids.length > MAX_ATTACHMENTS || new Set(ids).size !== ids.length) throw new Error('每条消息最多 8 个不同附件。')
    const records = ids.map((id) => this.get(owner, project, id))
    if (records.reduce((sum, r) => sum + r.summary.size, 0) > MAX_ATTACHMENT_BYTES) throw new Error('附件总大小不能超过 20MB。')
    const summaries = records.map(({ summary: { thumbnail: _thumbnail, ...summary } }) => summary)
    return {
      prompt: attachmentPrompt(text, summaries, records.filter((r) => !r.image)
        .map((r) => ({ name: r.summary.name, path: r.path, kind: r.summary.kind }))),
      images: records.flatMap((r) => r.image ? [r.image] : []), summaries,
    }
  }

  commit(owner: number, project: string, ids: string[]): void {
    for (const id of ids) this.get(owner, project, id).sent = true
  }

  async remove(owner: number, project: string, id: string): Promise<void> {
    const record = this.get(owner, project, id)
    if (record.sent) return
    this.records.delete(id)
    await this.cleanDirectory(record.directory)
  }

  private async cleanDirectory(directory: string): Promise<void> {
    if (dirname(resolve(directory)) !== resolve(this.root) || !/^[a-f0-9-]{36}$/.test(basename(directory))) throw new Error('附件目录越界。')
    await rm(directory, { recursive: true, force: true })
  }

  dispose(): void {
    for (const record of this.records.values()) {
      if (record.sent) continue
      if (dirname(resolve(record.directory)) !== resolve(this.root) || !/^[a-f0-9-]{36}$/.test(basename(record.directory))) continue
      try { rmSync(record.directory, { recursive: true, force: true }) } catch { /* 清理失败不能阻止退出 */ }
    }
  }
}

export async function attachmentResult(name: string, load: () => Promise<ChatAttachment>): Promise<AttachmentResult> {
  try { return { name, attachment: await load() } }
  catch (err) { return { name, error: err instanceof Error ? err.message : String(err) } }
}
