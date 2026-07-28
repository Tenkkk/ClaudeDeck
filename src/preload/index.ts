import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppConfig,
  AskAnswer,
  ChatEvent,
  ClaudeEntry,
  ContextUsage,
  AccountInfo,
  AgentInfo,
  McpServer,
  DoctorReport,
  EffortLevel,
  FileEntry,
  FileRead,
  ModelOption,
  PermissionMode,
  RewindPreview,
  SaveResult,
  SessionListItem,
  SlashCommandItem,
  TranscriptItem,
  UsageInfo,
  Versions,
} from '../shared/ipc.js'

/**
 * The only surface the renderer can reach. contextIsolation stays on and no
 * Node APIs are exposed — the renderer can call exactly these methods.
 */
const api = {
  doctor: {
    check: (): Promise<DoctorReport> => ipcRenderer.invoke('doctor:check'),
    install: (): Promise<{ ok: boolean; output: string }> => ipcRenderer.invoke('doctor:install'),
  },
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
    update: (patch: Partial<Omit<AppConfig, 'hasApiKey'>>): Promise<AppConfig> =>
      ipcRenderer.invoke('config:update', patch),
    setApiKey: (key: string | null): Promise<AppConfig> => ipcRenderer.invoke('config:setApiKey', key),
  },
  projects: {
    add: (): Promise<AppConfig> => ipcRenderer.invoke('projects:add'),
    activate: (path: string): Promise<AppConfig> => ipcRenderer.invoke('projects:activate', path),
    remove: (path: string): Promise<AppConfig> => ipcRenderer.invoke('projects:remove', path),
    collapse: (path: string, collapsed: boolean): Promise<AppConfig> =>
      ipcRenderer.invoke('projects:collapse', path, collapsed),
  },
  sessions: {
    /** Keyed by project path — sessions are scoped by directory. */
    byProject: (): Promise<Record<string, SessionListItem[]>> =>
      ipcRenderer.invoke('sessions:byProject'),
    history: (sessionId: string): Promise<TranscriptItem[]> =>
      ipcRenderer.invoke('sessions:history', sessionId),
    rename: (sessionId: string, title: string): Promise<void> =>
      ipcRenderer.invoke('sessions:rename', sessionId, title),
    remove: (sessionId: string): Promise<void> => ipcRenderer.invoke('sessions:delete', sessionId),
    tag: (sessionId: string, tag: string | null): Promise<void> =>
      ipcRenderer.invoke('sessions:tag', sessionId, tag),
    fork: (sessionId: string, title?: string): Promise<string> =>
      ipcRenderer.invoke('sessions:fork', sessionId, title),
    rewindPreview: (messageId: string): Promise<RewindPreview> =>
      ipcRenderer.invoke('sessions:rewindPreview', messageId),
    forkFrom: (
      sessionId: string,
      messageId: string,
      rewind: boolean,
      title?: string,
    ): Promise<string> =>
      ipcRenderer.invoke('sessions:forkFrom', sessionId, messageId, rewind, title),
  },
  files: {
    /** 列一层。relDir 传空串就是项目根 */
    list: (projectPath: string, relDir: string): Promise<FileEntry[]> =>
      ipcRenderer.invoke('files:list', projectPath, relDir),
    read: (projectPath: string, relPath: string): Promise<FileRead> =>
      ipcRenderer.invoke('files:read', projectPath, relPath),
  },
  claude: {
    list: (): Promise<ClaudeEntry[]> => ipcRenderer.invoke('claude:list'),
    read: (projectPath: string, relPath: string): Promise<string | null> =>
      ipcRenderer.invoke('claude:read', projectPath, relPath),
    write: (projectPath: string, relPath: string, content: string): Promise<SaveResult> =>
      ipcRenderer.invoke('claude:write', projectPath, relPath, content),
  },
  /** 自绘标题栏要的那几件事 */
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggleMaximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
    onMaximizedChange: (handler: (max: boolean) => void): (() => void) => {
      const listener = (_e: unknown, max: boolean): void => handler(max)
      ipcRenderer.on('window:maximized', listener)
      return () => ipcRenderer.removeListener('window:maximized', listener)
    },
  },
  app: {
    versions: (): Promise<Versions> => ipcRenderer.invoke('app:versions'),
    openProject: (path: string): Promise<string> => ipcRenderer.invoke('shell:openProject', path),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  },
  chat: {
    open: (sessionId?: string): Promise<boolean> => ipcRenderer.invoke('chat:open', sessionId),
    send: (text: string): Promise<boolean> => ipcRenderer.invoke('chat:send', text),
    models: (): Promise<ModelOption[]> => ipcRenderer.invoke('chat:models'),
    commands: (): Promise<SlashCommandItem[]> => ipcRenderer.invoke('chat:commands'),
    respondElicitation: (
      id: string,
      values: Record<string, string | boolean> | null,
    ): Promise<void> => ipcRenderer.invoke('chat:elicitation', id, values),
    respondAsk: (id: string, answer: AskAnswer | null): Promise<void> =>
      ipcRenderer.invoke('chat:ask', id, answer),
    respondPlan: (id: string, accepted: boolean): Promise<void> =>
      ipcRenderer.invoke('chat:plan', id, accepted),
    stopTask: (taskId: string): Promise<void> => ipcRenderer.invoke('chat:stopTask', taskId),
    toBackground: (): Promise<boolean> => ipcRenderer.invoke('chat:toBackground'),
    usage: (): Promise<UsageInfo | null> => ipcRenderer.invoke('chat:usage'),
    context: (): Promise<ContextUsage | null> => ipcRenderer.invoke('chat:context'),
    mcp: (): Promise<McpServer[]> => ipcRenderer.invoke('chat:mcp'),
    mcpReconnect: (name: string): Promise<string | null> =>
      ipcRenderer.invoke('chat:mcpReconnect', name),
    mcpToggle: (name: string, enabled: boolean): Promise<string | null> =>
      ipcRenderer.invoke('chat:mcpToggle', name, enabled),
    agents: (): Promise<AgentInfo[]> => ipcRenderer.invoke('chat:agents'),
    account: (): Promise<AccountInfo | null> => ipcRenderer.invoke('chat:account'),
    interrupt: (): Promise<void> => ipcRenderer.invoke('chat:interrupt'),
    setModel: (model: string): Promise<void> => ipcRenderer.invoke('chat:setModel', model),
    setEffort: (effort: EffortLevel): Promise<void> => ipcRenderer.invoke('chat:setEffort', effort),
    setPermissionMode: (mode: PermissionMode): Promise<void> =>
      ipcRenderer.invoke('chat:setPermissionMode', mode),
    respondPermission: (
      requestId: string,
      allow: boolean,
      remember = false,
      toolName?: string,
    ): Promise<void> =>
      ipcRenderer.invoke('chat:permission', requestId, allow, remember, toolName),
    onEvent: (handler: (event: ChatEvent) => void): (() => void) => {
      const listener = (_e: unknown, event: ChatEvent): void => handler(event)
      ipcRenderer.on('chat:event', listener)
      return () => ipcRenderer.removeListener('chat:event', listener)
    },
  },
}

contextBridge.exposeInMainWorld('api', api)

export type DeckApi = typeof api
