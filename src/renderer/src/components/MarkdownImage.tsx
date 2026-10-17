import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { imageSource } from '../lib/image.js'
import ImageMenu from './ImageMenu.js'
import ImageViewer from './ImageViewer.js'
import type { MarkdownImageRead } from '../../../shared/ipc.js'

export const MarkdownImageContext = createContext<{ projectPath?: string; baseDir?: string }>({})

const REASON = {
  'not-found': '图片不存在或无法读取。',
  'out-of-scope': '仅能显示当前项目目录内的本地图片。',
  'too-large': '图片超过 20MB,不在对话中展开。',
  unsupported: '不支持此图片格式或地址,支持 PNG、JPEG、GIF、WebP。',
  unavailable: '图片预览接口尚未加载,请重启应用。',
}

export default function MarkdownImage({ source, alt }: { source: string; alt: string }): React.JSX.Element {
  const { projectPath, baseDir } = useContext(MarkdownImageContext)
  const resolved = imageSource(source, baseDir)
  const identity = `${projectPath ?? ''}\0${resolved.kind === 'unsupported' ? source : resolved.source}`
  const [read, setRead] = useState<{ identity: string; result: MarkdownImageRead } | null>(null)
  const [approved, setApproved] = useState(false)
  const [loaded, setLoaded] = useState('')
  const [broken, setBroken] = useState('')
  const [zoom, setZoom] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const [size, setSize] = useState({ width: 1, height: 1 })
  const label = alt || '图片'

  useEffect(() => {
    if (resolved.kind !== 'local') return
    let stale = false
    const finish = (result: MarkdownImageRead): void => { if (!stale) setRead({ identity, result }) }
    if (!projectPath) finish({ ok: false, reason: 'out-of-scope' })
    else if (typeof window.api.files.image !== 'function') finish({ ok: false, reason: 'unavailable' })
    else void window.api.files.image(projectPath, resolved.source).then(finish, (err: unknown) => finish({
      ok: false, reason: /No handler registered/.test(String(err)) ? 'unavailable' : 'not-found',
    }))
    return () => { stale = true }
  }, [identity])

  let src: string | undefined
  let error: string | undefined
  if (resolved.kind === 'unsupported') error = REASON.unsupported
  else if (resolved.kind === 'local') {
    const result = read?.identity === identity ? read.result : null
    if (result?.ok) src = result.src
    else if (result) error = REASON[result.reason]
  } else if (resolved.kind === 'data' || approved) src = resolved.source
  if (src && broken === identity) error = '图片加载失败,文件可能已损坏或网络地址不可用。'

  return <span className="md-image">
    {error ? <span className="md-image-status" title={source}>{label} · {error}</span>
      : resolved.kind === 'remote' && !approved ? <button className="md-image-status md-image-load"
        onClick={() => setApproved(true)} title={resolved.source}>加载网络图片 · {label}</button>
        : <>
          {loaded !== identity && <span className="md-image-status" role="status">正在加载图片 · {label}</span>}
          {src && <span className="md-image-stage" hidden={loaded !== identity}><button ref={trigger} className="md-image-button" aria-label={`放大图片:${label}`}
            hidden={loaded !== identity} onClick={() => setZoom(true)}>
            <img src={src} alt={alt} decoding="async" referrerPolicy="no-referrer"
              onLoad={(e) => { setLoaded(identity); setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight }) }} onError={() => setBroken(identity)} />
          </button><ImageMenu project={projectPath} source={resolved.kind === 'unsupported' ? source : resolved.source} /></span>}
        </>}
    {zoom && src && createPortal(<ImageViewer src={src} source={resolved.kind === 'unsupported' ? source : resolved.source}
      label={label} project={projectPath} width={size.width} height={size.height} onClose={() => setZoom(false)} />, document.body)}
  </span>
}
