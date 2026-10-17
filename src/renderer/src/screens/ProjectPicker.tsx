import { useRef, useState } from 'react'
import { truncatePath } from '../lib/path.js'
import type { AppConfig } from '../../../shared/ipc.js'

/**
 * 屏幕 C · 选择项目 —— 设计终稿 §04。
 *
 * 没有已登记项目时展示独立选择页,添加入口打开创建项目表单。
 */
export default function ProjectPicker({
  config,
  onAdd,
  onUse,
  onRemove,
}: {
  config: AppConfig | null
  onAdd: () => void | Promise<void>
  onUse: (path: string) => void | Promise<void>
  onRemove: (path: string) => void | Promise<void>
}): React.JSX.Element {
  const projects = config?.projects ?? []
  const empty = projects.length === 0
  const submitting = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => void | Promise<void>): Promise<void> {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return (
    <div className="screen-center">
      <div className="card" aria-busy={busy}>
        <div className="brand">
          <span className="brand-dot" />
          ClaudeDeck
        </div>
        <h1>{empty ? '还没有项目' : '选一个项目'}</h1>
        <p className="hint" style={{ margin: 0 }}>
          {empty
            ? '挑一个代码目录加进来。Claude Code 会在这个目录里读写文件,第一次动手之前会先问你。'
            : '一个项目就是一个工作目录。Claude Code 的会话按目录归属,选定后这个目录下的历史会话会全部列出来。'}
        </p>

        {!empty && (
          <section>
            {projects.map((p) => (
              <div key={p.path} className="project-pick-row">
                <button className="project-pick" title={p.path} disabled={busy}
                  onClick={() => void run(() => onUse(p.path))}>
                  <span className="name">{p.name}</span>
                  <span className="path">{truncatePath(p.path)}</span>
                </button>
                <button
                  className="ghost"
                  title="从列表中移除(不会删除磁盘上的目录或会话)"
                  disabled={busy}
                  onClick={() => void run(() => onRemove(p.path))}
                >
                  移除
                </button>
              </div>
            ))}
          </section>
        )}

        {error && <div className="project-menu-error" role="alert">{error}</div>}
        <button className="primary" disabled={busy} onClick={() => void run(onAdd)}>
          ＋ 添加项目…
        </button>
      </div>
    </div>
  )
}
