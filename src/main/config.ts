import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { AppConfig, EffortLevel, PermissionMode, Project } from '../shared/ipc.js'

/**
 * Preferences live in userData/config.json. The API key is stored in the same
 * file but encrypted with Electron's safeStorage (DPAPI on Windows), so it is
 * never written as plaintext and is only decryptable by this OS user.
 */

interface StoredConfig {
  baseUrl: string
  apiKeyCipher: string | null
  projects: Project[]
  activeWorkspace: string | null
  model: string | null
  effort: EffortLevel
  permissionMode: PermissionMode
}

/** Shape written by versions before projects existed. */
interface LegacyConfig {
  workspaces?: string[]
}

const DEFAULTS: StoredConfig = {
  baseUrl: '',
  apiKeyCipher: null,
  projects: [],
  activeWorkspace: null,
  model: null,
  effort: 'medium',
  permissionMode: 'default',
}

let cache: StoredConfig | null = null

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

export function projectName(path: string): string {
  return basename(path.replace(/[\\/]+$/, '')) || path
}

/**
 * `workspaces: string[]` was a most-recently-used list; projects are a managed
 * set with display names and collapse state. Migrate rather than drop, so an
 * existing install keeps its directories.
 */
function migrate(raw: StoredConfig & LegacyConfig): StoredConfig {
  if (Array.isArray(raw.projects) && raw.projects.length > 0) return raw
  const legacy = Array.isArray(raw.workspaces) ? raw.workspaces : []
  return {
    ...raw,
    // 只展开当前项目 —— 全都展开的话,几个项目就把侧栏塞满了
    projects: legacy.map((path) => ({
      path,
      name: projectName(path),
      collapsed: path !== raw.activeWorkspace,
    })),
  }
}

function load(): StoredConfig {
  if (cache) return cache
  const file = configPath()
  let next: StoredConfig = { ...DEFAULTS }
  if (existsSync(file)) {
    try {
      next = migrate({ ...DEFAULTS, ...JSON.parse(readFileSync(file, 'utf8')) })
    } catch {
      // A corrupt config must not brick the app; keep the defaults and let the
      // next save overwrite the bad file.
    }
  }
  cache = next
  return next
}

function persist(next: StoredConfig): void {
  cache = next
  const file = configPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
}

/** Public view of the config — never exposes the key itself. */
export function getConfig(): AppConfig {
  const c = load()
  return {
    baseUrl: c.baseUrl,
    hasApiKey: c.apiKeyCipher !== null,
    projects: c.projects,
    activeWorkspace: c.activeWorkspace,
    model: c.model,
    effort: c.effort,
    permissionMode: c.permissionMode,
  }
}

export function updateConfig(patch: Partial<Omit<AppConfig, 'hasApiKey'>>): AppConfig {
  const c = load()
  persist({
    ...c,
    baseUrl: patch.baseUrl ?? c.baseUrl,
    projects: patch.projects ?? c.projects,
    activeWorkspace: patch.activeWorkspace !== undefined ? patch.activeWorkspace : c.activeWorkspace,
    model: patch.model !== undefined ? patch.model : c.model,
    effort: patch.effort ?? c.effort,
    permissionMode: patch.permissionMode ?? c.permissionMode,
  })
  return getConfig()
}

export function setApiKey(key: string | null): AppConfig {
  const c = load()
  if (key === null || key === '') {
    persist({ ...c, apiKeyCipher: null })
    return getConfig()
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统凭据加密不可用,无法安全保存 API Key。')
  }
  persist({ ...c, apiKeyCipher: safeStorage.encryptString(key).toString('base64') })
  return getConfig()
}

/** Decrypts the key for use in the SDK's env. Main process only. */
export function readApiKey(): string | null {
  const c = load()
  if (!c.apiKeyCipher) return null
  try {
    return safeStorage.decryptString(Buffer.from(c.apiKeyCipher, 'base64'))
  } catch {
    // Happens if the config was copied from another machine or user account.
    return null
  }
}

/** Adds a project (idempotent by path) and makes it active. */
/** 新增的项目会成为当前项目,所以它展开、其余保持原状。 */
export function addProject(path: string): AppConfig {
  const c = load()
  const existing = c.projects.find((p) => p.path === path)
  const projects = existing
    ? c.projects.map((p) => (p.path === path ? { ...p, collapsed: false } : p))
    : [...c.projects, { path, name: projectName(path), collapsed: false }]
  persist({ ...c, projects, activeWorkspace: path })
  return getConfig()
}

export function removeProject(path: string): AppConfig {
  const c = load()
  const projects = c.projects.filter((p) => p.path !== path)
  const activeWorkspace =
    c.activeWorkspace === path ? (projects[0]?.path ?? null) : c.activeWorkspace
  persist({ ...c, projects, activeWorkspace })
  return getConfig()
}

export function setProjectCollapsed(path: string, collapsed: boolean): AppConfig {
  const c = load()
  persist({
    ...c,
    projects: c.projects.map((p) => (p.path === path ? { ...p, collapsed } : p)),
  })
  return getConfig()
}

/** Switching the active project is implicit when opening one of its sessions. */
export function setActiveWorkspace(path: string): AppConfig {
  const c = load()
  if (!c.projects.some((p) => p.path === path)) return addProject(path)
  persist({ ...c, activeWorkspace: path })
  return getConfig()
}

/**
 * Environment handed to the SDK. Returning an empty object means "inherit the
 * user's existing Claude Code login", which is the right default when they have
 * already run `claude` and authenticated normally.
 */
export function credentialEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  const key = readApiKey()
  const c = load()
  if (key) {
    env.ANTHROPIC_API_KEY = key
    env.ANTHROPIC_AUTH_TOKEN = key
  }
  if (c.baseUrl) env.ANTHROPIC_BASE_URL = c.baseUrl
  return env
}
