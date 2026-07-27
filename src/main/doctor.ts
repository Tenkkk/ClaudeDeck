import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { getConfig } from './config.js'
import type { DoctorReport } from '../shared/ipc.js'

// `exec` rather than `execFile(..., { shell: true })`: on Windows `claude` and
// `npm` resolve to .cmd shims that CreateProcess cannot launch directly, so a
// shell is required either way — but passing a separate args array through a
// shell concatenates without escaping (Node DEP0190). Both commands below are
// fixed literals with no interpolated input, so a single literal command string
// is both simpler and the safer shape.
const run = promisify(exec)

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
    const { stdout } = await run('claude --version', {
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
    const { stdout, stderr } = await run(INSTALL_COMMAND, {
      timeout: 300_000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    })
    return { ok: true, output: stdout || stderr }
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) }
  }
}
