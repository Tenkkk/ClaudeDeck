import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getConfig } from './config.js'
import type { DoctorReport } from '../shared/ipc.js'

const run = promisify(execFile)

/**
 * ClaudeDeck wraps Claude Code; it does not replace it. The SDK spawns the
 * `claude` executable, so if the CLI is missing there is nothing to talk to and
 * the app must send the user to the onboarding screen instead of failing later
 * with an opaque spawn error.
 */
export async function runDoctor(): Promise<DoctorReport> {
  const config = getConfig()
  const credentialsConfigured = config.hasApiKey || config.baseUrl !== ''

  try {
    // `shell: true` is required on Windows: `claude` resolves to claude.cmd,
    // which CreateProcess cannot execute directly.
    const { stdout } = await run('claude', ['--version'], {
      shell: true,
      timeout: 15_000,
      windowsHide: true,
    })
    return {
      cliFound: true,
      cliVersion: stdout.trim(),
      credentialsConfigured,
    }
  } catch (err) {
    return {
      cliFound: false,
      cliError: err instanceof Error ? err.message : String(err),
      credentialsConfigured,
    }
  }
}

/** The command shown on the onboarding screen and used by the install button. */
export const INSTALL_COMMAND = 'npm install -g @anthropic-ai/claude-code'

export async function installCli(): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await run('npm', ['install', '-g', '@anthropic-ai/claude-code'], {
      shell: true,
      timeout: 300_000,
      windowsHide: true,
    })
    return { ok: true, output: stdout || stderr }
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) }
  }
}
