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
const UNREADABLE: Record<string, string> = {
  'not-found': '这个文件不在了。',
  'out-of-scope': '这个文件不在项目目录内。',
  'too-large': '文件太大,不在这里展开。',
  binary: '这是个二进制文件,没什么可读的。',
}

export default function MidColumn({
  projectPath,
  projectName,
  relPath,
  onClose,
  onBack,
  onDirtyChange,
}: {
  projectPath: string
  projectName: string
  relPath: string
  onClose: () => void
  /** 从文件树点进来的,给一条回去的路 */
  onBack?: () => void
  onDirtyChange: (dirty: boolean) => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [error, setError] = useState<{ line: number; message: string } | null>(null)
  /**
   * 拦下来的是哪一种离开:返回文件树,还是关掉整栏。
   *
   * 不记住的话,「不保存」只能选一种走法 —— 从树点进来的文件按了返回,
   * 结果整栏没了,人还得重新打开文件树。
   */
  const [confirming, setConfirming] = useState<null | 'back' | 'close'>(null)
  const [loading, setLoading] = useState(true)
  /** 只有 .claude 里的配置和项目根的 CLAUDE.md 可写,其余一律只读 */
  const [editable, setEditable] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  const dirty = editable && text !== saved

  useEffect(() => {
    let alive = true
    setLoading(true)
    void window.api.files.read(projectPath, relPath).then((r) => {
      if (!alive) return
      if (r.ok) {
        setText(r.text)
        setSaved(r.text)
        setEditable(r.editable)
        setError(null)
      } else {
        setText('')
        setSaved('')
        setEditable(false)
        setError({ line: 0, message: UNREADABLE[r.reason] ?? '读不了这个文件。' })
      }
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

  /** 返回文件树(没有树就直接关) */
  function requestClose(): void {
    if (dirty) setConfirming('back')
    else (onBack ?? onClose)()
  }

  /** 确认之后按当初点的那一颗走 */
  function leave(): void {
    const go = confirming === 'back' ? (onBack ?? onClose) : onClose
    setConfirming(null)
    go()
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
        {onBack && (
          <button className="ghost icon-btn midcol-back" title="回到文件树" onClick={requestClose}>
            ‹
          </button>
        )}
        <div className="midcol-title">
          {/* 改动只用这颗点说 */}
          {dirty && <span className="dirty-dot" aria-label="有未保存的改动" />}
          <span className="midcol-name">{relPath.split('/').pop()}</span>
        </div>
        <span className="midcol-crumb">
          {projectName} / {relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '项目根'}
        </span>
        {/* 只读的说清楚,免得改了半天才发现存不下 */}
        {!loading && !editable && !error && <span className="midcol-ro">只读</span>}
        <button className="ghost icon-btn" title="关闭" onClick={() => (dirty ? setConfirming('close') : onClose())}>
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
          readOnly={!editable}
          value={loading ? '' : text}
          onScroll={syncScroll}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (editable && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
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
            <button onClick={() => setConfirming(null)}>取消</button>
            <button onClick={leave}>不保存</button>
            <button
              className="primary"
              onClick={async () => {
                const r = await save()
                // 存不下就留在原地 —— 存不下还把人送走,改动就真丢了
                if (r.ok) leave()
                else setConfirming(null)
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
