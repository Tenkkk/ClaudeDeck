import { useCallback, useEffect, useRef, useState } from 'react'
import Sidebar from './components/Sidebar.js'
import Loading from './screens/Loading.js'
import Onboarding from './screens/Onboarding.js'
import ProjectPicker from './screens/ProjectPicker.js'
import {
  EFFORT_LEVELS,
  PERMISSION_MODES,
  type AppConfig,
  type ChatEvent,
  type ContextUsage,
  type DoctorReport,
  type EffortLevel,
  type HistoryMessage,
  type ModelOption,
  type PermissionMode,
  type SessionListItem,
  type UsageInfo,
  type Versions,
} from '../../shared/ipc.js'

type Phase = 'loading' | 'onboarding' | 'projects' | 'workspace'

interface PendingPermission {
  requestId: string
  toolName: string
}

/** 上下文过 80% 转警示色 —— 自动压缩唯一的预告 · §06 */
const CONTEXT_WARN_AT = 80

export default function App(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading')
  const [doctor, setDoctor] = useState<DoctorReport | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, SessionListItem[]>>({})
  const [expandedAll, setExpandedAll] = useState<Record<string, boolean>>({})
  const [activeSession, setActiveSession] = useState<string | null>(null)
  const [messages, setMessages] = useState<HistoryMessage[]>([])
  const [streaming, setStreaming] = useState('')
  const [busy, setBusy] = useState(false)
  const [models, setModels] = useState<ModelOption[]>([])
  const [usage, setUsage] = useState<UsageInfo | null>(null)
  const [context, setContext] = useState<ContextUsage | null>(null)
  const [versions, setVersions] = useState<Versions | null>(null)
  const [permission, setPermission] = useState<PendingPermission | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const transcriptRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  const refreshSessions = useCallback(async () => {
    setSessionsByProject(await window.api.sessions.byProject())
  }, [])

  /** 额度与上下文都随对话变化,每轮结束刷新一次。 */
  const refreshMeters = useCallback(async () => {
    const [u, c] = await Promise.all([window.api.chat.usage(), window.api.chat.context()])
    setUsage(u)
    setContext(c)
  }, [])

  const decidePhase = useCallback((report: DoctorReport, cfg: AppConfig) => {
    if (!report.cliFound) return setPhase('onboarding')
    if (!cfg.activeWorkspace) return setPhase('projects')
    setPhase('workspace')
  }, [])

  const reload = useCallback(async () => {
    const [report, cfg] = await Promise.all([window.api.doctor.check(), window.api.config.get()])
    setDoctor(report)
    setConfig(cfg)
    decidePhase(report, cfg)
  }, [decidePhase])

  useEffect(() => {
    void reload()
    void window.api.app.versions().then(setVersions)
  }, [reload])

  useEffect(() => {
    return window.api.chat.onEvent((event: ChatEvent) => {
      if (event.type === 'session') {
        setActiveSession(event.sessionId)
      } else if (event.type === 'delta') {
        setStreaming((s) => s + event.text)
      } else if (event.type === 'permission') {
        setPermission({ requestId: event.requestId, toolName: event.toolName })
      } else if (event.type === 'done') {
        setStreaming((s) => {
          if (s) setMessages((m) => [...m, { role: 'assistant', text: s }])
          return ''
        })
        setBusy(false)
        void refreshSessions()
        void refreshMeters()
      } else if (event.type === 'error') {
        setError(event.message)
        setBusy(false)
      }
    })
  }, [refreshSessions, refreshMeters])

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight })
  }, [messages, streaming])

  useEffect(() => {
    if (phase !== 'workspace') return
    void refreshSessions()
    void window.api.chat.open().then(async () => {
      setModels(await window.api.chat.models())
      await refreshMeters()
    })
  }, [phase, refreshSessions, refreshMeters])

  // 输入框自动增高,到 --h-composer-max 封顶后内部滚动 · §07
  useEffect(() => {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [draft])

  /** 点别的项目里的会话 = 隐式切换 activeWorkspace 再 resume · §2.1 */
  async function openSession(projectPath: string, sessionId: string): Promise<void> {
    setStreaming('')
    setError(null)
    if (projectPath !== config?.activeWorkspace) {
      setConfig(await window.api.projects.activate(projectPath))
    }
    setActiveSession(sessionId)
    setMessages(await window.api.sessions.history(sessionId))
    await window.api.chat.open(sessionId)
    setModels(await window.api.chat.models())
    await refreshMeters()
  }

  async function newSession(): Promise<void> {
    setActiveSession(null)
    setMessages([])
    setStreaming('')
    setError(null)
    await window.api.chat.open()
    await refreshMeters()
  }

  async function send(): Promise<void> {
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    setMessages((m) => [...m, { role: 'user', text }])
    setBusy(true)
    setError(null)
    await window.api.chat.send(text)
  }

  if (phase === 'loading') return <Loading />

  if (phase === 'onboarding') {
    return <Onboarding doctor={doctor} config={config} onDone={reload} />
  }

  if (phase === 'projects') {
    return (
      <ProjectPicker
        config={config}
        onAdd={async () => {
          const cfg = await window.api.projects.add()
          setConfig(cfg)
          if (cfg.activeWorkspace) setPhase('workspace')
        }}
        onUse={async (path) => {
          setConfig(await window.api.projects.activate(path))
          setPhase('workspace')
        }}
        onRemove={async (path) => setConfig(await window.api.projects.remove(path))}
      />
    )
  }

  const mode = config?.permissionMode ?? 'default'
  const modeLabel = PERMISSION_MODES.find((m) => m.value === mode)
  const modelLabel = models.find((m) => m.value === (config?.model ?? 'default'))
  const activeProject = config?.projects.find((p) => p.path === config.activeWorkspace)
  const activeSessions = config?.activeWorkspace
    ? (sessionsByProject[config.activeWorkspace] ?? [])
    : []
  const contextWarn = (context?.percentage ?? 0) >= CONTEXT_WARN_AT

  return (
    <div className="shell">
      <Sidebar
        projects={config?.projects ?? []}
        sessionsByProject={sessionsByProject}
        activeWorkspace={config?.activeWorkspace ?? null}
        activeSession={activeSession}
        usage={usage}
        versions={versions}
        expandedAll={expandedAll}
        onNewSession={() => void newSession()}
        onOpenSession={(p, id) => void openSession(p, id)}
        onToggleCollapse={async (path, collapsed) => {
          setConfig(await window.api.projects.collapse(path, collapsed))
        }}
        onExpandAll={(path) => setExpandedAll((e) => ({ ...e, [path]: true }))}
        onAddProject={async () => {
          const cfg = await window.api.projects.add()
          setConfig(cfg)
          await refreshSessions()
        }}
        onManageProjects={() => setPhase('projects')}
      />

      <main className="main">
        {/* 归属行 · §05:项目 / 会话标题 / 上下文百分比 */}
        <div className="crumb">
          <span className="project">{activeProject?.name ?? '—'}</span>
          <span className="sep">/</span>
          <span className="title">
            {activeSessions.find((s) => s.sessionId === activeSession)?.title ?? '新会话'}
          </span>
          {context && (
            <span className={`context${contextWarn ? ' warn' : ''}`}>
              上下文 {Math.round(context.percentage)}%
            </span>
          )}
        </div>

        <div className="transcript" ref={transcriptRef}>
          {messages.length === 0 && !streaming && (
            <div className="empty-state">
              <span className="brand-dot breathing" />
              <div>问点什么开始。Claude Code 会在当前项目目录里读写文件。</div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`msg-wrap${m.role === 'user' ? ' user' : ''}`}>
              <div className={m.role === 'user' ? 'msg-user' : 'msg-claude'}>{m.text}</div>
              {/* 常留 20px 空槽,悬停出动作行时内容不跳动 · §06 */}
              <div className="msg-slot">
                <span>复制</span>
                <span>{m.role === 'user' ? '编辑并重发 ↳' : '从这里重答 ↳'}</span>
              </div>
            </div>
          ))}

          {streaming && (
            <div className="msg-wrap">
              {/* 正在输出的那条不出动作行 · §06 */}
              <div className="msg-claude">
                {streaming}
                <span className="caret" />
              </div>
            </div>
          )}

          {permission && (
            <div className="permission-card">
              <strong>Claude 想使用工具:{permission.toolName}</strong>
              <div className="hint">在你点下之前,对话停在这里。</div>
              <div className="row">
                <button
                  className="primary"
                  onClick={() => {
                    void window.api.chat.respondPermission(permission.requestId, true)
                    setPermission(null)
                  }}
                >
                  允许
                </button>
                <button
                  onClick={() => {
                    void window.api.chat.respondPermission(permission.requestId, false)
                    setPermission(null)
                  }}
                >
                  拒绝
                </button>
              </div>
            </div>
          )}

          {error && <div className="error-line">{error}</div>}
        </div>

        <div className="composer">
          <textarea
            ref={composerRef}
            value={draft}
            placeholder="给 Claude Code 发消息…(Enter 发送,Shift+Enter 换行,/ 唤出命令)"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />

          {/* 控件条 · §05:左权限,右模型、努力、发送。
              三个弹层在第 5 步实现,骨架阶段先用原生 select 保住功能。 */}
          <div className="controls">
            <label className="chip" title={modeLabel?.hint}>
              <select
                data-control="permission"
                value={mode}
                onChange={(e) => {
                  const v = e.target.value as PermissionMode
                  void window.api.chat.setPermissionMode(v)
                  setConfig((c) => (c ? { ...c, permissionMode: v } : c))
                }}
              >
                {PERMISSION_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="right">
              <label className="chip model-label" title={modelLabel?.displayName}>
                <select
                  data-control="model"
                  value={config?.model ?? 'default'}
                  disabled={models.length === 0}
                  onChange={(e) => {
                    const v = e.target.value
                    void window.api.chat.setModel(v)
                    setConfig((c) => (c ? { ...c, model: v } : c))
                  }}
                >
                  {models.length === 0 && <option value="default">加载中…</option>}
                  {models.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="chip" title="努力程度:越往右想得越久、也越贵">
                <select
                  data-control="effort"
                  value={config?.effort ?? 'medium'}
                  onChange={(e) => {
                    const v = e.target.value as EffortLevel
                    void window.api.chat.setEffort(v)
                    setConfig((c) => (c ? { ...c, effort: v } : c))
                  }}
                >
                  {EFFORT_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>

              {/* 输出中「发送」整颗变「停止」,不另设按钮 · §05。
                  data-state 是这两态唯一可靠的区分点 —— 二者共用同一个位置,
                  只看类名或文本都容易在自动化里点错。 */}
              {busy ? (
                <button
                  className="send"
                  data-state="stop"
                  onClick={() => void window.api.chat.interrupt()}
                >
                  停止
                </button>
              ) : (
                <button
                  className="primary send"
                  data-state="send"
                  disabled={!draft.trim()}
                  onClick={() => void send()}
                >
                  发送
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
