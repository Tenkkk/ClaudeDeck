import { useRef, useState } from 'react'
import { attachmentKind, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_IMAGE_BYTES } from '../../../shared/attachments.js'
import type { ChatAttachment, AttachmentResult } from '../../../shared/ipc.js'

export interface DraftAttachment {
  key: string
  name: string
  size: number
  status: 'loading' | 'ready' | 'error'
  attachment?: ChatAttachment
  error?: string
}
interface Draft {
  project: string
  text: string
  files: DraftAttachment[]
  choosing: boolean
  error: string | null
}

/** 草稿仅存当前进程;异步文件处理回写发起时的草稿,不污染切换后的会话。 */
export function useComposer(): {
  draft: string; setDraft: (text: string) => void
  files: DraftAttachment[]; processing: boolean; attachmentError: string | null
  switchDraft: (project: string, session: string) => void
  renameDraft: (project: string, session: string) => void
  choose: () => Promise<void>; addFiles: (files: File[]) => Promise<void>
  addImage: (project: string, load: () => Promise<ChatAttachment>) => Promise<void>
  addPaste: (text: string) => Promise<void>; remove: (key: string) => Promise<void>
  clear: () => void
  recovery: (text: string, files: DraftAttachment[]) => () => void
} {
  const drafts = useRef(new Map<string, Draft>())
  const current = useRef('')
  const [, render] = useState(0)
  const update = (): void => render((n) => n + 1)
  const get = (): Draft => {
    let record = drafts.current.get(current.current)
    if (!record) {
      record = { project: '', text: '', files: [], choosing: false, error: null }
      drafts.current.set(current.current, record)
    }
    return record
  }
  const record = get()
  const processing = record.choosing || record.files.some((f) => f.status === 'loading')
  function setDraft(text: string): void { get().text = text; update() }
  function switchDraft(project: string, session: string): void {
    current.current = `${project}\0${session}`
    get().project = project
    update()
  }
  function renameDraft(project: string, session: string): void {
    project ||= get().project
    const target = `${project}\0${session}`
    if (target === current.current) return
    const draft = get()
    drafts.current.delete(current.current)
    drafts.current.set(target, draft)
    current.current = target
    draft.project = project
    update()
  }
  async function discard(draft: Draft, file: ChatAttachment): Promise<void> {
    await window.api.attachments.remove(draft.project, file.id)
  }
  async function complete(draft: Draft, placeholder: DraftAttachment, load: () => Promise<ChatAttachment>): Promise<void> {
    try {
      const file = await load()
      if (!draft.files.includes(placeholder)) { await discard(draft, file); return }
      const total = draft.files.reduce((sum, f) => sum + (f === placeholder ? file.size : f.size), 0)
      if (total > MAX_ATTACHMENT_BYTES) {
        await discard(draft, file)
        throw new Error('附件总大小不能超过 20MB。')
      }
      Object.assign(placeholder, { name: file.name, size: file.size, attachment: file, status: 'ready' })
    } catch (err) {
      Object.assign(placeholder, { status: 'error', error: err instanceof Error ? err.message : String(err) })
    } finally { update() }
  }
  function reserve(draft: Draft, name: string, size: number): DraftAttachment {
    if (draft.files.length >= MAX_ATTACHMENTS) throw new Error('每条消息最多 8 个附件。')
    const file: DraftAttachment = { key: crypto.randomUUID(), name, size, status: 'loading' }
    draft.files.push(file)
    update()
    return file
  }
  async function addFiles(files: File[]): Promise<void> {
    const draft = get()
    draft.error = null
    const pending: { file: File; placeholder: DraftAttachment }[] = []
    for (const file of files) {
      let placeholder: DraftAttachment
      try { placeholder = reserve(draft, file.name || 'image.png', file.size) }
      catch (err) { draft.error = String(err); update(); break }
      pending.push({ file, placeholder })
    }
    for (const { file, placeholder } of pending) {
      await complete(draft, placeholder, async () => {
        const kind = attachmentKind(placeholder.name)
        if (!kind) throw new Error('暂不支持此格式,音视频和旧版 Office 请先转换。')
        if (file.size > (kind === 'image' ? MAX_IMAGE_BYTES : MAX_ATTACHMENT_BYTES)) throw new Error('附件过大:图片最多 5MB,其他文件最多 20MB。')
        if (draft.files.reduce((sum, f) => sum + f.size, 0) > MAX_ATTACHMENT_BYTES) throw new Error('附件总大小不能超过 20MB。')
        return window.api.attachments.add(draft.project, placeholder.name, new Uint8Array(await file.arrayBuffer()))
      })
    }
  }
  async function addPaste(text: string): Promise<void> {
    const draft = get()
    draft.error = null
    try {
      const bytes = new TextEncoder().encode(text)
      const name = `粘贴文本-${draft.files.filter((f) => f.attachment?.pasted).length + 1}.txt`
      const placeholder = reserve(draft, name, bytes.length)
      await complete(draft, placeholder, () => window.api.attachments.add(draft.project, name, bytes, true))
      if (placeholder.status === 'error') {
        // 转附件失败不能丢掉用户的剪贴板原文。
        draft.text += (draft.text ? '\n' : '') + text
        draft.error = `${placeholder.error} 原文已保留在输入框。`
        draft.files = draft.files.filter((f) => f !== placeholder)
        update()
      }
    } catch (err) {
      draft.text += (draft.text ? '\n' : '') + text
      draft.error = `${String(err)} 原文已保留在输入框。`
      update()
    }
  }
  async function addImage(project: string, load: () => Promise<ChatAttachment>): Promise<void> {
    const draft = get()
    if (draft.project !== project) throw new Error('会话已切换,请在当前会话重新添加图片。')
    const placeholder = reserve(draft, '图片', 0)
    await complete(draft, placeholder, load)
    if (!draft.files.includes(placeholder)) throw new Error('图片添加已取消。')
    if (placeholder.status === 'error') {
      draft.files = draft.files.filter((file) => file !== placeholder)
      update()
      throw new Error(placeholder.error)
    }
  }
  async function choose(): Promise<void> {
    const draft = get()
    if (draft.choosing) return
    draft.choosing = true
    draft.error = null
    update()
    try {
      const results: AttachmentResult[] = await window.api.attachments.choose(draft.project)
      for (const result of results) {
        let placeholder: DraftAttachment
        try { placeholder = reserve(draft, result.name, result.attachment?.size ?? 0) }
        catch (err) {
          if (result.attachment) await discard(draft, result.attachment)
          draft.error = String(err)
          continue
        }
        await complete(draft, placeholder, async () => {
          if (!result.attachment) throw new Error(result.error || '读取附件失败。')
          return result.attachment
        })
      }
    } catch (err) { draft.error = err instanceof Error ? err.message : String(err) }
    finally { draft.choosing = false; update() }
  }
  async function remove(key: string): Promise<void> {
    const draft = get()
    const file = draft.files.find((f) => f.key === key)
    draft.files = draft.files.filter((f) => f.key !== key)
    update()
    if (file?.attachment) {
      try { await discard(draft, file.attachment) }
      catch (err) { draft.error = `清理附件失败:${String(err)}`; update() }
    }
  }
  return {
    draft: record.text, setDraft, files: record.files, processing, attachmentError: record.error,
    switchDraft, renameDraft, choose, addFiles, addImage, addPaste, remove,
    clear: () => { const draft = get(); draft.text = ''; draft.files = []; draft.error = null; update() },
    recovery: (text, files) => {
      const draft = get()
      return () => { draft.text = text + draft.text; draft.files = [...files, ...draft.files]; update() }
    },
  }
}
