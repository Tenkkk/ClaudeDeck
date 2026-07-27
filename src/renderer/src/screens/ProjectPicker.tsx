import { truncatePath } from '../lib/path.js'
import type { AppConfig } from '../../../shared/ipc.js'

/**
 * 屏幕 C · 选择项目 —— 设计终稿 §04。
 *
 * 原「选择工作目录」。进入主界面后项目在侧栏管理,这一屏只在没有任何项目、
 * 或用户从侧栏主动回来管理时出现。
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

  return (
    <div className="screen-center">
      <div className="card">
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
                <button className="project-pick" title={p.path} onClick={() => void onUse(p.path)}>
                  <span className="name">{p.name}</span>
                  <span className="path">{truncatePath(p.path)}</span>
                </button>
                <button
                  className="ghost"
                  title="从列表中移除(不会删除磁盘上的目录或会话)"
                  onClick={() => void onRemove(p.path)}
                >
                  移除
                </button>
              </div>
            ))}
          </section>
        )}

        <button className="primary" onClick={() => void onAdd()}>
          ＋ 添加项目…
        </button>
      </div>
    </div>
  )
}
