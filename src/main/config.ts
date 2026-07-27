import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppConfig, EffortLevel, PermissionMode } from '../shared/ipc.js'

/**
 * Preferences live in userData/config.json. The API key is stored in the same
 * file but encrypted with Electron's safeStorage (DPAPI on Windows), so it is
 * never written as plaintext and is only decryptable by this OS user.
 */

interface StoredConfig {
  baseUrl: string
  apiKeyCipher: string | null
  workspaces: string[]
  activeWorkspace: string | null
  model: string | null
  effort: EffortLevel
  permissionMode: PermissionMode
}

const DEFAULTS: StoredConfig = {
  baseUrl: '',
  apiKeyCipher: null,
  workspaces: [],
  activeWorkspace: null,
  model: null,
  effort: 'medium',
  permissionMode: 'default',
}

let cache: StoredConfig | null = null

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

function load(): StoredConfig {
  if (cache) return cache
  const file = configPath()
  let next: StoredConfig = { ...DEFAULTS }
  if (existsSync(file)) {
    try {
      next = { ...DEFAULTS, ...JSON.parse(readFileSync(file, 'utf8')) }
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
    workspaces: c.workspaces,
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
    workspaces: patch.workspaces ?? c.workspaces,
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

/** Records a workspace directory as most-recently-used. */
export function rememberWorkspace(dir: string): AppConfig {
  const c = load()
  const workspaces = [dir, ...c.workspaces.filter((w) => w !== dir)].slice(0, 10)
  persist({ ...c, workspaces, activeWorkspace: dir })
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
