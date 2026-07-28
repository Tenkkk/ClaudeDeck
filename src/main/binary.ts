import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * SDK 自带的那份 claude 可执行文件,在打包后的应用里的位置。
 *
 * 为什么需要这个:打包后 node_modules 被压进 app.asar,SDK 解析出来的路径是
 * `...\resources\app.asar\node_modules\...\claude.exe`。Electron 给 fs 做了
 * asar 转发,所以 existsSync 返回 true —— 但 **asar 里的可执行文件是 spawn
 * 不起来的**。SDK 看到「文件在、却起不来」,就退回去猜了个 libc 不匹配,
 * 报错内容跟真实原因差了十万八千里(musl/glibc,在 Windows 上)。
 *
 * electron-builder 的 asarUnpack 已经把真身放到了 app.asar.unpacked,
 * 这里只是把路径指过去。
 */
export function bundledExecutablePath(
  resourcesPath: string,
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  return join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@anthropic-ai',
    `claude-agent-sdk-${platform}-${arch}`,
    platform === 'win32' ? 'claude.exe' : 'claude',
  )
}

/**
 * 传给 SDK 的 pathToClaudeCodeExecutable。
 *
 * 开发时返回 undefined:node_modules 就摊在磁盘上,SDK 自己找得到,
 * 而那条路径正是跑过 e2e 的那条,不去动它。
 *
 * 判据是**文件在不在**,不是 app.isPackaged —— 少一个 electron 依赖,
 * 这个模块就能进单元测试;而且万一哪天 asarUnpack 配漏了,这里会自然
 * 退回 SDK 自己的解析,而不是拿着一个不存在的路径去撞。
 */
export function resolveClaudeExecutable(): string | undefined {
  // process.resourcesPath 由 Electron 注入,不需要 import electron
  const resources = process.resourcesPath
  if (!resources) return undefined
  const bundled = bundledExecutablePath(resources)
  return existsSync(bundled) ? bundled : undefined
}
