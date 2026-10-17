import { useEffect, useRef, useState } from 'react'
import type { AttachmentPreview } from '../../../shared/ipc.js'
import { attachmentSize } from '../../../shared/attachments.js'
import type { DraftAttachment } from '../lib/composer.js'

export function AttachmentIcon(): React.JSX.Element {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
    <path d="m5 9 5-5a2 2 0 0 1 3 3l-6 6a3 3 0 0 1-4-4l6-6M5 9a1 1 0 0 0 1.5 1.5L11 6" />
  </svg>
}

export default function AttachmentCards({ files, project, onRemove, onRestore }: {
  files: DraftAttachment[]
  project: string
  onRemove: (key: string) => Promise<void>
  onRestore: (text: string) => void
}): React.JSX.Element | null {
  const [preview, setPreview] = useState<{ key: string; name: string; content?: AttachmentPreview; error?: string; pasted?: boolean } | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    if (preview) dialog.current?.showModal()
  }, [Boolean(preview)])
  function close(): void {
    generation.current++
    dialog.current?.close()
    setPreview(null)
    trigger.current?.focus()
  }
  async function open(file: DraftAttachment): Promise<void> {
    if (!file.attachment) return
    const gen = ++generation.current
    trigger.current = document.activeElement as HTMLElement
    setPreview({ key: file.key, name: file.name, pasted: file.attachment.pasted })
    try {
      const content = await window.api.attachments.preview(project, file.attachment.id)
      if (generation.current === gen) setPreview({ key: file.key, name: file.name, content, pasted: file.attachment.pasted })
    } catch (err) {
      if (generation.current === gen) setPreview({ key: file.key, name: file.name, error: String(err) })
    }
  }
  if (!files.length) return null
  return <>
    <div className="attachment-cards" aria-label="待发送附件">
      {files.map((file) => <div className={`attachment-card${file.status === 'error' ? ' failed' : ''}`} key={file.key}>
        <button className="attachment-preview" disabled={file.status !== 'ready'} onClick={() => void open(file)} title={file.name} aria-label={`预览 ${file.name}`}>
          {file.attachment?.thumbnail ? <img src={file.attachment.thumbnail} alt="" /> : <AttachmentIcon />}
          <span className="attachment-label"><span className="attachment-name">{file.name}</span>
            <span className="attachment-detail">{file.status === 'loading' ? '正在处理…' : file.status === 'error' ? '处理失败' : `${file.name.split('.').at(-1)?.toUpperCase()} · ${attachmentSize(file.size)}`}</span>
          </span>
        </button>
        <button className="attachment-remove" onClick={() => void onRemove(file.key)} title={`移除 ${file.name}`} aria-label={`移除 ${file.name}`}>×</button>
        {file.error && <span className="attachment-file-error" role="alert">{file.error}</span>}
      </div>)}
    </div>
    {preview && <dialog ref={dialog} className="attachment-dialog" aria-label={`附件预览:${preview.name}`}
      onCancel={(e) => { e.preventDefault(); close() }} onClick={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="attachment-dialog-body">
        <div className="attachment-dialog-heading"><span title={preview.name}>{preview.name}</span><button autoFocus onClick={close} aria-label="关闭附件预览">×</button></div>
        {!preview.content && !preview.error && <p role="status">正在读取…</p>}
        {preview.error && <p role="alert">{preview.error}</p>}
        {preview.content?.image && <img className="attachment-large-image" src={preview.content.image} alt={preview.name} />}
        {preview.content?.note && <p>{preview.content.note}</p>}
        {preview.content?.text !== undefined && <><pre>{preview.content.text.slice(0, 30_000)}</pre>
          {preview.content.text.length > 30_000 && <p>预览前 30,000 字符,发送时保留完整文件。</p>}</>}
        {preview.pasted && preview.content?.text !== undefined && <button className="secondary" onClick={() => {
          onRestore(preview.content!.text!)
          void onRemove(preview.key)
          close()
        }}>放回输入框</button>}
      </div>
    </dialog>}
  </>
}
