import { spawn } from 'node:child_process'
import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'

/** stderr 尾巴留这么多字节 —— 够看清死因,装不下日志洪流 */
const TAIL_BYTES = 2048

export interface ClaudeSpawner {
  spawn: (opts: SpawnOptions) => SpawnedProcess
  /** 最近一个 CLI 进程的 stderr 尾巴 —— 进程意外退出时的「遗言」 */
  stderrTail: () => string
}

/**
 * 自定义 spawn,替换 SDK 的默认拉起。做两件默认路径做不到的事:
 *
 * 1. **杀就杀整棵进程树。** SDK 的拆除只 kill 领头的 claude.exe;Windows
 *    没有进程组语义,领头死了,它拉起的 MCP server 和还在跑的 Bash 子进程
 *    会整批变成孤儿继续活着 —— 表现是退出/切会话之后任务管理器里仍有一串
 *    残留进程。taskkill /t 按父子关系枚举整棵树、/f 强杀。注意必须趁领头
 *    还活着时跑:/t 靠父子表,父进程先死,子进程就找不到了 ——
 *    所以不能先原生 kill 再补 taskkill。
 *
 * 2. **留住 stderr 的尾巴。** SDK 自己的 stderr tail 机制长在它的默认
 *    spawnLocalProcess 里,换了自定义 spawn 就不参与了(SpawnedProcess
 *    接口根本没有 stderr)。这里自己接住,断连报错时才有死因可给。
 *    也因此 stderr 必须接管道并消费掉 —— 接了不读,CLI 写满缓冲区
 *    就会卡死在 stderr 写入上。
 *
 * AbortSignal 不直接交给 spawn():Electron 里跨 realm 的 signal 可能过不了
 * Node 内部的 instanceof 检查;手动挂监听。这个 signal 由 SDK 在优雅关闭
 * (stdin EOF + 宽限窗口)之后才触发,响了就不必再客气,直接树杀。
 */
export function createClaudeSpawner(): ClaudeSpawner {
  let tail = ''

  const spawnFn = (opts: SpawnOptions): SpawnedProcess => {
    tail = ''
    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      tail = (tail + chunk.toString('utf8')).slice(-TAIL_BYTES)
    })
    child.stderr?.on('error', () => {
      // stderr 读挂了就不读了 —— 它只是遗言,不值得连累进程本体
    })

    const nativeKill = child.kill.bind(child)
    child.kill = (signal?: NodeJS.Signals | number): boolean => {
      const alive = child.exitCode === null && child.signalCode === null
      if (process.platform !== 'win32' || typeof child.pid !== 'number' || !alive) {
        return nativeKill(signal)
      }
      try {
        spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
          stdio: 'ignore',
          windowsHide: true,
        }).on('error', () => {
          // taskkill 本身起不来(几乎不会):退回只杀领头,总比不杀强
          nativeKill(signal)
        })
        return true
      } catch {
        return nativeKill(signal)
      }
    }

    const { signal } = opts
    if (signal) {
      const onAbort = (): void => void child.kill('SIGKILL')
      if (signal.aborted) {
        onAbort()
      } else {
        signal.addEventListener('abort', onAbort, { once: true })
        child.once('exit', () => signal.removeEventListener('abort', onAbort))
      }
    }

    if (!child.stdin || !child.stdout) throw new Error('claude 进程的标准流没有建立起来。')
    return child as unknown as SpawnedProcess
  }

  return { spawn: spawnFn, stderrTail: () => tail.trim() }
}
