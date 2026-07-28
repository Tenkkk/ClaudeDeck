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
import { listClaudeEntries, readClaudeFile, writeClaudeFile } from './claudedir.js'
import { annotateSources } from './commands.js'
import { applyToolResult, rowFromToolUse } from './tools.js'
import type {
  AskAnswer,
  ChatEvent,
  ClaudeEntry,
  EffortLevel,
  PermissionMode,
  RewindPreview,
  SaveResult,
  SessionListItem,
  SlashCommandItem,
  ToolRow,
  TranscriptItem,
  Versions,
} from '../shared/ipc.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let active: ChatSession | null = null

function emit(event: ChatEvent): void {
  mainWindow?.webContents.send('chat:event', event)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      // ESM preload scripts require the sandbox to be off.
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

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
  active = new ChatSession(emit)
  active.start({
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
  ipcMain.handle('config:update', (_e, patch) => updateConfig(patch))
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
   */
  ipcMain.handle('sessions:history', async (_e, sessionId: string): Promise<TranscriptItem[]> => {
    const config = getConfig()
    const messages = await getSessionMessages(sessionId, {
      dir: config.activeWorkspace ?? undefined,
    })

    const out: TranscriptItem[] = []
    const rowsById = new Map<string, ToolRow>()

    interface Block {
      type?: string
      text?: string
      id?: string
      name?: string
      input?: unknown
      tool_use_id?: string
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
        if (content.trim()) out.push({ kind: role, text: content, id: raw.uuid })
        continue
      }
      if (!Array.isArray(content)) continue

      let text = ''
      for (const b of content as Block[]) {
        if (b.type === 'text' && b.text) {
          text += b.text
        } else if (b.type === 'tool_use' && b.id && b.name) {
          const row = rowFromToolUse(b.id, b.name, b.input)
          rowsById.set(b.id, row)
          out.push({ kind: 'tool', row })
        } else if (b.type === 'tool_result' && b.tool_use_id) {
          const pending = rowsById.get(b.tool_use_id)
          if (!pending) continue
          const filled = applyToolResult(pending, raw.tool_use_result)
          rowsById.set(b.tool_use_id, filled)
          // 就地替换 transcript 里那一条,保持顺序
          const at = out.findIndex((i) => i.kind === 'tool' && i.row.id === b.tool_use_id)
          if (at >= 0) out[at] = { kind: 'tool', row: filled }
        }
      }
      if (text.trim()) out.push({ kind: role, text, id: raw.uuid })
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

  /** 在资源管理器里打开项目目录(§08 右键菜单)。 */
  ipcMain.handle('shell:openProject', (_e, path: string) => shell.openPath(path))

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

  // .claude 配置栏 · §10。范围锁在 claudedir.ts 里,渲染层传来的路径一律不信。
  ipcMain.handle('claude:list', (): ClaudeEntry[] => {
    const path = getConfig().activeWorkspace
    return path ? listClaudeEntries(path) : []
  })

  // 读写都显式收 projectPath:如果按「当前项目」解析,用户切了项目而编辑器
  // 还开着,保存就会落到另一个项目的同名文件上。
  ipcMain.handle('claude:read', (_e, projectPath: string, relPath: string): string | null =>
    readClaudeFile(projectPath, relPath),
  )

  ipcMain.handle(
    'claude:write',
    (_e, projectPath: string, relPath: string, content: string): SaveResult =>
      writeClaudeFile(projectPath, relPath, content),
  )

  ipcMain.handle('chat:open', (_e, sessionId?: string) => {
    openSession(sessionId)
    return true
  })

  ipcMain.handle('chat:send', (_e, text: string) => {
    if (!active) openSession()
    active?.send(text)
    return true
  })

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
    (_e, requestId: string, allow: boolean, remember: boolean, toolName?: string) => {
      active?.answerPermission(requestId, allow, remember, toolName)
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

  // Effort has no in-place setter on Query, so it requires reopening the query.
  // Resuming with forkSession:false keeps the same session id and history.
  ipcMain.handle('chat:setEffort', (_e, effort: EffortLevel) => {
    updateConfig({ effort })
    const resume = active?.sessionId ?? undefined
    if (active) openSession(resume)
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
  active?.dispose()
  active = null
  app.quit()
})
