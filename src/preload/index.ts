import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppConfig,
  ChatEvent,
  DoctorReport,
  EffortLevel,
  HistoryMessage,
  ModelOption,
  PermissionMode,
  SessionListItem,
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
  workspace: {
    pick: (): Promise<AppConfig> => ipcRenderer.invoke('workspace:pick'),
    use: (dir: string): Promise<AppConfig> => ipcRenderer.invoke('workspace:use', dir),
  },
  sessions: {
    list: (): Promise<SessionListItem[]> => ipcRenderer.invoke('sessions:list'),
    history: (sessionId: string): Promise<HistoryMessage[]> =>
      ipcRenderer.invoke('sessions:history', sessionId),
    rename: (sessionId: string, title: string): Promise<void> =>
      ipcRenderer.invoke('sessions:rename', sessionId, title),
    remove: (sessionId: string): Promise<void> => ipcRenderer.invoke('sessions:delete', sessionId),
  },
  chat: {
    open: (sessionId?: string): Promise<boolean> => ipcRenderer.invoke('chat:open', sessionId),
    send: (text: string): Promise<boolean> => ipcRenderer.invoke('chat:send', text),
    models: (): Promise<ModelOption[]> => ipcRenderer.invoke('chat:models'),
    interrupt: (): Promise<void> => ipcRenderer.invoke('chat:interrupt'),
    setModel: (model: string): Promise<void> => ipcRenderer.invoke('chat:setModel', model),
    setEffort: (effort: EffortLevel): Promise<void> => ipcRenderer.invoke('chat:setEffort', effort),
    setPermissionMode: (mode: PermissionMode): Promise<void> =>
      ipcRenderer.invoke('chat:setPermissionMode', mode),
    respondPermission: (requestId: string, allow: boolean): Promise<void> =>
      ipcRenderer.invoke('chat:permission', requestId, allow),
    onEvent: (handler: (event: ChatEvent) => void): (() => void) => {
      const listener = (_e: unknown, event: ChatEvent): void => handler(event)
      ipcRenderer.on('chat:event', listener)
      return () => ipcRenderer.removeListener('chat:event', listener)
    },
  },
}

contextBridge.exposeInMainWorld('api', api)

export type DeckApi = typeof api
