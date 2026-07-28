import { useEffect, useRef, useState } from 'react'
import type { SaveResult } from '../../../shared/ipc.js'

/**
 * `.claude` 读写中栏 —— 设计终稿 §10。264 + 320 + 剩下的。
 *
 * **底部没有提示条也没有按钮。** 改动只用文件名左边那颗点说,`Ctrl S` 保存。
 * 关掉或切走时才拦一次 —— 边改边弹条是噪音。
 *
 * JSON 写坏在保存前就被拦住并指出行号(校验在主进程,见 claudedir.ts):
 * settings.json 写坏会让 Claude Code 在这个项目里行为异常,而错误往往
 * 到下次启动才暴露,那时人已经不记得是这一步改坏的。
 */
export default function MidColumn({
  projectPath,
  projectName,
  relPath,
  onClose,
  onDirtyChange,
}: {
  projectPath: string
  projectName: string
  relPath: string
  onClose: () => void
  onDirtyChange: (dirty: boolean) => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [error, setError] = useState<{ line: number; message: string } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(true)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  const dirty = text !== saved

  useEffect(() => {
    let alive = true
    setLoading(true)
    void window.api.claude.read(projectPath, relPath).then((c) => {
      if (!alive) return
      setText(c ?? '')
      setSaved(c ?? '')
      setError(null)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [projectPath, relPath])

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  async function save(): Promise<SaveResult> {
    const result = await window.api.claude.write(projectPath, relPath, text)
    if (result.ok) {
      setSaved(text)
      setError(null)
    } else if (result.reason === 'invalid-json') {
      setError({ line: result.line, message: result.message })
    } else {
      setError({ line: 0, message: result.reason === 'out-of-scope' ? '这个文件不在可写范围内。' : result.message })
    }
    return result
  }

  function requestClose(): void {
    if (dirty) setConfirming(true)
    else onClose()
  }

  // 行号跟着正文滚
  function syncScroll(): void {
    if (gutterRef.current && areaRef.current) {
      gutterRef.current.scrollTop = areaRef.current.scrollTop
    }
  }

  const lines = text.split('\n')

  return (
    <aside className="midcol">
      <div className="midcol-head">
        <div className="midcol-title">
          {/* 改动只用这颗点说 */}
          {dirty && <span className="dirty-dot" aria-label="有未保存的改动" />}
          <span className="midcol-name">{relPath.split('/').pop()}</span>
        </div>
        <span className="midcol-crumb">
          {projectName} / {relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '项目根'}
        </span>
        <button className="ghost icon-btn" title="关闭" onClick={requestClose}>
          ✕
        </button>
      </div>

      {error && (
        <div className="midcol-error">
          {error.line > 0 ? `第 ${error.line} 行:` : ''}
          {error.message}
        </div>
      )}

      <div className="midcol-body">
        <div className="midcol-gutter" ref={gutterRef} aria-hidden="true">
          {lines.map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          ref={areaRef}
          className="midcol-text"
          spellCheck={false}
          value={loading ? '' : text}
          onScroll={syncScroll}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
              e.preventDefault()
              void save()
            }
          }}
        />
      </div>

      {confirming && (
        <div className="midcol-confirm">
          <strong>{relPath.split('/').pop()} 有未保存的改动</strong>
          <p>保存会立刻改变 Claude Code 在这个项目里的行为。</p>
          <div className="row">
            <button onClick={() => setConfirming(false)}>取消</button>
            <button
              onClick={() => {
                setConfirming(false)
                onClose()
              }}
            >
              不保存
            </button>
            <button
              className="primary"
              onClick={async () => {
                const r = await save()
                setConfirming(false)
                if (r.ok) onClose()
              }}
            >
              保存
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
