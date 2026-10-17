import { useState } from 'react'
import { AppearanceIcon, CaretIcon, CheckIcon, FolderIcon, PencilIcon, PlusIcon } from './Icons.js'
import Popover from './Popover.js'
import { relativeTime } from '../lib/path.js'
import {
  THEME_OPTIONS,
  type Project,
  type SessionListItem,
  type ThemePref,
  type AccountInfo,
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
  account,
  versions,
  expandedAll,
  onNewSessionIn,
  onOpenSession,
  onSessionMenu,
  onProjectMenu,
  onToggleCollapse,
  onExpandAll,
  onAddProject,
  theme,
  onTheme,
  filesProject,
  onOpenFiles,
}: {
  projects: Project[]
  sessionsByProject: Record<string, SessionListItem[]>
  activeWorkspace: string | null
  activeSession: string | null
  usage: UsageInfo | null
  account: AccountInfo | null
  versions: Versions | null
  expandedAll: Record<string, boolean>
  onNewSessionIn: (projectPath: string) => void
  onOpenSession: (projectPath: string, sessionId: string) => void
  onSessionMenu: (session: SessionListItem, at: { x: number; y: number }) => void
  onProjectMenu: (project: Project, at: { x: number; y: number }, trigger: HTMLButtonElement) => void
  onToggleCollapse: (path: string, collapsed: boolean) => void
  onExpandAll: (path: string) => void
  onAddProject: () => void
  theme: ThemePref
  onTheme: (t: ThemePref) => void
  /** 中栏正在浏览哪个项目的文件,没有就是 null */
  filesProject: string | null
  onOpenFiles: (projectPath: string) => void
}): React.JSX.Element {
  const [themeOpen, setThemeOpen] = useState(false)
  return (
    <aside className="sidebar">
      {/* 品牌位不带呼吸点或重复的新建入口;新建会话属于各项目行。 */}
      <div className="sidebar-brand">
        <span className="brand">ClaudeDeck</span>
      </div>

      <div className="sidebar-scroll">
        <div className="group-head">
          <span>项目 · {projects.length}</span>
          <span className="spacer" />
          <button className="ghost icon-btn sidebar-action project-create-action" aria-label="添加项目" title="添加项目" onClick={onAddProject}>
            <PlusIcon size={18} />
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
                  aria-haspopup="menu"
                  title={project.path}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    onProjectMenu(project, { x: e.clientX, y: e.clientY }, e.currentTarget)
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return
                    e.preventDefault()
                    const rect = e.currentTarget.getBoundingClientRect()
                    onProjectMenu(project, { x: rect.left, y: rect.bottom }, e.currentTarget)
                  }}
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
                  className="ghost icon-btn sidebar-action project-files"
                  aria-label={`浏览 ${project.name} 的文件`}
                  aria-pressed={filesProject === project.path}
                  title={`浏览 ${project.name} 的文件`}
                  onClick={() => onOpenFiles(project.path)}
                >
                  <FolderIcon size={18} />
                </button>
                <button
                  className="ghost icon-btn sidebar-action project-add"
                  aria-label={`在 ${project.name} 里新建会话`}
                  title={`在 ${project.name} 里新建会话`}
                  onClick={() => onNewSessionIn(project.path)}
                >
                  <PencilIcon />
                </button>
              </div>

              {open && (
                <>
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

                  {/* 展开之后要能收回去 —— 只给单程票,列表长了就再也回不到
                      「只看最近几条」的状态,只能把整个项目折叠掉 */}
                  {sessions.length > COLLAPSED_LIMIT && (
                    <button className="expand-all" onClick={() => onExpandAll(project.path)}>
                      {showAll ? `收起,只看最近 ${COLLAPSED_LIMIT} 条` : `展开全部 ${sessions.length} 条`}
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
        {/*
          §16:设置就一个三选一加一行版本号,不值得单开一屏。入口从版本文字
          换成齿轮 —— 齿轮一眼就是「设置」,而一串版本号不是,原先那行整条可点
          却没有任何东西在说它可点。花费挪进浮窗,信息不丢。
        */}
        {/* 这颗管的是外观与账号 —— 「怎么连上 Claude Code」在标题栏的齿轮里 */}
        <div className="version-slot">
          <div className="version-row">
            <span>
              {versions?.app ?? '—'}
              {versions?.cli ? ` · CLI ${versions.cli}` : ''}
              {usage && ` · $${usage.sessionCostUsd.toFixed(2)}`}
            </span>
            <button
              className="icon-btn settings-btn"
              aria-expanded={themeOpen}
              aria-label="外观与账号"
              title="外观与账号"
              onClick={() => setThemeOpen((v) => !v)}
            >
              <AppearanceIcon size={14} />
            </button>
          </div>

          <Popover open={themeOpen} onClose={() => setThemeOpen(false)} align="right" width={210}>
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

            {/* 三方 provider 下多数字段是空的,那就少画几行,不写「未知」 */}
            {account && (account.email || account.organization || account.subscriptionType) && (
              <>
                <div className="ctx-sep" />
                <div className="pop-group">账号</div>
                {account.email && <div className="about-row">{account.email}</div>}
                {account.organization && <div className="about-row">{account.organization}</div>}
                {account.subscriptionType && (
                  <div className="about-row">{account.subscriptionType}</div>
                )}
              </>
            )}

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
