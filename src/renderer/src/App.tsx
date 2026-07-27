import { useCallback, useEffect, useRef, useState } from 'react'
import ControlBar from './components/ControlBar.js'
import { FolderIcon } from './components/Icons.js'
import Message from './components/Message.js'
import Sidebar from './components/Sidebar.js'
import ToolRow from './components/ToolRow.js'
import Loading from './screens/Loading.js'
import Onboarding from './screens/Onboarding.js'
import ProjectPicker from './screens/ProjectPicker.js'
import {
  type AppConfig,
  type ChatEvent,
  type ContextUsage,
  type DoctorReport,
  type EffortLevel,
  type ModelOption,
  type PermissionMode,
  type SessionListItem,
  type ToolRow as ToolRowData,
  type TranscriptItem,
  type UsageInfo,
  type Versions,
} from '../../shared/ipc.js'

type Phase = 'loading' | 'onboarding' | 'projects' | 'workspace'

interface PendingPermission {
  requestId: string
  toolName: string
  target?: string
}

/** 上下文过 80% 转警示色 —— 自动压缩唯一的预告 · §06 */
const CONTEXT_WARN_AT = 80

/**
 * §06:Claude 会反复写 TodoWrite,同一次会话里只保留一张卡、原地更新,
 * 否则十几张待办卡会把对话冲掉。去重放在组装这一层。
 */
function appendTool(items: TranscriptItem[], row: ToolRowData): TranscriptItem[] {
  const base =
    row.tool === 'todo'
      ? items.filter((i) => !(i.kind === 'tool' && i.row.tool === 'todo'))
      : items
  return [...base, { kind: 'tool', row }]
}

/** 结果回来时按 id 就地替换那一行,保持顺序。 */
function replaceTool(items: TranscriptItem[], row: ToolRowData): TranscriptItem[] {
  return items.map((i) => (i.kind === 'tool' && i.row.id === row.id ? { kind: 'tool', row } : i))
}

export default function App(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading')
  const [doctor, setDoctor] = useState<DoctorReport | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, SessionListItem[]>>({})
  const [expandedAll, setExpandedAll] = useState<Record<string, boolean>>({})
  const [activeSession, setActiveSession] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptItem[]>([])
  const [streaming, setStreaming] = useState('')
  const [busy, setBusy] = useState(false)
  const [models, setModels] = useState<ModelOption[]>([])
  const [usage, setUsage] = useState<UsageInfo | null>(null)
  const [context, setContext] = useState<ContextUsage | null>(null)
  const [versions, setVersions] = useState<Versions | null>(null)
  const [permission, setPermission] = useState<PendingPermission | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  /** 切 Effort 要关掉旧 query 再 resume,中间几百毫秒没有活着的 query · §08 */
  const [effortSwitching, setEffortSwitching] = useState(false)
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
      } else if (event.type === 'tool') {
        // 工具行插在正文之间,所以先把已经流出来的文字定下来
        setStreaming((s) => {
          if (s) setTranscript((t) => [...t, { kind: 'assistant', text: s, ts: Date.now() }])
          return ''
        })
        setTranscript((t) => appendTool(t, event.row))
      } else if (event.type === 'toolUpdate') {
        setTranscript((t) => replaceTool(t, event.row))
      } else if (event.type === 'permission') {
        setPermission({
          requestId: event.requestId,
          toolName: event.toolName,
          target: event.target,
        })
      } else if (event.type === 'done') {
        setStreaming((s) => {
          if (s) setTranscript((t) => [...t, { kind: 'assistant', text: s, ts: Date.now() }])
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
  }, [transcript, streaming])

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
    setTranscript(await window.api.sessions.history(sessionId))
    await window.api.chat.open(sessionId)
    setModels(await window.api.chat.models())
    await refreshMeters()
  }

  async function newSession(): Promise<void> {
    setActiveSession(null)
    setTranscript([])
    setStreaming('')
    setError(null)
    await window.api.chat.open()
    await refreshMeters()
  }

  async function send(): Promise<void> {
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    setTranscript((t) => [...t, { kind: 'user', text, ts: Date.now() }])
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
        onNewSessionIn={async (path) => {
          if (path !== config?.activeWorkspace) {
            setConfig(await window.api.projects.activate(path))
          }
          await newSession()
        }}
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
          <FolderIcon className="crumb-folder" />
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
          {transcript.length === 0 && !streaming && (
            <div className="empty-state">
              <span className="brand-dot breathing" />
              <div>问点什么开始。Claude Code 会在当前项目目录里读写文件。</div>
            </div>
          )}

          {transcript.map((item, i) =>
            item.kind === 'tool' ? (
              <ToolRow key={`${item.row.id}-${i}`} row={item.row} />
            ) : (
              <Message key={i} role={item.kind} text={item.text} ts={item.ts} />
            ),
          )}

          {streaming && (
            <div className="msg-wrap">
              {/* 正在输出的那条不出动作行 · §06 */}
              <div className="msg-claude">
                {streaming}
                <span className="stream-caret" />
              </div>
            </div>
          )}

          {/* §06 权限卡:行内、不弹窗 —— 弹窗会把上文遮住,而你要看的正是上文。
              陶土左条 = 在拦你(计划卡是沙绿左条 = 在等你满意)。 */}
          {permission && (
            <div className="permission-card">
              <div className="card-label">等待你决定</div>
              <div className="card-title">
                Claude 想使用 {permission.toolName}
                {permission.target && <strong className="card-target">{permission.target}</strong>}
              </div>
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
                <button
                  className="card-remember"
                  title="之后这个工具不再逐次询问,换会话即失效"
                  onClick={() => {
                    void window.api.chat.respondPermission(
                      permission.requestId,
                      true,
                      true,
                      permission.toolName,
                    )
                    setPermission(null)
                  }}
                >
                  本次会话内不再问 {permission.toolName}
                </button>
              </div>
            </div>
          )}

          {error && <div className="error-line">{error}</div>}
        </div>

        {/* §05:输入框与控件条是同一张卡,控件在卡内底部 */}
        <div className="composer-wrap">
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

            <ControlBar
              mode={mode}
              models={models}
              model={config?.model ?? 'default'}
              effort={config?.effort ?? 'medium'}
              busy={busy}
              effortSwitching={effortSwitching}
              canSend={Boolean(draft.trim())}
              onMode={(v) => {
                void window.api.chat.setPermissionMode(v)
                setConfig((c) => (c ? { ...c, permissionMode: v } : c))
              }}
              onModel={(v) => {
                void window.api.chat.setModel(v)
                setConfig((c) => (c ? { ...c, model: v } : c))
              }}
              onEffort={async (v) => {
                setConfig((c) => (c ? { ...c, effort: v } : c))
                setEffortSwitching(true)
                try {
                  await window.api.chat.setEffort(v)
                  setModels(await window.api.chat.models())
                } finally {
                  setEffortSwitching(false)
                }
              }}
              onSend={() => void send()}
              onStop={() => void window.api.chat.interrupt()}
            />
          </div>
        </div>

      </main>
    </div>
  )
}
