import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  deleteSession,
  getSessionMessages,
  listSessions,
  renameSession,
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
import type {
  ChatEvent,
  EffortLevel,
  HistoryMessage,
  PermissionMode,
  SessionListItem,
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

  ipcMain.handle('sessions:history', async (_e, sessionId: string): Promise<HistoryMessage[]> => {
    const config = getConfig()
    const messages = await getSessionMessages(sessionId, { dir: config.activeWorkspace ?? undefined })
    const out: HistoryMessage[] = []
    for (const m of messages as { type?: string; message?: { role?: string; content?: unknown } }[]) {
      const role = m.message?.role
      if (role !== 'user' && role !== 'assistant') continue
      const content = m.message?.content
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .filter((b): b is { type: 'text'; text: string } => (b as { type?: string }).type === 'text')
                .map((b) => b.text)
                .join('')
            : ''
      if (text.trim()) out.push({ role, text })
    }
    return out
  })

  ipcMain.handle('sessions:rename', (_e, sessionId: string, title: string) => {
    const config = getConfig()
    return renameSession(sessionId, title, { dir: config.activeWorkspace ?? undefined })
  })

  ipcMain.handle('sessions:delete', (_e, sessionId: string) => {
    const config = getConfig()
    return deleteSession(sessionId, { dir: config.activeWorkspace ?? undefined })
  })

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
  ipcMain.handle('chat:usage', () => active?.usage() ?? null)
  ipcMain.handle('chat:context', () => active?.contextUsage() ?? null)

  ipcMain.handle('app:versions', async (): Promise<Versions> => {
    const report = await runDoctor()
    return { app: app.getVersion(), cli: report.cliVersion ?? null }
  })

  ipcMain.handle('chat:interrupt', () => active?.interrupt())
  ipcMain.handle('chat:permission', (_e, requestId: string, allow: boolean) => {
    active?.answerPermission(requestId, allow)
  })

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
