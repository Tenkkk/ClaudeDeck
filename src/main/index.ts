import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  deleteSession,
  forkSession,
  getSessionMessages,
  listSessions,
  renameSession,
  tagSession,
} from '@anthropic-ai/claude-agent-sdk'
import { ChatSession } from './chat.js'
import {
  addProject,
  getConfig,
  removeProject,
  setActiveWorkspace,
  setApiKey,
  setProjectCollapsed,
  updateConfig,
} from './config.js'
import { installCli, runDoctor } from './doctor.js'
import { bindUpdater, type Updater } from './updater.js'
import {
  listClaudeEntries,
  listProjectDir,
  readClaudeFile,
  readProjectFile,
  writeClaudeFile,
} from './claudedir.js'
import { annotateSources } from './commands.js'
import { isInjectedUserText, unexpandSlashCommand } from './history.js'
import { applyToolResult, rowFromToolUse } from './tools.js'
import { appendTool, replaceTool } from '../shared/transcript.js'
import type {
  AskAnswer,
  ChatEvent,
  ClaudeEntry,
  EffortLevel,
  FileEntry,
  FileRead,
  ImageAttachment,
  PermissionMode,
  RewindPreview,
  SaveResult,
  SessionListItem,
  SlashCommandItem,
  ThemePref,
  ToolRow,
  TranscriptItem,
  Versions,
} from '../shared/ipc.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let active: ChatSession | null = null
let updater: Updater | null = null

function emit(event: ChatEvent): void {
  // 退出路径上 dispose 也会发事件(收卡),那时窗口可能已经销毁
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('chat:event', event)
}

/**
 * 渲染层传来的项目根一律先对表。IPC 输入不可信:不拦的话,
 * `files.read('C:\\Users\\<user>\\.claude', '.credentials.json')` 会把明文
 * 凭据整个吐回去,`claude.write` 往全局 settings.json 里写 hooks 就是本机
 * 任意代码执行 —— 「渲染层一个 bug」到「RCE」的距离必须由主进程拉开。
 * 相对路径的收敛在 claudedir.ts;这里管的是「根本不该以哪个根开工」。
 */
function knownProject(path: string): boolean {
  return getConfig().projects.some((p) => p.path === path)
}

/**
 * 主进程崩了不能静默死:窗口还开着像是卡死,claude.exe 一串留在后台。
 * 至少把进程树带走、把死因亮出来,再退出。
 */
process.on('uncaughtException', (err) => {
  active?.dispose(true)
  active = null
  dialog.showErrorBox('ClaudeDeck 出错了', err.stack ?? String(err))
  app.exit(1)
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    /*
     * 无边框:系统标题栏和界面是两张皮 —— 它有自己的底色、自己的字体、
     * 自己的高度,和下面这套设计对不上。改成自己画一条,和侧栏同底,
     * 视觉上是一整块。窗口按钮由渲染层出,拖拽靠 -webkit-app-region。
     */
    frame: false,
    backgroundColor: '#faf7f2',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      // ESM preload scripts require the sandbox to be off.
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  /*
   * 渲染进程崩了(OOM、驱动问题)默认就是一扇白窗,而主进程和 claude.exe
   * 都还活着。重载一次:主进程里的会话原封不动,界面起来会重新接上。
   * 短时间内接连崩说明重载救不了 —— 别陷进白屏⇄崩溃的循环,报出来退出。
   */
  let lastRendererCrash = 0
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return
    const now = Date.now()
    if (now - lastRendererCrash < 10_000) {
      active?.dispose(true)
      active = null
      dialog.showErrorBox('ClaudeDeck 界面反复崩溃', `原因:${details.reason}`)
      app.exit(1)
      return
    }
    lastRendererCrash = now
    mainWindow?.webContents.reload()
  })

  updater = bindUpdater(mainWindow)

  // 最大化状态要回传:自绘的那颗按钮得知道画「最大化」还是「还原」
  const sendMax = (): void =>
    mainWindow?.webContents.send('window:maximized', mainWindow.isMaximized() === true)
  mainWindow.on('maximize', sendMax)
  mainWindow.on('unmaximize', sendMax)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Starts (or restarts) the live conversation. */
