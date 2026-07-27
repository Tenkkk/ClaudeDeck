import { truncatePath } from '../lib/path.js'
import type { AppConfig } from '../../../shared/ipc.js'

/**
 * 屏幕 C · 选择项目 —— 设计终稿 §04。
 *
 * 原「选择工作目录」。这一屏之后不再出现:项目列表进了侧栏,切项目在侧栏点。
 * 只有全部项目都被删掉时才会再看到它的空态。
 */
export default function ProjectPicker({
  config,
  onPick,
  onUse,
}: {
  config: AppConfig | null
  onPick: () => void | Promise<void>
  onUse: (dir: string) => void | Promise<void>
}): React.JSX.Element {
  const projects = config?.workspaces ?? []
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
            {projects.map((dir) => (
              <button
                key={dir}
                className="project-pick"
                title={dir}
                onClick={() => void onUse(dir)}
              >
                <span className="name">{dir.split(/[\\/]/).filter(Boolean).pop()}</span>
                <span className="path">{truncatePath(dir)}</span>
              </button>
            ))}
          </section>
        )}

        <button className="primary" onClick={() => void onPick()}>
          ＋ 添加项目…
        </button>
      </div>
    </div>
  )
}
