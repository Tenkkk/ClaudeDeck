import { relativeTime } from '../lib/path.js'
import type { Project, SessionListItem, UsageInfo, Versions } from '../../../shared/ipc.js'

const COLLAPSED_LIMIT = 3

/**
 * 侧栏 —— 设计终稿 §05。项目 → 会话两层,多个项目并列。
 *
 * 点别的项目里的会话 = 隐式切换 activeWorkspace 再 resume,所以
 * onOpenSession 要带上项目路径。
 */
export default function Sidebar({
  projects,
  sessionsByProject,
  activeWorkspace,
  activeSession,
  usage,
  versions,
  expandedAll,
  onNewSession,
  onOpenSession,
  onToggleCollapse,
  onExpandAll,
  onAddProject,
  onManageProjects,
}: {
  projects: Project[]
  sessionsByProject: Record<string, SessionListItem[]>
  activeWorkspace: string | null
  activeSession: string | null
  usage: UsageInfo | null
  versions: Versions | null
  expandedAll: Record<string, boolean>
  onNewSession: () => void
  onOpenSession: (projectPath: string, sessionId: string) => void
  onToggleCollapse: (path: string, collapsed: boolean) => void
  onExpandAll: (path: string) => void
  onAddProject: () => void
  onManageProjects: () => void
}): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand">
          <span className="brand-dot" />
          ClaudeDeck
        </span>
      </div>

      <div className="sidebar-new">
        <button className="primary" onClick={onNewSession}>
          ＋ 新建会话 <kbd>Ctrl N</kbd>
        </button>
      </div>

      <div className="sidebar-scroll">
        <div className="group-head">
          <span>项目 · {projects.length}</span>
          <span className="spacer" />
          <button className="ghost" title="管理项目" onClick={onManageProjects}>
            ···
          </button>
          <button className="ghost" title="添加项目" onClick={onAddProject}>
            ＋
          </button>
        </div>

        {projects.length === 0 && (
          <div className="hint" style={{ padding: 'var(--s8) var(--s12)' }}>
            还没有项目。
          </div>
        )}

        {projects.map((project) => {
          const sessions = sessionsByProject[project.path] ?? []
          const open = !project.collapsed
          const showAll = expandedAll[project.path] === true
          const visible = showAll ? sessions : sessions.slice(0, COLLAPSED_LIMIT)

          return (
            <div key={project.path}>
              <button
                className="project-row"
                aria-expanded={open}
                aria-current={project.path === activeWorkspace}
                title={project.path}
                onClick={() => onToggleCollapse(project.path, open)}
              >
                <span className="caret" />
                <span className="name">{project.name}</span>
                <span className="count">{sessions.length}</span>
              </button>

              {open && (
                <>
                  {/* .claude 节点挂在项目名和会话之间 · §10。中栏在第 7 步实现 */}
                  <button className="claude-node" disabled title="读写中栏在第 7 步实现">
                    <span className="mono">.claude</span>
                    <span className="hint">配置</span>
                  </button>

                  {sessions.length === 0 && (
                    <div className="hint session-empty">这个项目下还没有会话。</div>
                  )}

                  {visible.map((s) => (
                    <button
                      key={s.sessionId}
                      className="session-row"
                      aria-current={s.sessionId === activeSession}
                      onClick={() => onOpenSession(project.path, s.sessionId)}
                      title={s.title}
                    >
                      <span className="title">{s.title}</span>
                      <span className="meta">
                        {relativeTime(s.lastModified)}
                        {s.gitBranch ? ` · ${s.gitBranch}` : ''}
                      </span>
                    </button>
                  ))}

                  {!showAll && sessions.length > COLLAPSED_LIMIT && (
                    <button className="expand-all" onClick={() => onExpandAll(project.path)}>
                      展开全部 {sessions.length} 条
                    </button>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      <div className="sidebar-foot">
        {/*
          额度接口是实验性的,API Key / Bedrock / Vertex 会话拿到 available: false。
          拿不到就让整块消失 —— 不留空槽、不写「未知」,更不画一个可能不准的百分比。
        */}
        {usage?.available && (
          <div className="quota">
            <span className="label">额度</span>
            {usage.fiveHour !== null && (
              <span title={usage.fiveHourResetsAt ? `${usage.fiveHourResetsAt} 重置` : undefined}>
                5 小时 <span className="val">{Math.round(usage.fiveHour)}%</span>
              </span>
            )}
            {usage.sevenDay !== null && (
              <span title={usage.sevenDayResetsAt ? `${usage.sevenDayResetsAt} 重置` : undefined}>
                7 天 <span className="val">{Math.round(usage.sevenDay)}%</span>
              </span>
            )}
          </div>
        )}
        <button className="version-row" title="主题与关于(第 7 步实现)">
          <span>
            {versions?.app ?? '—'}
            {versions?.cli ? ` · CLI ${versions.cli}` : ''}
          </span>
          {usage && <span>本会话 ${usage.sessionCostUsd.toFixed(2)}</span>}
        </button>
      </div>
    </aside>
  )
}
