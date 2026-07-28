import { useState } from 'react'
import { CaretIcon, CheckIcon, FolderIcon, GearIcon, PlusIcon } from './Icons.js'
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
  onNewSession,
  onNewSessionIn,
  onOpenSession,
  onSessionMenu,
  onToggleCollapse,
  onExpandAll,
  onAddProject,
  onManageProjects,
  onOpenSettings,
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
  onNewSession: () => void
  onNewSessionIn: (projectPath: string) => void
  onOpenSession: (projectPath: string, sessionId: string) => void
  onSessionMenu: (session: SessionListItem, at: { x: number; y: number }) => void
  onToggleCollapse: (path: string, collapsed: boolean) => void
  onExpandAll: (path: string) => void
  onAddProject: () => void
  onManageProjects: () => void
  /** 主题、凭据、接管情况都进了设置对话框,这里只留一个入口 */
  onOpenSettings: () => void
  /** 中栏正在浏览哪个项目的文件,没有就是 null */
  filesProject: string | null
  onOpenFiles: (projectPath: string) => void
}): React.JSX.Element {
  const [themeOpen, setThemeOpen] = useState(false)
  return (
    <aside className="sidebar">
      {/* 侧栏的品牌位不带圆点 —— 那颗呼吸点是加载态与空态的元件(§02),
          不是常驻装饰。陶土只出现在三处:当前项、主按钮、等你决定的卡片。 */}
      {/*
        新建会话移到品牌行右端 —— 搜索挪去了标题栏,这个位置正好留给
        侧栏里最常用的动作。原先那一整行连同 Ctrl N 标注一并去掉:
        快捷键提示是给键盘用户的,而这里的形态是给鼠标看的。
      */}
      <div className="sidebar-brand">
        <span className="brand">ClaudeDeck</span>
        <button className="ghost icon-btn" title="新建会话" onClick={onNewSession}>
          <PlusIcon size={14} />
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
                  {/*
                    文件入口挂在项目名和会话之间。
                    原先这里是个只认 `.claude` 的节点,而且只有当前聚焦的项目才有 ——
                    「为什么别的项目看不到配置」正是这么来的。现在每个项目都有,
                    `.claude` 只是树里的一个普通文件夹。
                  */}
                  <button
                    className="claude-node"
                    aria-current={filesProject === project.path}
                    onClick={() => onOpenFiles(project.path)}
                    title={`浏览 ${project.name} 的文件`}
                  >
                    <span className="caret">
                      <CaretIcon />
                    </span>
                    <FolderIcon className="folder" />
                    <span className="label">文件</span>
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
        <div className="version-slot">
          <div className="version-row">
            <span>
              {versions?.app ?? '—'}
              {versions?.cli ? ` · CLI ${versions.cli}` : ''}
              {usage && ` · $${usage.sessionCostUsd.toFixed(2)}`}
            </span>
            <button
              className="icon-btn settings-btn"
              aria-label="设置"
              title="设置"
              onClick={onOpenSettings}
            >
              <GearIcon size={14} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}