function openSession(resume?: string): void {
  const config = getConfig()
  if (!config.activeWorkspace) throw new Error('尚未选择工作目录。')

  active?.dispose()

  /*
   * 事件带着「是哪个会话发的」再出门。
   *
   * 切会话时旧 query 正在输出的话,它的 delta 还会在管道里飘一会儿;
   * 直接转发出去的话,上一轮的回答会接在新会话的对话流下面。
   * 这里认对象身份:不是当前这个 session 发的,一律丢弃。
   */
  const session = new ChatSession((event) => {
    if (session === active) emit(event)
  })
  active = session
  session.start({
    cwd: config.activeWorkspace,
    resume,
    model: config.model,
    effort: config.effort,
    permissionMode: config.permissionMode,
  })
}

function registerIpc(): void {
  ipcMain.handle('doctor:check', () => runDoctor())
  ipcMain.handle('doctor:install', () => installCli())

  ipcMain.handle('config:get', () => getConfig())
  ipcMain.handle('config:update', (_e, patch: { baseUrl?: string; theme?: ThemePref }) => {
    // 这条通道只放行两个纯偏好。项目清单与当前项目各有校验过的专用
    // handler,从这里放进去等于给「把任意目录注册成项目」开后门
    const clean: { baseUrl?: string; theme?: ThemePref } = {}
    if (typeof patch?.baseUrl === 'string') clean.baseUrl = patch.baseUrl
    if (patch?.theme === 'system' || patch?.theme === 'light' || patch?.theme === 'dark') {
      clean.theme = patch.theme
    }
    return updateConfig(clean)
  })
  ipcMain.handle('config:setApiKey', (_e, key: string | null) => setApiKey(key))

  ipcMain.handle('projects:add', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: '选择一个项目目录',
    })
    if (result.canceled || !result.filePaths[0]) return getConfig()
    return addProject(result.filePaths[0])
  })

  ipcMain.handle('projects:activate', (_e, path: string) => setActiveWorkspace(path))
  ipcMain.handle('projects:remove', (_e, path: string) => removeProject(path))
  ipcMain.handle('projects:collapse', (_e, path: string, collapsed: boolean) =>
    setProjectCollapsed(path, collapsed),
  )

  // The SDK's session store is the single source of truth for chat history.
  // ClaudeDeck deliberately keeps no parallel copy of conversations.
  //
  // Sessions are scoped by directory, so the sidebar's two-level grouping means
  // one listSessions call per project, keyed by project path.
  ipcMain.handle('sessions:byProject', async (): Promise<Record<string, SessionListItem[]>> => {
    const config = getConfig()
    const out: Record<string, SessionListItem[]> = {}
    await Promise.all(
      config.projects.map(async (project) => {
        try {
          const sessions = await listSessions({ dir: project.path, limit: 200 })
          out[project.path] = sessions.map((s) => ({
            sessionId: s.sessionId,
            title: s.customTitle || s.summary || s.firstPrompt || '未命名会话',
            preview: s.firstPrompt ?? '',
            lastModified: s.lastModified,
            gitBranch: s.gitBranch,
            tag: s.tag,
          }))
        } catch {
          // A project directory can be renamed or unplugged between launches.
          // An unreadable project shows as empty rather than taking down the
          // whole sidebar.
          out[project.path] = []
        }
      }),
    )
    return out
  })

  /**
   * Rebuilds a past conversation as the same TranscriptItem[] the live stream
   * produces, so an old session renders identically to one being typed into —
   * tool rows included, not just text.
   *
   * 组装规则(去重、按 id 回填)与直播共用 shared/transcript;顺序也要对齐:
   * 直播时正文在工具行到来的那一刻就落进对话流,这里必须同样在 tool_use
   * 处截断 —— 否则同一条消息回放出来是「先工具后正文」,和直播相反,
   * id 按内容配对也会配不上。
   */
  ipcMain.handle('sessions:history', async (_e, sessionId: string): Promise<TranscriptItem[]> => {
    const config = getConfig()
    const messages = await getSessionMessages(sessionId, {
      dir: config.activeWorkspace ?? undefined,
    })

    let out: TranscriptItem[] = []
    const rowsById = new Map<string, ToolRow>()

    interface Block {
      type?: string
      text?: string
      thinking?: string
      id?: string
      name?: string
      input?: unknown
      tool_use_id?: string
      is_error?: boolean
    }
    interface Msg {
      uuid?: string
      message?: { role?: string; content?: unknown }
      tool_use_result?: unknown
    }

    for (const raw of messages as Msg[]) {
      const role = raw.message?.role
      const content = raw.message?.content
      if (role !== 'user' && role !== 'assistant') continue

      if (typeof content === 'string') {
        // CLI 注入的记录(命令输出、压缩前言等)直播时从没画过,回放也不画
        if (role === 'user' && isInjectedUserText(content)) continue
        // 用户消息可能是被展开过的斜杠命令,还原成人看的样子
        const shown = role === 'user' ? unexpandSlashCommand(content) : content
        if (shown.trim()) out.push({ kind: role, text: shown, id: raw.uuid })
        continue
      }
      if (!Array.isArray(content)) continue

      let text = ''
      let imageCount = 0
      const flushText = (): void => {
        if (!(role === 'user' && isInjectedUserText(text))) {
          const shown = role === 'user' ? unexpandSlashCommand(text) : text
          // 图片正文里看不见,至少把「带了几张」还原出来;纯图消息也要占位
          if (shown.trim() || imageCount > 0) {
            if (role === 'user') {
              out.push({
                kind: 'user',
                text: shown,
                id: raw.uuid,
                ...(imageCount > 0 ? { images: imageCount } : {}),
              })
            } else {
              out.push({ kind: 'assistant', text: shown, id: raw.uuid })
            }
            imageCount = 0
          }
        }
        text = ''
      }
      for (const b of content as Block[]) {
        if (b.type === 'text' && b.text) {
          text += b.text
        } else if (b.type === 'image') {
          imageCount++
        } else if (b.type === 'thinking' && b.thinking) {
          // 思考也要回放 —— 不然切走再切回,思考块全部消失
          out.push({ kind: 'thinking', text: b.thinking })
        } else if (b.type === 'tool_use' && b.id && b.name) {
          flushText()
          const row = rowFromToolUse(b.id, b.name, b.input)
          rowsById.set(b.id, row)
          out = appendTool(out, row)
        } else if (b.type === 'tool_result' && b.tool_use_id) {
          const pending = rowsById.get(b.tool_use_id)
          if (!pending) continue
          const filled = applyToolResult(pending, raw.tool_use_result, b.is_error === true)
          rowsById.set(b.tool_use_id, filled)
          out = replaceTool(out, filled)
        }
      }
      flushText()
    }

    return out
  })

  ipcMain.handle('sessions:rename', (_e, sessionId: string, title: string) => {
    const config = getConfig()
    return renameSession(sessionId, title, { dir: config.activeWorkspace ?? undefined })
  })

  /** 一个会话一个标签,传 null 即清除(§08)。 */
  ipcMain.handle('sessions:tag', (_e, sessionId: string, tag: string | null) => {
    const config = getConfig()
    return tagSession(sessionId, tag, { dir: config.activeWorkspace ?? undefined })
  })

  /**
   * 从某条会话分支出去。SDK 没有 regenerate,也删不掉已写入的消息,
   * 所以「重答」只能是分支 —— 必然多出一条会话,界面必须说出来(坑 4.4)。
   */
  ipcMain.handle('sessions:fork', async (_e, sessionId: string, title?: string) => {
    const config = getConfig()
    const result = await forkSession(sessionId, {
      dir: config.activeWorkspace ?? undefined,
      title,
    })
    return result.sessionId
  })

  /**
   * 分支前先问一次能不能回退文件 · §12。
   * 「能回退 N 个文件」必须是真数字 —— 所以这里跑一次 dryRun。
   */
  ipcMain.handle(
    'sessions:rewindPreview',
    async (_e, messageId: string): Promise<RewindPreview> => {
      const r = await active?.rewindPreview(messageId)
      if (!r) return { canRewind: false, fileCount: 0, reason: '当前没有活着的会话。' }
      return {
        canRewind: r.canRewind,
        fileCount: r.filesChanged?.length ?? 0,
        reason: r.error,
      }
    },
  )

  /**
   * 从某条消息分支出去,可选同时把文件回退到那一刻。
   * 只 fork 对话不回退磁盘 = 上下文和硬盘不一致,之后 Edit 会报错(坑 4.2)。
   */
  ipcMain.handle(
    'sessions:forkFrom',
    async (_e, sessionId: string, messageId: string, rewind: boolean, title?: string) => {
      if (rewind) await active?.rewindFiles(messageId)
      const config = getConfig()
      const result = await forkSession(sessionId, {
        dir: config.activeWorkspace ?? undefined,
        upToMessageId: messageId,
        title,
      })
      return result.sessionId
    },
  )

  ipcMain.handle('sessions:delete', (_e, sessionId: string) => {
    const config = getConfig()
    return deleteSession(sessionId, { dir: config.activeWorkspace ?? undefined })
  })

  // 自绘标题栏的三颗按钮。窗口没了就什么都不做,不抛。
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:toggleMaximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() === true)

  // 应用内更新 —— 检查、下载、安装三步都由用户点,不自动做任何一步
  ipcMain.handle('update:state', () => updater?.current() ?? null)
  ipcMain.handle('update:check', () => updater?.check() ?? null)
  ipcMain.handle('update:download', () => updater?.download())
  ipcMain.handle('update:install', () => updater?.install())

  /** 在资源管理器里打开项目目录(§08 右键菜单)。只开登记过的项目。 */
  ipcMain.handle('shell:openProject', (_e, path: string) =>
    knownProject(path) ? shell.openPath(path) : '',
  )

  /**
   * 正文里的链接交给系统浏览器 —— 应用窗口里没有地址栏,真导航过去就回不来了。
   *
   * **只放行 http / https。** 这里的 url 来自模型输出,是不可信输入:
   * `file:`、`ms-msdt:` 这类协议交给 shell 会直接启动本机程序。
   */
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return
    void shell.openExternal(parsed.href)
  })

  /**
   * 文件树。一次只列一层 —— 展开哪层问哪层,免得在 node_modules 上原地爆炸。
   * 路径收敛与 .claude 那套同源,但**读的范围是整个项目、写的范围没有变**。
   */
  ipcMain.handle('files:list', (_e, projectPath: string, relDir: string): FileEntry[] =>
    knownProject(projectPath) ? listProjectDir(projectPath, relDir) : [],
  )
  ipcMain.handle('files:read', (_e, projectPath: string, relPath: string): FileRead =>
    knownProject(projectPath)
      ? readProjectFile(projectPath, relPath)
      : { ok: false, reason: 'out-of-scope' },
  )

  // .claude 配置栏 · §10。范围锁在 claudedir.ts 里,渲染层传来的路径一律不信。
  ipcMain.handle('claude:list', (): ClaudeEntry[] => {
    const path = getConfig().activeWorkspace
    return path ? listClaudeEntries(path) : []
  })

  // 读写都显式收 projectPath:如果按「当前项目」解析,用户切了项目而编辑器
  // 还开着,保存就会落到另一个项目的同名文件上。
  ipcMain.handle('claude:read', (_e, projectPath: string, relPath: string): string | null =>
    knownProject(projectPath) ? readClaudeFile(projectPath, relPath) : null,
  )

  ipcMain.handle(
    'claude:write',
    (_e, projectPath: string, relPath: string, content: string): SaveResult => {
      if (!knownProject(projectPath)) return { ok: false, reason: 'out-of-scope' }
      const result = writeClaudeFile(projectPath, relPath, content)
      // 存的是当前项目的 skill / 命令 → 活着的会话立即重扫,不必重开;
      // 新命令表随 commands 事件推回界面
      if (
        result.ok &&
        projectPath === getConfig().activeWorkspace &&
        /^\.claude\/(skills|commands)\//.test(relPath)
      ) {
        void active?.reloadSkills()
      }
      return result
    },
  )

  ipcMain.handle('chat:open', (_e, sessionId?: string) => {
    openSession(sessionId)
    return true
  })

  ipcMain.handle('chat:send', (_e, text: string, images?: ImageAttachment[]) => {
    /*
     * query 死了(CLI 进程崩了/断连)就先原地重开再发:往死 query 的
     * inbox 里推消息没人消费,表现是又一次永久转圈。resume 同一条会话,
     * 没落过盘的空会话则直接开新的(resumable 挡住「resume 不存在的 id」)。
     */
    if (!active || active.dead) openSession(active?.resumable ?? undefined)
    active?.send(text, images ?? [])
    return true
  })

  /** 首屏三次控制往返合一;拿不到返回 null,渲染层退回逐项拉 */
  ipcMain.handle('chat:init', () => active?.initInfo() ?? null)

  ipcMain.handle('chat:models', () => active?.listModels() ?? [])

  /** 命令列表由 SDK 运行时给,界面不写死任何一条;来源在主进程标注(§15)。 */
  ipcMain.handle('chat:commands', async (): Promise<SlashCommandItem[]> => {
    const raw = (await active?.listCommands()) ?? []
    return annotateSources(raw, getConfig().activeWorkspace)
  })
  ipcMain.handle(
    'chat:elicitation',
    (_e, id: string, values: Record<string, string | boolean> | null) => {
      active?.answerElicitation(id, values)
    },
  )
  ipcMain.handle('chat:ask', (_e, id: string, answer: AskAnswer | null) => {
    active?.answerAsk(id, answer)
  })
  ipcMain.handle('chat:plan', (_e, id: string, accepted: boolean) => {
    active?.answerPlan(id, accepted)
  })
  ipcMain.handle('chat:stopTask', (_e, taskId: string) => active?.stopTask(taskId))
  ipcMain.handle('chat:toBackground', () => active?.moveToBackground() ?? false)
  ipcMain.handle('chat:usage', () => active?.usage() ?? null)
  ipcMain.handle('chat:context', () => active?.contextUsage() ?? null)
  ipcMain.handle('chat:mcp', () => active?.mcpServers() ?? [])
  ipcMain.handle('chat:mcpReconnect', (_e, name: string) => active?.mcpReconnect(name) ?? '会话未启动')
  ipcMain.handle('chat:mcpToggle', (_e, name: string, enabled: boolean) =>
    active?.mcpToggle(name, enabled) ?? '会话未启动',
  )
  ipcMain.handle('chat:agents', () => active?.agents() ?? [])
  ipcMain.handle('chat:account', () => active?.account() ?? null)

  ipcMain.handle('app:versions', async (): Promise<Versions> => {
    const report = await runDoctor()
    return { app: app.getVersion(), cli: report.cliVersion ?? null }
  })

  ipcMain.handle('chat:interrupt', () => active?.interrupt())
  ipcMain.handle(
    'chat:permission',
    (_e, requestId: string, allow: boolean, remember: boolean) => {
      active?.answerPermission(requestId, allow, remember)
    },
  )

  // Model and permission mode change in place — history is untouched.
  ipcMain.handle('chat:setModel', async (_e, model: string) => {
    updateConfig({ model })
    await active?.setModel(model)
  })

  ipcMain.handle('chat:setPermissionMode', async (_e, mode: PermissionMode) => {
    updateConfig({ permissionMode: mode })
    await active?.setPermissionMode(mode)
  })

  ipcMain.handle('chat:setEffort', async (_e, effort: EffortLevel) => {
    updateConfig({ effort })
    await active?.setEffort(effort)
  })
}

void app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // 进程马上就要没了,graceful 那条异步路等不到 —— 同步强杀
  active?.dispose(true)
  active = null
  app.quit()
})

// 不是所有退出都路过 window-all-closed(应用内更新的 quitAndInstall 就可能
// 直接走 quit)。这里兜底把 CLI 进程带走;dispose 幂等,两边都到也只拆一次。
app.on('before-quit', () => {
  active?.dispose(true)
  active = null
})
