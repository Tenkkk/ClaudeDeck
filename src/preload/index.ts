import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppConfig,
  ChatEvent,
  ContextUsage,
  DoctorReport,
  EffortLevel,
  ModelOption,
  PermissionMode,
  SessionListItem,
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
  },
  app: {
    versions: (): Promise<Versions> => ipcRenderer.invoke('app:versions'),
  },
  chat: {
    open: (sessionId?: string): Promise<boolean> => ipcRenderer.invoke('chat:open', sessionId),
    send: (text: string): Promise<boolean> => ipcRenderer.invoke('chat:send', text),
    models: (): Promise<ModelOption[]> => ipcRenderer.invoke('chat:models'),
    usage: (): Promise<UsageInfo | null> => ipcRenderer.invoke('chat:usage'),
    context: (): Promise<ContextUsage | null> => ipcRenderer.invoke('chat:context'),
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
