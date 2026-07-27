import { useState } from 'react'
import { FAKE_FOOTER, FAKE_PROJECTS } from '../fake.js'
import { relativeTime } from '../lib/path.js'
import type { SessionListItem } from '../../../shared/ipc.js'

/**
 * 侧栏 —— 设计终稿 §05。项目 → 会话两层。
 *
 * 骨架阶段的混合状态:**当前项目挂真实会话**,其余项目来自 fake.ts,
 * 只为撑出两层结构。主进程的偏好里目前只有 workspaces: string[],
 * 没有项目名/折叠状态/每项目会话数,所以多项目并列必须等第 3 步。
 */
export default function Sidebar({
  activeWorkspace,
  sessions,
  activeSession,
  onNewSession,
  onOpenSession,
  onManageProjects,
}: {
  activeWorkspace: string | null
  sessions: SessionListItem[]
  activeSession: string | null
  onNewSession: () => void
  onOpenSession: (id: string) => void
  onManageProjects: () => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const [showAll, setShowAll] = useState(false)

  const activeName = activeWorkspace?.split(/[\\/]/).filter(Boolean).pop() ?? '未选择'
  const others = FAKE_PROJECTS.filter((p) => p.name !== activeName)
  const visible = showAll ? sessions : sessions.slice(0, 3)

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
          <span>项目 · {others.length + 1}</span>
          <span className="spacer" />
          <button className="ghost" title="管理项目" onClick={onManageProjects}>
            ···
          </button>
          <button className="ghost" title="添加项目" onClick={onManageProjects}>
            ＋
          </button>
        </div>

        {/* 当前项目 —— 真实会话 */}
        <button
          className="project-row"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          title={activeWorkspace ?? ''}
        >
          <span className="caret" />
          <span className="name">{activeName}</span>
          <span className="count">{sessions.length}</span>
        </button>

        {expanded && (
          <>
            {/* .claude 节点挂在项目名和会话之间 · §10。中栏在第 7 步实现 */}
            <button className="claude-node" disabled title="第 7 步实现">
              <span className="mono">.claude</span>
              <span className="hint">配置</span>
            </button>

            {sessions.length === 0 && (
              <div className="hint" style={{ padding: '8px 12px 8px 28px' }}>
                这个项目下还没有会话。
              </div>
            )}

            {visible.map((s) => (
              <button
                key={s.sessionId}
                className="session-row"
                aria-current={s.sessionId === activeSession}
                onClick={() => onOpenSession(s.sessionId)}
                title={s.title}
              >
                <span className="title">{s.title}</span>
                <span className="meta">
                  {relativeTime(s.lastModified)}
                  {s.gitBranch ? ` · ${s.gitBranch}` : ''}
                </span>
              </button>
            ))}

            {!showAll && sessions.length > 3 && (
              <button className="expand-all" onClick={() => setShowAll(true)}>
                展开全部 {sessions.length} 条
              </button>
            )}
          </>
        )}

        {/* 其余项目 —— 假数据,只为撑出两层结构 */}
        {others.map((p) => (
          <button
            key={p.id}
            className="project-row"
            aria-expanded={false}
            disabled
            title={`${p.path}(第 3 步接真实数据)`}
          >
            <span className="caret" />
            <span className="name">{p.name}</span>
            <span className="count">{p.count}</span>
          </button>
        ))}
      </div>

      <div className="sidebar-foot">
        {/* 额度接口是实验性的,拿不到就让整块消失(坑 4.1)。骨架阶段先用假数据 */}
        <div className="quota">
          <span className="label">额度</span>
          <span>
            5 小时 <span className="val">{FAKE_FOOTER.rateLimits.fiveHour}%</span>
          </span>
          <span>
            7 天 <span className="val">{FAKE_FOOTER.rateLimits.sevenDay}%</span>
          </span>
        </div>
        <button className="version-row" title="主题与关于(第 7 步实现)">
          <span>
            {FAKE_FOOTER.appVersion} · CLI {FAKE_FOOTER.cliVersion}
          </span>
          <span>本会话 {FAKE_FOOTER.sessionCost}</span>
        </button>
      </div>
    </aside>
  )
}
