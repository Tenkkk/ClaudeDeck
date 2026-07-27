import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EFFORT_LEVELS,
  PERMISSION_MODES,
  type AppConfig,
  type ChatEvent,
  type DoctorReport,
  type EffortLevel,
  type HistoryMessage,
  type ModelOption,
  type PermissionMode,
  type SessionListItem,
} from '../../shared/ipc.js'

type Phase = 'loading' | 'onboarding' | 'workspace' | 'chat'

interface PendingPermission {
  requestId: string
  toolName: string
}

export default function App(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading')
  const [doctor, setDoctor] = useState<DoctorReport | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [activeSession, setActiveSession] = useState<string | null>(null)
  const [messages, setMessages] = useState<HistoryMessage[]>([])
  const [streaming, setStreaming] = useState('')
  const [busy, setBusy] = useState(false)
  const [models, setModels] = useState<ModelOption[]>([])
  const [permission, setPermission] = useState<PendingPermission | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const transcriptRef = useRef<HTMLDivElement>(null)

  // ---- bootstrap ----------------------------------------------------------
  const decidePhase = useCallback((report: DoctorReport, cfg: AppConfig) => {
    if (!report.cliFound) return setPhase('onboarding')
    if (!cfg.activeWorkspace) return setPhase('workspace')
    setPhase('chat')
  }, [])

  useEffect(() => {
    void (async () => {
      const [report, cfg] = await Promise.all([window.api.doctor.check(), window.api.config.get()])
      setDoctor(report)
      setConfig(cfg)
      decidePhase(report, cfg)
    })()
  }, [decidePhase])

  // ---- streaming events ---------------------------------------------------
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
      } else if (event.type === 'error') {
        setError(event.message)
        setBusy(false)
      }
    })
  }, [])

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight })
  }, [messages, streaming])

  const refreshSessions = useCallback(async () => {
    setSessions(await window.api.sessions.list())
  }, [])

  useEffect(() => {
    if (phase !== 'chat') return
    void refreshSessions()
    void window.api.chat.open().then(() => window.api.chat.models().then(setModels))
  }, [phase, refreshSessions])

  // ---- actions ------------------------------------------------------------
  async function pickWorkspace(): Promise<void> {
    const cfg = await window.api.workspace.pick()
    setConfig(cfg)
    if (cfg.activeWorkspace) setPhase('chat')
  }

  async function openSession(sessionId: string): Promise<void> {
    setActiveSession(sessionId)
    setStreaming('')
    setError(null)
    setMessages(await window.api.sessions.history(sessionId))
    await window.api.chat.open(sessionId)
    setModels(await window.api.chat.models())
  }

  async function newSession(): Promise<void> {
    setActiveSession(null)
    setMessages([])
    setStreaming('')
    setError(null)
    await window.api.chat.open()
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

  async function changeModel(model: string): Promise<void> {
    await window.api.chat.setModel(model)
    setConfig((c) => (c ? { ...c, model } : c))
  }

  async function changeEffort(effort: EffortLevel): Promise<void> {
    await window.api.chat.setEffort(effort)
    setConfig((c) => (c ? { ...c, effort } : c))
  }

  async function changeMode(permissionMode: PermissionMode): Promise<void> {
    await window.api.chat.setPermissionMode(permissionMode)
    setConfig((c) => (c ? { ...c, permissionMode } : c))
  }

  async function answerPermission(allow: boolean): Promise<void> {
    if (!permission) return
    await window.api.chat.respondPermission(permission.requestId, allow)
    setPermission(null)
  }

  // ---- screens ------------------------------------------------------------
  if (phase === 'loading') {
    return <div className="center">正在检查运行环境…</div>
  }

  if (phase === 'onboarding') {
    return (
      <Onboarding
        doctor={doctor}
        config={config}
        onDone={async () => {
          const [report, cfg] = await Promise.all([window.api.doctor.check(), window.api.config.get()])
          setDoctor(report)
          setConfig(cfg)
          decidePhase(report, cfg)
        }}
      />
    )
  }

  if (phase === 'workspace') {
    return (
      <div className="center">
        <div className="card">
          <h2>选择工作目录</h2>
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            Claude Code 的会话按目录归属。选定目录后,这里会列出该目录下的全部历史会话。
          </p>
          <button className="primary" onClick={pickWorkspace}>
            选择目录…
          </button>
          {config && config.workspaces.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>最近使用</div>
              {config.workspaces.map((dir) => (
                <button
                  key={dir}
                  className="session-item"
                  onClick={async () => {
                    setConfig(await window.api.workspace.use(dir))
                    setPhase('chat')
                  }}
                >
                  <span className="title">{dir}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <header>
          <button className="primary" style={{ width: '100%' }} onClick={newSession}>
            + 新建会话
          </button>
        </header>
        <div className="session-list">
          {sessions.length === 0 && (
            <p style={{ color: 'var(--muted)', padding: 10 }}>该目录下还没有会话。</p>
          )}
          {sessions.map((s) => (
            <button
              key={s.sessionId}
              className="session-item"
              aria-current={s.sessionId === activeSession}
              onClick={() => void openSession(s.sessionId)}
            >
              <span className="title">{s.title}</span>
              <span className="meta">{new Date(s.lastModified).toLocaleString('zh-CN')}</span>
            </button>
          ))}
        </div>
        <footer>
          <div>工作目录</div>
          {config?.activeWorkspace}
          <button style={{ marginTop: 8, width: '100%' }} onClick={() => setPhase('workspace')}>
            切换目录
          </button>
        </footer>
      </aside>

      <main className="main">
        <div className="toolbar">
          <label>
            模型
            <select
              value={config?.model ?? ''}
              onChange={(e) => void changeModel(e.target.value)}
              disabled={models.length === 0}
            >
              <option value="">默认</option>
              {models.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </label>

          <label>
            Effort
            <span className="effort">
              {EFFORT_LEVELS.map((level) => (
                <button
                  key={level}
                  aria-pressed={config?.effort === level}
                  onClick={() => void changeEffort(level)}
                >
                  {level}
                </button>
              ))}
            </span>
          </label>

          <label>
            权限
            <select
              value={config?.permissionMode ?? 'default'}
              onChange={(e) => void changeMode(e.target.value as PermissionMode)}
            >
              {PERMISSION_MODES.map((m) => (
                <option key={m.value} value={m.value} title={m.hint}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          {busy && (
            <button style={{ marginLeft: 'auto' }} onClick={() => void window.api.chat.interrupt()}>
              停止
            </button>
          )}
        </div>

        <div className="transcript" ref={transcriptRef}>
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <span className="who">{m.role === 'user' ? '你' : 'Claude'}</span>
              <div className="body">{m.text}</div>
            </div>
          ))}
          {streaming && (
            <div className="msg assistant">
              <span className="who">Claude</span>
              <div className="body">{streaming}</div>
            </div>
          )}
          {permission && (
            <div className="permission">
              <strong>Claude 请求使用工具:{permission.toolName}</strong>
              <div className="row">
                <button className="primary" onClick={() => void answerPermission(true)}>
                  允许
                </button>
                <button onClick={() => void answerPermission(false)}>拒绝</button>
              </div>
            </div>
          )}
          {error && <div className="error">{error}</div>}
        </div>

        <div className="composer">
          <textarea
            value={draft}
            placeholder="给 Claude Code 发消息…(Enter 发送,Shift+Enter 换行)"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <button className="primary" disabled={busy || !draft.trim()} onClick={() => void send()}>
            发送
          </button>
        </div>
      </main>
    </div>
  )
}

function Onboarding({
  doctor,
  config,
  onDone,
}: {
  doctor: DoctorReport | null
  config: AppConfig | null
  onDone: () => void | Promise<void>
}): React.JSX.Element {
  const [installing, setInstalling] = useState(false)
  const [log, setLog] = useState('')
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')

  return (
    <div className="center">
      <div className="card">
        <h2>ClaudeDeck 首次配置</h2>

        <section>
          <strong>1. Claude Code 命令行</strong>
          <p style={{ color: 'var(--muted)' }}>
            {doctor?.cliFound
              ? `已检测到:${doctor.cliVersion}`
              : '未检测到 claude 命令。ClaudeDeck 通过官方 Agent SDK 驱动 Claude Code,必须先安装它。'}
          </p>
          {!doctor?.cliFound && (
            <>
              <code>npm install -g @anthropic-ai/claude-code</code>
              <div className="row" style={{ marginTop: 8 }}>
                <button
                  className="primary"
                  disabled={installing}
                  onClick={async () => {
                    setInstalling(true)
                    const result = await window.api.doctor.install()
                    setLog(result.output)
                    setInstalling(false)
                    await onDone()
                  }}
                >
                  {installing ? '安装中…' : '一键安装'}
                </button>
              </div>
              {log && <pre style={{ maxHeight: 140, overflow: 'auto', fontSize: 12 }}>{log}</pre>}
            </>
          )}
        </section>

        <section>
          <strong>2. 凭据(可选)</strong>
          <p style={{ color: 'var(--muted)' }}>
            留空则沿用你在终端里已登录的 Claude Code 账号。填写后将覆盖,API Key 由系统凭据加密保存。
          </p>
          <div style={{ display: 'grid', gap: 8 }}>
            <input
              placeholder="ANTHROPIC_BASE_URL(如使用中转端点)"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <input
              type="password"
              placeholder="API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
        </section>

        <button
          className="primary"
          onClick={async () => {
            await window.api.config.update({ baseUrl })
            if (apiKey) await window.api.config.setApiKey(apiKey)
            await onDone()
          }}
        >
          保存并继续
        </button>
      </div>
    </div>
  )
}
