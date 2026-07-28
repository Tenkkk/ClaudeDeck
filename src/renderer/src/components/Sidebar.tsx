import { useState } from 'react'
import { CaretIcon, CheckIcon, FolderIcon, PlusIcon, SearchIcon } from './Icons.js'
import Popover from './Popover.js'
import { relativeTime } from '../lib/path.js'
import {
  THEME_OPTIONS,
  type Project,
  type SessionListItem,
  type ThemePref,
  type UsageInfo,
  type Versions,
} from '../../../shared/ipc.js'

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
  onNewSessionIn,
  onOpenSession,
  onSessionMenu,
  onToggleCollapse,
  onExpandAll,
  onAddProject,
  onManageProjects,
  theme,
  onTheme,
}: {
  projects: Project[]
  sessionsByProject: Record<string, SessionListItem[]>
  activeWorkspace: string | null
  activeSession: string | null
  usage: UsageInfo | null
  versions: Versions | null
  expandedAll: Record<string, boolean>
  onNewSession: () => void
  onNewSessionIn: (projectPath: string) => void
  onOpenSession: (projectPath: string, sessionId: string) => void
  onSessionMenu: (session: SessionListItem, at: { x: number; y: number }) => void
  onToggleCollapse: (path: string, collapsed: boolean) => void
  onExpandAll: (path: string) => void
  onAddProject: () => void
  onManageProjects: () => void
  theme: ThemePref
  onTheme: (t: ThemePref) => void
}): React.JSX.Element {
  const [themeOpen, setThemeOpen] = useState(false)
  return (
    <aside className="sidebar">
      {/* 侧栏的品牌位不带圆点 —— 那颗呼吸点是加载态与空态的元件(§02),
          不是常驻装饰。陶土只出现在三处:当前项、主按钮、等你决定的卡片。 */}
      <div className="sidebar-brand">
        <span className="brand">ClaudeDeck</span>
        {/* 跨会话搜索是终稿明确「没画」的一项(§09),这里先占位并说明 */}
        <button className="ghost icon-btn" title="搜索(尚未实现)" disabled>
          <SearchIcon />
        </button>
      </div>

      {/* 新建会话是一行安静的入口,不是主按钮 —— 它不属于陶土的那三处 */}
      <div className="sidebar-new">
        <button className="new-session" onClick={onNewSession}>
          <PlusIcon size={13} />
          <span className="label">新建会话</span>
          <kbd>Ctrl N</kbd>
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
              <div className="project-line">
                <button
                  className="project-row"
                  aria-expanded={open}
                  aria-current={project.path === activeWorkspace}
                  title={project.path}
                  onClick={() => onToggleCollapse(project.path, open)}
                >
                  <span className="caret">
                    <CaretIcon />
                  </span>
                  <FolderIcon className="folder" />
                  <span className="name">{project.name}</span>
                  <span className="count">{sessions.length}</span>
                </button>
                <button
                  className="ghost icon-btn project-add"
                  title={`在 ${project.name} 里新建会话`}
                  onClick={() => onNewSessionIn(project.path)}
                >
                  <PlusIcon />
                </button>
              </div>

              {open && (
                <>
                  {/* .claude 节点挂在项目名和会话之间 · §10。中栏在第 7 步实现 */}
                  <button className="claude-node" disabled title="读写中栏在第 7 步实现">
                    <span className="caret">
                      <CaretIcon />
                    </span>
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
                      onContextMenu={(e) => {
                        e.preventDefault()
                        onSessionMenu(s, { x: e.clientX, y: e.clientY })
                      }}
                      title={s.title}
                    >
                      <span className="title">
                        {s.title}
                        {s.tag && <span className="session-tag">{s.tag}</span>}
                      </span>
                      <span className="meta">
                        {relativeTime(s.lastModified)}
                        {/* 当前会话的分支名走陶土色,其他会话保持中性 */}
                        {s.gitBranch ? (
                          <>
                            {' · '}
                            <span className="branch">{s.gitBranch}</span>
                          </>
                        ) : null}
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
            <span className="values">
              {usage.fiveHour !== null && (
                <span title={usage.fiveHourResetsAt ? `${usage.fiveHourResetsAt} 重置` : undefined}>
                  5 小时 <span className="val">{Math.round(usage.fiveHour)}%</span>
                </span>
              )}
              {usage.fiveHour !== null && usage.sevenDay !== null && (
                <span className="divider" aria-hidden="true" />
              )}
              {usage.sevenDay !== null && (
                <span title={usage.sevenDayResetsAt ? `${usage.sevenDayResetsAt} 重置` : undefined}>
                  7 天 <span className="val">{Math.round(usage.sevenDay)}%</span>
                </span>
              )}
            </span>
          </div>
        )}
        {/* §16:主题开关挂在版本行上 —— 不为一个三选一再造一屏设置界面 */}
        <div className="version-slot">
          <button
            className="version-row"
            aria-expanded={themeOpen}
            title="主题与关于"
            onClick={() => setThemeOpen((v) => !v)}
          >
            <span>
              {versions?.app ?? '—'}
              {versions?.cli ? ` · CLI ${versions.cli}` : ''}
            </span>
            {usage && <span>本会话 ${usage.sessionCostUsd.toFixed(2)}</span>}
          </button>

          <Popover open={themeOpen} onClose={() => setThemeOpen(false)} width={200}>
            <div className="pop-group">主题</div>
            {THEME_OPTIONS.map((t) => (
              <button
                key={t.value}
                className={`pop-row${t.value === theme ? ' current' : ''}`}
                onClick={() => {
                  onTheme(t.value)
                  setThemeOpen(false)
                }}
              >
                <span className="pop-check">{t.value === theme ? <CheckIcon size={9} /> : ''}</span>
                <span className="pop-body">
                  <span className="pop-title">{t.label}</span>
                </span>
              </button>
            ))}
            <div className="ctx-sep" />
            <div className="about-row">
              ClaudeDeck {versions?.app ?? '—'}
              {versions?.cli ? ` · Claude Code ${versions.cli}` : ''}
            </div>
          </Popover>
        </div>
      </div>
    </aside>
  )
}
