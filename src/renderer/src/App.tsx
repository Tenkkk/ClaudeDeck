import { memo, useCallback, useEffect, useRef, useState } from 'react'
import AskCard from './components/AskCard.js'
import CommandPalette, { flatten } from './components/CommandPalette.js'
import ControlBar from './components/ControlBar.js'
import ElicitationCard from './components/ElicitationCard.js'
import ForkDialog from './components/ForkDialog.js'
import { FolderIcon } from './components/Icons.js'
import Message from './components/Message.js'
import FileTree from './components/FileTree.js'
import MidColumn from './components/MidColumn.js'
import PlanCard from './components/PlanCard.js'
import SearchPalette from './components/SearchPalette.js'
import SessionMenu from './components/SessionMenu.js'
import SettingsDialog from './components/SettingsDialog.js'
import Sidebar from './components/Sidebar.js'
import TitleBar from './components/TitleBar.js'
import Markdown from './components/Markdown.js'
import AgentsPanel from './components/AgentsPanel.js'
import McpPanel from './components/McpPanel.js'
import Resizer from './components/Resizer.js'
import { clampMidcol, clampSidebar, loadWidths, saveWidths } from './lib/columns.js'
import Thinking from './components/Thinking.js'
import Thought from './components/Thought.js'
import ToolRow from './components/ToolRow.js'
import Loading from './screens/Loading.js'
import Onboarding from './screens/Onboarding.js'
import ProjectPicker from './screens/ProjectPicker.js'
import {
  EFFORT_LEVELS,
  type AccountInfo,
  type AppConfig,
  type ChatEvent,
  type ContextUsage,
  type DoctorReport,
  type AskCard as AskCardData,
  type BackgroundTask,
  type ClaudeEntry,
  type ElicitationCard as ElicitationCardData,
  type ImageAttachment,
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
import { appendTool, replaceTool } from '../../shared/transcript.js'

type Phase = 'loading' | 'onboarding' | 'projects' | 'workspace'

interface PendingPermission {
  requestId: string
  toolName: string
  target?: string
  /** 桥接层写好的整句提示("Claude wants to read foo.txt"),有就用它当标题 */
  title?: string
  description?: string
  /** 为什么被拦、拦在哪条路径 —— CLI 给了就显示 */
  decisionReason?: string
  blockedPath?: string
  /** 改文件类工具从入参合成的 diff 行,复用工具行的画法 */
  preview?: ToolRowData
  /** 「本次会话内不再问」将放行的范围,如 `Bash(ls:*)`。没有就不出那颗按钮 */
  ruleSummary?: string
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
 * 同样由界面接管,但结果是一块面板、留在对话流里 —— 你跑了一条命令,
 * 就该看见它的回执。占位不带数据:面板自己取、自己刷,否则点完「重连」
 * 画面还停在旧状态上。
 */
const PANEL_COMMANDS: Record<string, 'mcp' | 'agents'> = {
  '/mcp': 'mcp',
  '/agents': 'agents',
}

/**
 * §06:Claude 会反复写 TodoWrite,同一次会话里只保留一张卡、原地更新,
 * 否则十几张待办卡会把对话冲掉。去重放在组装这一层。
 *
 * appendTool / replaceTool 与主进程的历史重建共用 —— 见 shared/transcript。
 * 各写一份的话规则必然走岔:回放里待办摊开、正文与工具行顺序相反,
 * 都是这么来的。
 */

/**
 * 给非工具条目盖稳定 key。工具行天然有 row.id;其余条目没有身份,
 * 落位时发一个 —— 下标当 key 的话,TodoWrite 去重从中段删一条,
 * 其后所有条目都会 remount:展开的输出全合上、面板重拉。
 */
let uidSeq = 0
function stamp(item: TranscriptItem): TranscriptItem {
  return { ...item, uid: ++uidSeq }
}

/**
 * 历史条目单独成树并 memo。流式输出期间每个 delta 都会让 App 重渲,
 * 而 transcript 数组在纯增量阶段并不变 —— 在这里把整棵子树剪掉,
 * 已经画好的历史就不会跟着每个字重排一遍(打字卡顿的大头)。
 */
const TranscriptList = memo(function TranscriptList({
  items,
  onFork,
}: {
  items: TranscriptItem[]
  onFork: (id: string) => void
}): React.JSX.Element {
  return (
    <>
      {items.map((item, i) =>
        item.kind === 'tool' ? (
          <ToolRow key={item.row.id} row={item.row} />
        ) : item.kind === 'thinking' ? (
          <Thought key={item.uid ?? `i${i}`} text={item.text} />
        ) : item.kind === 'compact' ? (
          // 压缩留痕:一道低调的分界 —— 这之前的对话已被摘要接续
          <div key={item.uid ?? `i${i}`} className="compact-mark">
            上下文已在此处压缩
          </div>
        ) : item.kind === 'mcp' ? (
          <McpPanel key={item.uid ?? `i${i}`} />
        ) : item.kind === 'agents' ? (
          <AgentsPanel key={item.uid ?? `i${i}`} />
        ) : (
          <Message
            key={item.uid ?? `i${i}`}
            role={item.kind}
            text={item.text}
            ts={item.ts}
            id={item.id}
            images={item.kind === 'user' ? item.images : undefined}
            onFork={onFork}
          />
        ),
      )}
    </>
  )
})

export default function App(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading')
  const [doctor, setDoctor] = useState<DoctorReport | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const permissionChanging = useRef(false)
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, SessionListItem[]>>({})
  const [expandedAll, setExpandedAll] = useState<Record<string, boolean>>({})
  const [activeSession, setActiveSession] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptItem[]>([])
  const [streaming, setStreaming] = useState('')
  const [thinking, setThinking] = useState('')
  const streamingBuffer = useRef('')
  const thinkingBuffer = useRef('')
  const viewIdRef = useRef('')
  const switchingRef = useRef(false)
  const [switching, setSwitching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [models, setModels] = useState<ModelOption[]>([])
  const [usage, setUsage] = useState<UsageInfo | null>(null)
  const [context, setContext] = useState<ContextUsage | null>(null)
  const [versions, setVersions] = useState<Versions | null>(null)
  const [account, setAccount] = useState<AccountInfo | null>(null)
  /*
   * 四种交互卡都是**队列**,不是单槽。SDK 会并发扇出工具调用,两张权限卡
   * 可以同时在路上 —— 单槽意味着第二张把第一张顶掉,被顶掉那张的 Promise
   * 在主进程里永远没人 resolve,整轮就死锁在那里。队列一次画一张,
   * 答完一张顶上下一张。
   */
  const [permissions, setPermissions] = useState<PendingPermission[]>([])
  const [elicitations, setElicitations] = useState<ElicitationCardData[]>([])
  const [unknownDialog, setUnknownDialog] = useState<string | null>(null)
  const [asks, setAsks] = useState<AskCardData[]>([])
  const [plans, setPlans] = useState<PlanCardData[]>([])
  const [menu, setMenu] = useState<{
    session: SessionListItem
    at: { x: number; y: number }
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  /** 粘贴进输入框、还没发出去的图片 */
  const [images, setImages] = useState<ImageAttachment[]>([])
  /** 撞到额度上限时的说明行,点掉或本轮结束自动消失 */
  const [limitNotice, setLimitNotice] = useState<string | null>(null)
  const [commands, setCommands] = useState<SlashCommandItem[]>([])
  const [paletteIndex, setPaletteIndex] = useState(0)
  const [controlRequest, setControlRequest] = useState<'model' | 'effort' | null>(null)
  const [widths, setWidths] = useState(loadWidths)
  const [turnStartedAt, setTurnStartedAt] = useState(0)
  const [turnStatus, setTurnStatus] = useState<TurnStatus>(null)
  const [outputTokens, setOutputTokens] = useState(0)
  /** .claude 配置栏 · §10 */
  /** 中栏在浏览哪个项目的文件树 */
  const [filesProject, setFilesProject] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  /** 侧栏收起时,shell 的栅格去掉那一列 */
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [openFile, setOpenFile] = useState<{ project: string; path: string } | null>(null)
  const [fileDirty, setFileDirty] = useState(false)
  const [tasks, setTasks] = useState<BackgroundTask[]>([])
  const [forkFrom, setForkFrom] = useState<string | null>(null)
  /** 刚发出、还没在 SDK 的 store 里露面的那条会话 —— 侧栏先摆着 */
  const [pendingSession, setPendingSession] = useState<{ path: string; title: string } | null>(null)
  /**
   * 刚删掉、但 store 的列表还没反映出来的会话。
   *
   * `deleteSession` 返回之后紧接着 `listSessions`,拿回来的往往还带着它 ——
   * 于是「删了但它还在」。这里先在本地把它划掉,等真实列表也不含它了再放手。
   */
  const [deletedSessions, setDeletedSessions] = useState<string[]>([])
  const transcriptRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  const activeSessionRef = useRef<string | null>(null)

  /**
   * 每轮结束后把消息 id 补进 transcript —— 分支和文件回退都要它,
   * 而直播流里的用户消息不带 uuid,只有 store 里有(§12)。
   *
   * **按内容配对,不按下标拉链**:store 里可能有直播时没画过的条目
   * (注入记录虽已在主进程过滤,两边形态仍可能有出入,比如一条助手消息
   * 被工具行截成两段)。下标一旦错开,其后所有 id 全错 —— 而这些 id 是
   * rewindFiles 的靶子,配错会真的把文件回退到错误的位置。
   * 游标单调前进:同一条 stored 不会被用两次;配不上就不给 id,宁缺毋错。
   *
   * 注意这里**只合并 id,不替换整条 transcript**:SessionMessage 里没有
   * tool_use_result,拿历史整个覆盖会把直播已经收到的 Bash 输出、Edit diff
   * 全抹掉 —— 表现为「一轮结束,工具行的展开按钮就没了」。
   */
  const mergeMessageIds = useCallback(async () => {
    const sid = activeSessionRef.current
    const viewId = viewIdRef.current
    if (!sid) return
    const stored = await window.api.sessions.history(sid)
    // 等 history 的空当里可能已经切走了 —— 旧会话的 id 不能盖到新对话上
    if (activeSessionRef.current !== sid || viewIdRef.current !== viewId) return
    const candidates = stored.flatMap((i) =>
      (i.kind === 'user' || i.kind === 'assistant') && i.id
        ? [{ kind: i.kind, text: i.text.trim(), id: i.id }]
        : [],
    )
    setTranscript((cur) => {
      let from = 0
      return cur.map((item) => {
        if (item.kind !== 'user' && item.kind !== 'assistant') return item
        const at = candidates.findIndex(
          (c, i) => i >= from && c.kind === item.kind && c.text === item.text.trim(),
        )
        if (at < 0) return item
        from = at + 1
        return item.id ? item : { ...item, id: candidates[at].id }
      })
    })
  }, [])

  const refreshSessions = useCallback(async () => {
    const map = await window.api.sessions.byProject()
    setSessionsByProject(map)
    // 真实列表里出现了当前会话,占位就该退场
    const id = activeSessionRef.current
    if (id && Object.values(map).some((rows) => rows.some((s) => s.sessionId === id))) {
      setPendingSession(null)
    }
    // 真实列表里也不见了的,本地就不用再划着它
    setDeletedSessions((ids) =>
      ids.filter((del) => Object.values(map).some((rows) => rows.some((s) => s.sessionId === del))),
    )
  }, [])

  /** 额度与上下文都随对话变化,每轮结束刷新一次。 */
  const refreshMeters = useCallback(async () => {
    const viewId = viewIdRef.current
    try {
      const [u, c] = await Promise.all([window.api.chat.usage(), window.api.chat.context()])
      if (viewIdRef.current !== viewId) return
      setUsage(u)
      setContext(c)
    } catch (err) {
      if (viewIdRef.current === viewId && !switchingRef.current) {
        setError(`会话状态读取失败:${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }, [])

  /**
   * 忙起来 —— 只在「从闲到忙」的那一下重置计时与计数。发送时调;
   * 排队的下一轮开始流式时也调(那时 send 已经没机会再重置了),
   * 所以 delta / thinking / tool 一到就打点。busyRef 挡住重复重置。
   */
  const busyRef = useRef(false)
  const markBusy = useCallback((at = Date.now()) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setTurnStartedAt(at)
    setTurnStatus(null)
    setOutputTokens(0)
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
    const handleEvent = (event: ChatEvent, at: number, replaying = false): void => {
      /** 把攒着的思考定格落进对话流 —— 正文开口、工具插入、轮次收尾都要 */
      const flushThinking = (): void => {
        const text = thinkingBuffer.current
        thinkingBuffer.current = ''
        setThinking('')
        if (text) {
          const item = stamp({ kind: 'thinking', text })
          setTranscript((tr) => [...tr, item])
        }
      }
      /** 把已经流出来的正文定格 —— 工具行插在正文之间时、轮次收尾时 */
      const flushStreaming = (): void => {
        const text = streamingBuffer.current
        streamingBuffer.current = ''
        setStreaming('')
        if (text) {
          const item = stamp({ kind: 'assistant', text, ts: at })
          setTranscript((tr) => [...tr, item])
        }
      }
      if (event.type === 'session') {
        setActiveSession(event.sessionId)
        activeSessionRef.current = event.sessionId
        // 一发出去侧栏就该多出这条,而不是等这一轮答完。session_id 在本轮
        // 第一条消息上就有了,这时 SDK 的 store 里已经落了盘,列得出来。
        // 标题是 Claude 生成的,会晚一点变 —— done 时再刷一次盖上去。
        if (!replaying) void refreshSessions()
      } else if (event.type === 'sent') {
        const item = stamp({
          kind: 'user', text: event.text, ts: at,
          ...(event.images > 0 ? { images: event.images } : {}),
        })
        setTranscript((tr) => [...tr, item])
        setError(null)
        markBusy(at)
      } else if (event.type === 'thinking') {
        markBusy(at)
        thinkingBuffer.current += event.text
        setThinking(thinkingBuffer.current)
      } else if (event.type === 'delta') {
        markBusy(at)
        // 正文一开口,思考就该定下来落进对话流 —— 它属于这一段回答之前
        flushThinking()
        streamingBuffer.current += event.text
        setStreaming(streamingBuffer.current)
      } else if (event.type === 'tool') {
        markBusy(at)
        // 工具行插在正文之间,所以先把已经流出来的文字定下来
        flushThinking()
        flushStreaming()
        setTranscript((t) => appendTool(t, event.row))
      } else if (event.type === 'toolUpdate') {
        setTranscript((t) => replaceTool(t, event.row))
      } else if (event.type === 'elicitation') {
        setElicitations((q) => (q.some((c) => c.id === event.card.id) ? q : [...q, event.card]))
      } else if (event.type === 'ask') {
        setAsks((q) => (q.some((c) => c.id === event.card.id) ? q : [...q, event.card]))
      } else if (event.type === 'plan') {
        setPlans((q) => (q.some((c) => c.id === event.card.id) ? q : [...q, event.card]))
      } else if (event.type === 'tasks') {
        setTasks(event.tasks)
      } else if (event.type === 'status') {
        setTurnStatus(event.status)
      } else if (event.type === 'retry') {
        // 网络波动的自动重试 —— 不说的话这段静默停顿和卡死无从区分
        setTurnStatus('retrying')
      } else if (event.type === 'limit') {
        if (event.status === 'rejected') {
          setTurnStatus('limited')
          const when = event.resetsAt
            ? new Date(event.resetsAt * 1000).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })
            : null
          setLimitNotice(when ? `额度已达上限,预计 ${when} 重置` : '额度已达上限,等待重置')
        }
        // 无论警告还是拒绝,额度环都该立刻反映最新占用
        if (!replaying) void refreshMeters()
      } else if (event.type === 'compacted') {
        // 压缩要留痕 —— 否则「它怎么忘了前面说的」无从解释
        const item = stamp({ kind: 'compact' })
        setTranscript((t) => [...t, item])
      } else if (event.type === 'commands') {
        setCommands(event.commands)
      } else if (event.type === 'progress') {
        setOutputTokens(event.outputTokens)
      } else if (event.type === 'unknownDialog') {
        setUnknownDialog(event.notice.dialogKind)
      } else if (event.type === 'permission') {
        setPermissions((q) =>
          q.some((p) => p.requestId === event.requestId)
            ? q
            : [
                ...q,
                {
                  requestId: event.requestId,
                  toolName: event.toolName,
                  target: event.target,
                  title: event.title,
                  description: event.description,
                  decisionReason: event.decisionReason,
                  blockedPath: event.blockedPath,
                  preview: event.preview,
                  ruleSummary: event.ruleSummary,
                },
              ],
        )
      } else if (event.type === 'dismiss') {
        // 请求在上游被取消(打断、超时),这张卡点了也没人听 —— 收走
        if (event.card === 'permission') {
          setPermissions((q) => q.filter((p) => p.requestId !== event.id))
        } else if (event.card === 'ask') {
          setAsks((q) => q.filter((c) => c.id !== event.id))
        } else if (event.card === 'plan') {
          setPlans((q) => q.filter((c) => c.id !== event.id))
        } else {
          setElicitations((q) => q.filter((c) => c.id !== event.id))
        }
      } else if (event.type === 'done') {
        // 只思考、没开口就结束的情况也要留下(比如全程在跑工具)
        flushThinking()
        flushStreaming()
        busyRef.current = false
        setBusy(false)
        setLimitNotice(null)
        if (!replaying) void refreshSessions()
        if (!replaying) void refreshMeters()
        // 只把消息 id 合并进来,不替换 transcript —— 见 mergeMessageIds
        if (!replaying) void mergeMessageIds()
      } else if (event.type === 'error') {
        // 报错也是一种收尾:半截的思考与正文要落进对话流、streaming 清空,
        // 否则下一轮的增量会接在死流的尾巴上,两轮回答拼成一条
        flushThinking()
        flushStreaming()
        setError(event.message)
        busyRef.current = false
        setBusy(false)
      }
    }
    return window.api.chat.onEvent((message) => {
      if (message.type === 'background') {
        void refreshSessions()
        return
      }
      if (message.viewId !== viewIdRef.current) return
      if (message.type === 'restore') {
        resetTurnState()
        setTranscript(message.history.map(stamp))
        setActiveSession(message.sessionId)
        activeSessionRef.current = message.sessionId
        setPendingSession(null)
        setConfig((c) => c ? {
          ...c, activeWorkspace: message.workspace, model: message.model,
          effort: message.effort, permissionMode: message.permissionMode,
        } : c)
        for (const { event, at } of message.events) handleEvent(event, at, true)
        return
      }
      handleEvent(message.event, message.at)
    })
  }, [refreshSessions, refreshMeters, mergeMessageIds, markBusy])

  /*
   * 对话区跟着新内容走 —— 但只在你本来就贴着底的时候。
   *
   * 原先是「transcript / streaming 一变就滚到底」。那样有两处不对:
   *
   * 1. 只认 state 变化。可正文长高不一定经过 state —— 代码块换行、思考那一行
   *    从「思考中 8 秒」变成「思考中 12 秒 · 1.2k tokens」、Markdown 收尾时
   *    重新排版,这些都会把内容顶高,而依赖数组毫无察觉。改成盯 DOM 的变动。
   * 2. 无条件滚到底。往回翻着读的时候被拽回底部,比不滚更烦。
   *
   * 贴底的判定留 24px 余量:滚动条很难精确停在 0。
   */
  const stickRef = useRef(true)

  useEffect(() => {
    const el = transcriptRef.current
    if (!el) return
    const onScroll = (): void => {
      stickRef.current = el.scrollHeight - el.clientHeight - el.scrollTop < 24
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [phase])

  useEffect(() => {
    const el = transcriptRef.current
    if (!el) return
    const follow = (): void => {
      if (stickRef.current) el.scrollTop = el.scrollHeight
    }
    const mo = new MutationObserver(follow)
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    return () => mo.disconnect()
  }, [phase])

  // 换会话就当作重新贴底:载入的是另一段历史,应当看见最后一条
  useEffect(() => {
    stickRef.current = true
    const el = transcriptRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [activeSession])

  useEffect(() => {
    if (phase !== 'workspace') return
    void refreshSessions()
    void newSession()

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
  //
  // 切项目**不再**关掉中栏:文件树现在显式绑在某个项目上,头部也写着是哪个 ——
  // 一边看 A 的文件一边跟 B 聊是合理的。要收拾的只有一种情况:那个项目被移除了。
  //
  // 依赖项要是个字符串,不能直接放数组 —— 数组每次渲染都是新引用,effect 会
  // 每次都跑。用换行连接:路径里不会出现换行,不会误切。
  const known = (config?.projects ?? []).map((p) => p.path).join('\n')
  useEffect(() => {
    const paths = new Set(known.split('\n').filter(Boolean))
    setFilesProject((cur) => (cur && !paths.has(cur) ? null : cur))
    setOpenFile((cur) => {
      if (!cur || paths.has(cur.project)) return cur
      // 有未保存改动就先留着,让人自己决定 —— 悄悄关掉就是丢东西
      return dirtyRef.current ? cur : null
    })
  }, [known])

  /**
   * 把上一个会话残留在界面上的东西统一清掉:半截回答、还亮着的「停止」、
   * 以及四种交互卡 —— 旧会话的卡浮在新会话里,点了也只是 no-op。
   * (轮内的取消由主进程按请求发 dismiss 事件精确收卡,这里只管换会话。)
   */
  function resetTurnState(): void {
    streamingBuffer.current = ''
    thinkingBuffer.current = ''
    setStreaming('')
    setThinking('')
    busyRef.current = false
    setBusy(false)
    setTasks([])
    setError(null)
    setLimitNotice(null)
    setPermissions([])
    setAsks([])
    setPlans([])
    setElicitations([])
    setUnknownDialog(null)
  }

  /** 每次选择先更换视图标识,旧事件和旧异步结果立即失效。 */
  const openGen = useRef(0)
  async function selectSession(projectPath?: string, sessionId?: string): Promise<void> {
    const gen = ++openGen.current
    const viewId = crypto.randomUUID()
    viewIdRef.current = viewId
    switchingRef.current = true
    setSwitching(true)
    resetTurnState()
    setActiveSession(sessionId ?? null)
    activeSessionRef.current = sessionId ?? null
    setTranscript([])
    setModels([])
    setCommands([])
    setUsage(null)
    setContext(null)
    try {
      const opened = await window.api.chat.open(sessionId, viewId, projectPath)
      if (!opened || gen !== openGen.current) return
      const init = await window.api.chat.init()
      if (gen !== openGen.current) return
      if (init) {
        setModels(init.models)
        setAccount(init.account)
        setCommands(init.commands)
      } else {
        const [models, account, commands] = await Promise.all([
          window.api.chat.models(), window.api.chat.account(), window.api.chat.commands(),
        ])
        if (gen !== openGen.current) return
        setModels(models)
        setAccount(account)
        setCommands(commands)
      }
      await refreshMeters()
      if (gen !== openGen.current) return
      void refreshSessions()
    } catch (err) {
      if (gen === openGen.current) setError(`会话打开失败:${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (gen === openGen.current) {
        switchingRef.current = false
        setSwitching(false)
      }
    }
  }

  async function openSession(projectPath: string, sessionId: string): Promise<void> {
    await selectSession(projectPath, sessionId)
  }

  async function newSession(projectPath?: string): Promise<void> {
    await selectSession(projectPath)
  }

  async function send(): Promise<void> {
    if (switchingRef.current) return
    const text = draft.trim()
    if (!text && images.length === 0) return

    // 这几条是界面自己的命令,不是给 agent 的(带图时当普通消息发)。
    // 终端里 /model 由 CLI 的界面层处理,发给 agent 只会石沉大海。
    if (images.length === 0) {
      const ui = UI_COMMANDS[text.toLowerCase()]
      if (ui) {
        setDraft('')
        setControlRequest(ui)
        return
      }
      const panel = PANEL_COMMANDS[text.toLowerCase()]
      if (panel) {
        setDraft('')
        const item = stamp({ kind: panel })
        setTranscript((t) => [...t, item])
        return
      }
    }

    setDraft('')
    const sendImages = images
    setImages([])

    /*
     * 侧栏那一条要**现在**就出现,不是等这一轮答完。
     *
     * 上一版我把刷新挂在 session 事件上,以为那是「发送时」—— 其实不是:
     * chat.open() 一进工作区就建了 query,system/init 那会儿就带来了 session_id,
     * 事件在你还没打字时就发过了;真发消息时 id 没变,不再触发。
     *
     * 所以这里先乐观地摆一条上去,标题就用你刚打的那句(store 里此刻的标题
     * 本来也是它 —— Claude 生成的摘要要晚一些才盖上来)。等真实列表里出现
     * 这个 session_id,这条占位就自动让位,中间不会闪。
     */
    const ws = config?.activeWorkspace
    if (ws) {
      const known = (sessionsByProject[ws] ?? []).some((s) => s.sessionId === activeSessionRef.current)
      if (!known) setPendingSession({ path: ws, title: text || '(图片)' })
    }
    const viewId = viewIdRef.current
    try {
      await window.api.chat.send(text, sendImages, viewId)
    } catch (err) {
      if (viewId !== viewIdRef.current) return
      setError(`发送失败:${err instanceof Error ? err.message : String(err)}`)
      setDraft(text)
      setImages(sendImages)
    }
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

  /*
   * 窗口是无边框的,所以标题栏必须比这几屏更外层 —— 否则加载页、引导页、
   * 选项目页上连关闭按钮都没有,只能去任务管理器结束进程。
   * 这几屏还没有侧栏和搜索,那两个入口就不给。
   */
  const bare = (body: React.JSX.Element): React.JSX.Element => (
    <div className="app">
      <TitleBar
        sidebarOpen={false}
        onToggleSidebar={() => {}}
        onSearch={() => {}}
        onSettings={() => {}}
        bare
      />
      {body}
    </div>
  )

  if (phase === 'loading') return bare(<Loading />)

  if (phase === 'onboarding') {
    return bare(<Onboarding doctor={doctor} config={config} onDone={reload} />)
  }

  if (phase === 'projects') {
    return bare(
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
      />,
    )
  }

  const mode = config?.permissionMode ?? 'default'
  const activeProject = config?.projects.find((p) => p.path === config.activeWorkspace)
  /**
   * 侧栏看到的列表 = 真实列表 + 那条还没落到 store 里的占位。
   *
   * 占位只在真实列表还没有它的时候补上,所以不会出现「先冒出来、
   * 刷新时消失、答完又冒出来」这种闪烁。
   */
  const sidebarSessions = ((): Record<string, SessionListItem[]> => {
    // 先把删掉的划走,再考虑要不要补占位
    const base =
      deletedSessions.length === 0
        ? sessionsByProject
        : Object.fromEntries(
            Object.entries(sessionsByProject).map(([p, rows]) => [
              p,
              rows.filter((s) => !deletedSessions.includes(s.sessionId)),
            ]),
          )
    if (!pendingSession) return base
    const rows = base[pendingSession.path] ?? []
    const id = activeSession
    if (id && rows.some((s) => s.sessionId === id)) return base
    return {
      ...base,
      [pendingSession.path]: [
        {
          sessionId: id ?? '__pending__',
          title: pendingSession.title,
          preview: pendingSession.title,
          lastModified: Date.now(),
        },
        ...rows,
      ],
    }
  })()

  const activeSessions = config?.activeWorkspace
    ? (sidebarSessions[config.activeWorkspace] ?? [])
    : []

  // 交互卡各队列只画队头 —— 答完一张,下一张自己顶上来
  const permission = permissions[0] ?? null
  const ask = asks[0] ?? null
  const plan = plans[0] ?? null
  const elicitation = elicitations[0] ?? null

  /** 中栏开着没有 —— 树和文件都算 */
  const midOpen = openFile !== null || filesProject !== null
  const projectNameOf = (path: string): string =>
    config?.projects.find((p) => p.path === path)?.name ?? path

  // 窗口左边缘就是 shell 的左边缘(没有更外层的容器),所以 clientX 直接
  // 就是侧栏宽度;中栏那道线要先减掉侧栏。
  function resizeSidebar(px: number): void {
    const next = clampSidebar(px, {
      viewport: window.innerWidth,
      midcol: widths.midcol,
      midOpen,
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
    // 宽度变量放在最外层:标题栏要按侧栏宽度切换底色,它在 shell 之外
    <div
      className={`app${sidebarOpen ? '' : ' no-sidebar'}`}
      style={
        {
          '--w-sidebar': `${widths.sidebar}px`,
          '--w-midcol': `${widths.midcol}px`,
        } as React.CSSProperties
      }
    >
      <TitleBar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onSearch={() => setSearchOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />

      {searchOpen && (
        <SearchPalette
          projects={config?.projects ?? []}
          sessionsByProject={sidebarSessions}
          onClose={() => setSearchOpen(false)}
          onPick={(p, id) => {
            setSearchOpen(false)
            void openSession(p, id)
          }}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          config={config}
          doctor={doctor}
          onClose={() => setSettingsOpen(false)}
          onSaveCredentials={async (url, key) => {
            const next = await window.api.config.update({ baseUrl: url })
            setConfig(next)
            // 空串表示清除,null 表示这次不动它
            if (key !== null) setConfig(await window.api.config.setApiKey(key === '' ? null : key))
          }}
        />
      )}

      <div className={`shell${midOpen ? ' with-mid' : ''}${sidebarOpen ? '' : ' no-sidebar'}`}>
        {sidebarOpen && (
      <Sidebar
        projects={config?.projects ?? []}
        sessionsByProject={sidebarSessions}
        activeWorkspace={config?.activeWorkspace ?? null}
        activeSession={activeSession}
        usage={usage}
        account={account}
        versions={versions}
        expandedAll={expandedAll}
        onNewSession={() => void newSession()}
        onNewSessionIn={(path) => void newSession(path)}
        onOpenSession={(p, id) => void openSession(p, id)}
        onSessionMenu={(session, at) => setMenu({ session, at })}
        onToggleCollapse={async (path, collapsed) => {
          setConfig(await window.api.projects.collapse(path, collapsed))
        }}
        onExpandAll={(path) => setExpandedAll((e) => ({ ...e, [path]: !e[path] }))}
        onAddProject={async () => {
          const cfg = await window.api.projects.add()
          setConfig(cfg)
          await refreshSessions()
        }}
        onManageProjects={() => setPhase('projects')}
        filesProject={filesProject}
        onOpenFiles={(path) => {
          // 再点一次收起。切到另一个项目时,已经打开的文件要跟着让位 ——
          // 否则会出现「树是 A 项目的、右边开着 B 项目的文件」
          setOpenFile(null)
          setFilesProject((cur) => (cur === path ? null : path))
        }}
        theme={config?.theme ?? 'system'}
        onTheme={async (t) => setConfig(await window.api.config.update({ theme: t }))}
      />
        )}

      {/* 两道竖线都能拖 · 夹逼规则见 lib/columns。侧栏收起时没有那道线 */}
      {sidebarOpen && (
        <Resizer
          className="resizer-sidebar"
          label="调整侧栏宽度"
          onDrag={(x) => resizeSidebar(x)}
          onNudge={(d) => resizeSidebar(widths.sidebar + d)}
        />
      )}
      {midOpen && (
        <Resizer
          className="resizer-midcol"
          label="调整文件栏宽度"
          onDrag={(x) => resizeMidcol(x - widths.sidebar)}
          onNudge={(d) => resizeMidcol(widths.midcol + d)}
        />
      )}

      {/* 中栏两种形态:开着某个文件就看文件,否则看这个项目的文件树 */}
      {openFile ? (
        <MidColumn
          projectPath={openFile.project}
          projectName={projectNameOf(openFile.project)}
          relPath={openFile.path}
          onClose={() => {
            setOpenFile(null)
            setFilesProject(null)
          }}
          onBack={filesProject ? () => setOpenFile(null) : undefined}
          onDirtyChange={setFileDirty}
        />
      ) : (
        filesProject && (
          <FileTree
            projectPath={filesProject}
            projectName={projectNameOf(filesProject)}
            onClose={() => setFilesProject(null)}
            onOpenFile={(relPath) => setOpenFile({ project: filesProject, path: relPath })}
          />
        )
      )}

      <main className="main">
        {/* 归属行 · §05:项目 / 会话标题。
            上下文占用挪去了输入框旁边的环 —— 它属于「发这条之前要知道的事」,
            和权限、模型、努力是同一类,不该单独待在屏幕另一头。 */}
        <div className="crumb">
          <FolderIcon className="crumb-folder" />
          <span className="project">{activeProject?.name ?? '—'}</span>
          <span className="sep">/</span>
          <span className="title">
            {activeSessions.find((s) => s.sessionId === activeSession)?.title ?? '新会话'}
          </span>
          {/* 文件入口在这儿也放一个:侧栏那个挂在项目下,这个对的是「当前这个会话
              在哪个目录里干活」—— 边聊边翻文件时,手不用跑到侧栏去 */}
          {config?.activeWorkspace && (
            <button
              className="crumb-files"
              aria-current={filesProject === config.activeWorkspace}
              title="浏览这个项目的文件"
              onClick={() => {
                const path = config.activeWorkspace
                if (!path) return
                setOpenFile(null)
                setFilesProject((cur) => (cur === path ? null : path))
              }}
            >
              <FolderIcon size={12} />
              文件
            </button>
          )}
        </div>

        <div className="transcript" ref={transcriptRef}>
          {transcript.length === 0 && !streaming && (
            <div className="empty-state">
              <span className="brand-dot breathing" />
              <div>问点什么开始。Claude Code 会在当前项目目录里读写文件。</div>
            </div>
          )}

          <TranscriptList items={transcript} onFork={setForkFrom} />

          {/* 正在想的那一段:自动展开,让人看着它在动 */}
          {thinking && <Thought text={thinking} live />}

          {streaming && (
            <div className="msg-wrap">
              {/* 正在输出的那条不出动作行 · §06 */}
              {/* 流式过程中也走 Markdown:半截的代码块、没闭合的粗体都要能画,
                  不然文字会在收尾那一刻整段重排,读起来像闪了一下 */}
              <div className="msg-claude">
                <Markdown text={streaming} />
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
              effort={EFFORT_LEVELS.find((e) => e.value === config?.effort)?.label}
            />
          )}

          {/* §06 权限卡:行内、不弹窗 —— 弹窗会把上文遮住,而你要看的正是上文。
              陶土左条 = 在拦你(计划卡是沙绿左条 = 在等你满意)。
              标题优先用桥接层写好的整句(title),没有才自己拼;
              「不再问」按 ruleSummary 的范围走,凑不出范围就没有这颗按钮。 */}
          {permission && (
            <div className="permission-card">
              <div className="card-label">
                等待你决定
                {permissions.length > 1 && ` · 还有 ${permissions.length - 1} 个在排队`}
              </div>
              <div className="card-title">
                {permission.title ? (
                  permission.title
                ) : (
                  <>
                    Claude 想使用 {permission.toolName}
                    {permission.target && (
                      <strong className="card-target">{permission.target}</strong>
                    )}
                  </>
                )}
              </div>
              {/* 改文件的批准先看得见改什么 —— diff 预览复用工具行 */}
              {permission.preview && <ToolRow row={permission.preview} />}
              {permission.decisionReason && <div className="hint">{permission.decisionReason}</div>}
              {permission.blockedPath && (
                <div className="hint">
                  范围外路径:<strong className="card-target">{permission.blockedPath}</strong>
                </div>
              )}
              <div className="hint">{permission.description ?? '在你点下之前,对话停在这里。'}</div>
              <div className="row">
                <button
                  className="primary"
                  onClick={() => {
                    void window.api.chat.respondPermission(permission.requestId, true)
                    setPermissions((q) => q.filter((p) => p.requestId !== permission.requestId))
                  }}
                >
                  允许
                </button>
                <button
                  onClick={() => {
                    void window.api.chat.respondPermission(permission.requestId, false)
                    setPermissions((q) => q.filter((p) => p.requestId !== permission.requestId))
                  }}
                >
                  拒绝
                </button>
                {permission.ruleSummary && (
                  <button
                    className="card-remember"
                    title="只放行这个范围,换会话即失效"
                    onClick={() => {
                      void window.api.chat.respondPermission(permission.requestId, true, true)
                      setPermissions((q) => q.filter((p) => p.requestId !== permission.requestId))
                    }}
                  >
                    本次会话内不再问 {permission.ruleSummary}
                  </button>
                )}
              </div>
            </div>
          )}

          {elicitation && (
            <ElicitationCard
              key={elicitation.id}
              card={elicitation}
              onSubmit={(values) => {
                void window.api.chat.respondElicitation(elicitation.id, values)
                setElicitations((q) => q.filter((c) => c.id !== elicitation.id))
              }}
              onCancel={() => {
                void window.api.chat.respondElicitation(elicitation.id, null)
                setElicitations((q) => q.filter((c) => c.id !== elicitation.id))
              }}
            />
          )}

          {ask && (
            <AskCard
              key={ask.id}
              card={ask}
              onSubmit={(answer) => {
                void window.api.chat.respondAsk(ask.id, answer)
                setAsks((q) => q.filter((c) => c.id !== ask.id))
              }}
              onCancel={() => {
                void window.api.chat.respondAsk(ask.id, null)
                setAsks((q) => q.filter((c) => c.id !== ask.id))
              }}
            />
          )}

          {plan && (
            <PlanCard
              key={plan.id}
              card={plan}
              onAccept={() => {
                void window.api.chat.respondPlan(plan.id, true)
                setPlans((q) => q.filter((c) => c.id !== plan.id))
              }}
              onDiscuss={() => {
                void window.api.chat.respondPlan(plan.id, false)
                setPlans((q) => q.filter((c) => c.id !== plan.id))
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

          {limitNotice && (
            <div className="notice" onClick={() => setLimitNotice(null)}>
              <span className="notice-icon">⊙</span>
              <span>{limitNotice}</span>
            </div>
          )}

          {error && <div className="error-line">{error}</div>}
        </div>

        {/* §05:输入框与控件条是同一张卡,控件在卡内底部 */}
        <div className="composer-wrap" inert={switching} aria-busy={switching}>
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
            {images.length > 0 && (
              <div className="attach-row">
                {images.map((img, i) => (
                  <span key={i} className="attach-chip">
                    <img
                      className="attach-img"
                      src={`data:${img.mediaType};base64,${img.data}`}
                      alt={`粘贴的图片 ${i + 1}`}
                    />
                    <button
                      className="attach-x"
                      title="移除这张图"
                      onClick={() => setImages((list) => list.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={composerRef}
              value={draft}
              placeholder={
                busy
                  ? '正在回答…这条会排队,答完接着发(Enter 发送)'
                  : '给 Claude Code 发消息…(Enter 发送,Shift+Enter 换行,/ 唤出命令,可粘贴图片)'
              }
              onChange={(e) => setDraft(e.target.value)}
              onPaste={(e) => {
                // 只接管图片,普通文本粘贴照旧走默认行为
                const files = Array.from(e.clipboardData.items)
                  .filter((it) => it.kind === 'file' && /^image\/(png|jpeg|gif|webp)$/.test(it.type))
                  .map((it) => it.getAsFile())
                  .filter((f): f is File => f !== null)
                if (files.length === 0) return
                e.preventDefault()
                for (const f of files) {
                  const mediaType = f.type as ImageAttachment['mediaType']
                  const reader = new FileReader()
                  reader.onload = () => {
                    const url = typeof reader.result === 'string' ? reader.result : ''
                    const data = url.slice(url.indexOf(',') + 1)
                    if (data) setImages((list) => [...list, { mediaType, data }])
                  }
                  reader.readAsDataURL(f)
                }
              }}
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
              canSend={Boolean(draft.trim()) || images.length > 0}
              context={context}
              usage={usage}
              contextWarnAt={CONTEXT_WARN_AT}
              requestOpen={controlRequest}
              onRequestHandled={() => setControlRequest(null)}
              onMode={async (v) => {
                if (permissionChanging.current) return
                permissionChanging.current = true
                const viewId = viewIdRef.current
                try {
                  await window.api.chat.setPermissionMode(v)
                  if (viewId !== viewIdRef.current) return
                  setConfig((c) => (c ? { ...c, permissionMode: v } : c))
                } catch (err) {
                  if (viewId !== viewIdRef.current) return
                  setError(`权限切换失败:${err instanceof Error ? err.message : String(err)}`)
                } finally {
                  permissionChanging.current = false
                }
              }}
              onModel={(v) => {
                void window.api.chat.setModel(v)
                setConfig((c) => (c ? { ...c, model: v } : c))
              }}
              onEffort={(v) => {
                // 和模型、权限档一样是一次原地控制请求,不再重开 query
                void window.api.chat.setEffort(v)
                setConfig((c) => (c ? { ...c, effort: v } : c))
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
            const gone = menu.session.sessionId
            // 先在本地划掉再去删:等 store 反映出来要一会儿,
            // 那段时间里「点了删除但它还在」比慢一点更让人不安
            setDeletedSessions((ids) => [...ids, gone])
            setMenu(null)
            await window.api.sessions.remove(gone)
            if (gone === activeSession) await newSession()
            await refreshSessions()
          }}
        />
      )}
      </div>
    </div>
  )
}
