import { useCallback, useEffect, useRef, useState } from 'react'
import AskCard from './components/AskCard.js'
import CommandPalette, { flatten } from './components/CommandPalette.js'
import ControlBar from './components/ControlBar.js'
import ElicitationCard from './components/ElicitationCard.js'
import ForkDialog from './components/ForkDialog.js'
import { FolderIcon } from './components/Icons.js'
import Message from './components/Message.js'
import MidColumn from './components/MidColumn.js'
import PlanCard from './components/PlanCard.js'
import SessionMenu from './components/SessionMenu.js'
import Sidebar from './components/Sidebar.js'
import Resizer from './components/Resizer.js'
import { clampMidcol, clampSidebar, loadWidths, saveWidths } from './lib/columns.js'
import Thinking from './components/Thinking.js'
import ToolRow from './components/ToolRow.js'
import Loading from './screens/Loading.js'
import Onboarding from './screens/Onboarding.js'
import ProjectPicker from './screens/ProjectPicker.js'
import {
  type AppConfig,
  type ChatEvent,
  type ContextUsage,
  type DoctorReport,
  type AskCard as AskCardData,
  type BackgroundTask,
  type ClaudeEntry,
  type ElicitationCard as ElicitationCardData,
  type PlanCard as PlanCardData,
  type EffortLevel,
  type ModelOption,
  type PermissionMode,
  type SessionListItem,
  type SlashCommandItem,
  type ToolRow as ToolRowData,
  type TranscriptItem,
  type TurnStatus,
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
 * 由界面自己处理的斜杠命令。
 *
 * 这些在终端里也不是发给 agent 的,是 CLI 界面层拦下来自己弹选择器。
 * SDK 的 supportedCommands() 会把它们列出来,但把它们当消息发过去不会有
 * 任何反应 —— 所以这里必须拦一道,否则就是发出去一条石沉大海的消息。
 */
const UI_COMMANDS: Record<string, 'model' | 'effort'> = {
  '/model': 'model',
  '/effort': 'effort',
}

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
  const [elicitation, setElicitation] = useState<ElicitationCardData | null>(null)
  const [unknownDialog, setUnknownDialog] = useState<string | null>(null)
  const [ask, setAsk] = useState<AskCardData | null>(null)
  const [plan, setPlan] = useState<PlanCardData | null>(null)
  const [menu, setMenu] = useState<{
    session: SessionListItem
    at: { x: number; y: number }
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  /** 切 Effort 要关掉旧 query 再 resume,中间几百毫秒没有活着的 query · §08 */
  const [effortSwitching, setEffortSwitching] = useState(false)
  const [commands, setCommands] = useState<SlashCommandItem[]>([])
  const [paletteIndex, setPaletteIndex] = useState(0)
  const [controlRequest, setControlRequest] = useState<'model' | 'effort' | null>(null)
  const [widths, setWidths] = useState(loadWidths)
  const [turnStartedAt, setTurnStartedAt] = useState(0)
  const [turnStatus, setTurnStatus] = useState<TurnStatus>(null)
  const [outputTokens, setOutputTokens] = useState(0)
  /** .claude 配置栏 · §10 */
  const [claudeOpen, setClaudeOpen] = useState(false)
  const [claudeEntries, setClaudeEntries] = useState<ClaudeEntry[]>([])
  const [openFile, setOpenFile] = useState<{ project: string; path: string } | null>(null)
  const [fileDirty, setFileDirty] = useState(false)
  const [tasks, setTasks] = useState<BackgroundTask[]>([])
  const [forkFrom, setForkFrom] = useState<string | null>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  const activeSessionRef = useRef<string | null>(null)

  /**
   * 每轮结束后把消息 id 补进 transcript —— 分支和文件回退都要它,
   * 而直播流里的用户消息不带 uuid,只有 store 里有(§12)。
   *
   * 注意这里**只合并 id,不替换整条 transcript**:SessionMessage 里没有
   * tool_use_result,拿历史整个覆盖会把直播已经收到的 Bash 输出、Edit diff
   * 全抹掉 —— 表现为「一轮结束,工具行的展开按钮就没了」。
   */
  const mergeMessageIds = useCallback(async () => {
    const sid = activeSessionRef.current
    if (!sid) return
    const stored = await window.api.sessions.history(sid)
    const ids = stored.flatMap((i) => (i.kind === 'tool' ? [] : [i.id]))
    setTranscript((cur) => {
      let n = -1
      return cur.map((item) => {
        if (item.kind === 'tool') return item
        n += 1
        const id = ids[n]
        return id && !item.id ? { ...item, id } : item
      })
    })
  }, [])

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
        activeSessionRef.current = event.sessionId
        // 一发出去侧栏就该多出这条,而不是等这一轮答完。session_id 在本轮
        // 第一条消息上就有了,这时 SDK 的 store 里已经落了盘,列得出来。
        // 标题是 Claude 生成的,会晚一点变 —— done 时再刷一次盖上去。
        void refreshSessions()
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
      } else if (event.type === 'elicitation') {
        setElicitation(event.card)
      } else if (event.type === 'ask') {
        setAsk(event.card)
      } else if (event.type === 'plan') {
        setPlan(event.card)
      } else if (event.type === 'tasks') {
        setTasks(event.tasks)
      } else if (event.type === 'status') {
        setTurnStatus(event.status)
      } else if (event.type === 'progress') {
        setOutputTokens(event.outputTokens)
      } else if (event.type === 'unknownDialog') {
        setUnknownDialog(event.notice.dialogKind)
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
        // 只把消息 id 合并进来,不替换 transcript —— 见 mergeMessageIds
        void mergeMessageIds()
      } else if (event.type === 'error') {
        setError(event.message)
        setBusy(false)
      }
    })
  }, [refreshSessions, refreshMeters, mergeMessageIds])

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight })
  }, [transcript, streaming])

  useEffect(() => {
    if (phase !== 'workspace') return
    void refreshSessions()
    void window.api.chat.open().then(async () => {
      setModels(await window.api.chat.models())
      setCommands(await window.api.chat.commands())
      await refreshMeters()
    })
  }, [phase, refreshSessions, refreshMeters])

  /**
   * 主题 · §16。把「跟随系统 / 始终亮色 / 始终深色」解析成一个确定的值写到
   * 根元素上,CSS 那边就只需要 :root[data-theme='dark'] 一个选择器,
   * 不用再写一遍 prefers-color-scheme,也就不会两处走岔。
   */
  useEffect(() => {
    const pref = config?.theme ?? 'system'
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = pref === 'dark' || (pref === 'system' && media.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    if (pref !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [config?.theme])

  // 输入框自动增高,到 --h-composer-max 封顶后内部滚动 · §07
  useEffect(() => {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [draft])

  // 换了项目就收起 .claude 树(它列的是上一个项目的内容)。
  //
  // 开着的文件**只在没有未保存改动时**才自动关 —— 有改动就留着,
  // 它记着自己属于哪个项目、保存也走那个项目,所以留着是安全的;
  // 头部的项目名会告诉用户这份文件不属于当前项目。
  //
  // fileDirty 必须走 ref 读:放进依赖数组的话,保存让它从 true 变 false
  // 会把这个 effect 再触发一次,于是「一保存文件就自己关了」。
  const dirtyRef = useRef(false)
  dirtyRef.current = fileDirty
  const prevProject = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const project = config?.activeWorkspace ?? null
    if (prevProject.current === undefined) {
      prevProject.current = project
      return
    }
    if (prevProject.current === project) return
    prevProject.current = project
    setClaudeOpen(false)
    setClaudeEntries([])
    if (!dirtyRef.current) setOpenFile(null)
  }, [config?.activeWorkspace])

  /** 点别的项目里的会话 = 隐式切换 activeWorkspace 再 resume · §2.1 */
  async function openSession(projectPath: string, sessionId: string): Promise<void> {
    setStreaming('')
    setError(null)
    if (projectPath !== config?.activeWorkspace) {
      setConfig(await window.api.projects.activate(projectPath))
    }
    setActiveSession(sessionId)
    activeSessionRef.current = sessionId
    setTranscript(await window.api.sessions.history(sessionId))
    await window.api.chat.open(sessionId)
    setModels(await window.api.chat.models())
    await refreshMeters()
  }

  async function newSession(): Promise<void> {
    setActiveSession(null)
    activeSessionRef.current = null
    setTranscript([])
    setStreaming('')
    setError(null)
    await window.api.chat.open()
    await refreshMeters()
  }

  async function send(): Promise<void> {
    const text = draft.trim()
    if (!text || busy) return

    // 这几条是界面自己的命令,不是给 agent 的。终端里 /model 由 CLI 的界面层
    // 处理,发给 agent 只会石沉大海 —— 命令面板拦得住敲回车,拦不住点「发送」。
    // 认出来就直接把对应的浮层点开,和终端里敲 /model 得到的结果一致。
    const ui = UI_COMMANDS[text.toLowerCase()]
    if (ui) {
      setDraft('')
      setControlRequest(ui)
      return
    }

    setDraft('')
    setTranscript((t) => [...t, { kind: 'user', text, ts: Date.now() }])
    setBusy(true)
    setError(null)
    // 等待态的计时与计数按轮清零
    setTurnStartedAt(Date.now())
    setTurnStatus(null)
    setOutputTokens(0)
    await window.api.chat.send(text)
  }

  // §15:只在行首第一个字符是 / 时才弹
  const paletteOpen = draft.startsWith('/') && !draft.includes(' ') && commands.length > 0
  const paletteFilter = paletteOpen ? draft.slice(1) : ''
  const paletteRows = paletteOpen ? flatten(commands, paletteFilter) : []

  function pickCommand(c: SlashCommandItem): void {
    setDraft(`/${c.name}${c.argumentHint ? ' ' : ''}`)
    setPaletteIndex(0)
    composerRef.current?.focus()
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

  // 窗口左边缘就是 shell 的左边缘(没有更外层的容器),所以 clientX 直接
  // 就是侧栏宽度;中栏那道线要先减掉侧栏。
  function resizeSidebar(px: number): void {
    const next = clampSidebar(px, {
      viewport: window.innerWidth,
      midcol: widths.midcol,
      midOpen: openFile !== null,
    })
    const w = { ...widths, sidebar: next }
    setWidths(w)
    saveWidths(w)
  }

  function resizeMidcol(px: number): void {
    const next = clampMidcol(px, { viewport: window.innerWidth, sidebar: widths.sidebar })
    const w = { ...widths, midcol: next }
    setWidths(w)
    saveWidths(w)
  }

  return (
    <div
      className={`shell${openFile ? ' with-mid' : ''}`}
      // 覆盖 styles.css 里的默认值。写在这一层而不是每栏各写各的,
      // 是因为中栏关着时布局也要跟着变,统一由 grid 的模板表达。
      style={
        {
          '--w-sidebar': `${widths.sidebar}px`,
          '--w-midcol': `${widths.midcol}px`,
        } as React.CSSProperties
      }
    >
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
        onSessionMenu={(session, at) => setMenu({ session, at })}
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
        claudeEntries={claudeEntries}
        openFile={openFile?.path ?? null}
        claudeOpen={claudeOpen}
        onToggleClaude={async () => {
          const next = !claudeOpen
          setClaudeOpen(next)
          if (next) setClaudeEntries(await window.api.claude.list())
        }}
        onOpenFile={(relPath) =>
          config?.activeWorkspace && setOpenFile({ project: config.activeWorkspace, path: relPath })
        }
        theme={config?.theme ?? 'system'}
        onTheme={async (t) => setConfig(await window.api.config.update({ theme: t }))}
      />

      {/* 两道竖线都能拖 · 夹逼规则见 lib/columns */}
      <Resizer
        className="resizer-sidebar"
        label="调整侧栏宽度"
        onDrag={(x) => resizeSidebar(x)}
        onNudge={(d) => resizeSidebar(widths.sidebar + d)}
      />
      {openFile && (
        <Resizer
          className="resizer-midcol"
          label="调整配置栏宽度"
          onDrag={(x) => resizeMidcol(x - widths.sidebar)}
          onNudge={(d) => resizeMidcol(widths.midcol + d)}
        />
      )}

      {openFile && (
        <MidColumn
          projectPath={openFile.project}
          projectName={
            config?.projects.find((p) => p.path === openFile.project)?.name ?? openFile.project
          }
          relPath={openFile.path}
          onClose={() => setOpenFile(null)}
          onDirtyChange={setFileDirty}
        />
      )}

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
              <Message
                key={i}
                role={item.kind}
                text={item.text}
                ts={item.ts}
                id={item.id}
                onFork={setForkFrom}
              />
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

          {/* 忙着但还没开口的那段空白 —— 至少要能看出它还活着 */}
          {busy && (
            <Thinking
              since={turnStartedAt}
              status={turnStatus}
              outputTokens={outputTokens}
              streaming={streaming.length > 0}
            />
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

          {elicitation && (
            <ElicitationCard
              card={elicitation}
              onSubmit={(values) => {
                void window.api.chat.respondElicitation(elicitation.id, values)
                setElicitation(null)
              }}
              onCancel={() => {
                void window.api.chat.respondElicitation(elicitation.id, null)
                setElicitation(null)
              }}
            />
          )}

          {ask && (
            <AskCard
              card={ask}
              onSubmit={(answer) => {
                void window.api.chat.respondAsk(ask.id, answer)
                setAsk(null)
              }}
              onCancel={() => {
                void window.api.chat.respondAsk(ask.id, null)
                setAsk(null)
              }}
            />
          )}

          {plan && (
            <PlanCard
              card={plan}
              onAccept={() => {
                void window.api.chat.respondPlan(plan.id, true)
                setPlan(null)
              }}
              onDiscuss={() => {
                void window.api.chat.respondPlan(plan.id, false)
                setPlan(null)
              }}
            />
          )}

          {/* §06 兜底:收到这个版本还不会画的 dialogKind,已回 cancelled */}
          {unknownDialog && (
            <div className="notice" onClick={() => setUnknownDialog(null)}>
              <span className="notice-icon">⊙</span>
              <span>
                Claude Code 请求了一个这个版本还不会画的选择框,已按它的默认处理继续。
                <code className="notice-kind">dialogKind: {unknownDialog}</code>
              </span>
            </div>
          )}

          {forkFrom && activeSession && (
            <ForkDialog
              messageId={forkFrom}
              onCancel={() => setForkFrom(null)}
              onConfirm={async (rewind) => {
                const title = `${
                  activeSessions.find((s) => s.sessionId === activeSession)?.title ?? '会话'
                } 分支`
                const newId = await window.api.sessions.forkFrom(
                  activeSession,
                  forkFrom,
                  rewind,
                  title,
                )
                setForkFrom(null)
                await refreshSessions()
                if (config?.activeWorkspace) await openSession(config.activeWorkspace, newId)
              }}
            />
          )}

          {error && <div className="error-line">{error}</div>}
        </div>

        {/* §05:输入框与控件条是同一张卡,控件在卡内底部 */}
        <div className="composer-wrap">
          {paletteOpen && (
            <CommandPalette
              commands={commands}
              filter={paletteFilter}
              index={paletteIndex}
              onIndex={setPaletteIndex}
              onPick={pickCommand}
            />
          )}
          <div className="composer">
            <textarea
              ref={composerRef}
              value={draft}
              placeholder="给 Claude Code 发消息…(Enter 发送,Shift+Enter 换行,/ 唤出命令)"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // 面板开着时,上下与回车归面板 —— 否则回车会把「/rev」当消息发出去
                if (paletteOpen && paletteRows.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setPaletteIndex((i) => (i + 1) % paletteRows.length)
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setPaletteIndex((i) => (i - 1 + paletteRows.length) % paletteRows.length)
                    return
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    const picked = paletteRows[paletteIndex]
                    if (picked) pickCommand(picked)
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setDraft('')
                    return
                  }
                }
                // Ctrl B —— 把当前前台任务转到后台,和终端里一致 · §11
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
                  e.preventDefault()
                  void window.api.chat.toBackground()
                  return
                }
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
              requestOpen={controlRequest}
              onRequestHandled={() => setControlRequest(null)}
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
              tasks={tasks}
              onStopTask={(id) => void window.api.chat.stopTask(id)}
              onStopAllTasks={() => tasks.forEach((t) => void window.api.chat.stopTask(t.id))}
            />
          </div>
        </div>

      </main>

      {menu && (
        <SessionMenu
          session={menu.session}
          knownTags={[
            ...new Set(
              Object.values(sessionsByProject)
                .flat()
                .map((s) => s.tag)
                .filter((t): t is string => Boolean(t)),
            ),
          ]}
          at={menu.at}
          onClose={() => setMenu(null)}
          onRename={async (title) => {
            await window.api.sessions.rename(menu.session.sessionId, title)
            setMenu(null)
            await refreshSessions()
          }}
          onTag={async (tag) => {
            await window.api.sessions.tag(menu.session.sessionId, tag)
            setMenu(null)
            await refreshSessions()
          }}
          onFork={async () => {
            const id = await window.api.sessions.fork(
              menu.session.sessionId,
              `${menu.session.title} 分支`,
            )
            setMenu(null)
            await refreshSessions()
            if (config?.activeWorkspace) await openSession(config.activeWorkspace, id)
          }}
          onOpenDir={async () => {
            if (config?.activeWorkspace) await window.api.app.openProject(config.activeWorkspace)
            setMenu(null)
          }}
          onDelete={async () => {
            await window.api.sessions.remove(menu.session.sessionId)
            setMenu(null)
            if (menu.session.sessionId === activeSession) await newSession()
            await refreshSessions()
          }}
        />
      )}
    </div>
  )
}
