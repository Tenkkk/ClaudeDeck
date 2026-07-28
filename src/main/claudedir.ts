import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ClaudeEntry, SaveResult } from '../shared/ipc.js'

/**
 * `.claude` 配置的读写 —— 设计终稿 §10。
 *
 * **范围只到项目的 `.claude/` 和项目根的 `CLAUDE.md`。**
 * 不做通用文件树 —— 否则这一栏就变成一个半成品编辑器,而它的目的是改配置,
 * 不是写代码。
 *
 * ## 路径必须锁死
 *
 * 相对路径是渲染层传过来的,不能信。`resolve` 之后必须验证它确实落在允许的
 * 范围内,否则 `../../../../Windows/System32/...` 就能读写任意文件。
 * 这不是理论风险:渲染层跑的是我们自己的代码没错,但 IPC 通道的输入
 * 一律当作不可信,是这类应用的基本纪律。
 */

/** 只有这两类目标是允许的。 */
function allowedRoots(projectPath: string): { claudeDir: string; rootMemo: string } {
  return {
    claudeDir: resolve(projectPath, '.claude'),
    rootMemo: resolve(projectPath, 'CLAUDE.md'),
  }
}

/**
 * 把相对路径解析成绝对路径,并确认它没有跑出范围。
 * 越界一律返回 null,由调用方拒绝 —— 不抛异常,免得把错误信息里的
 * 真实路径泄回渲染层。
 */
export function resolveInScope(projectPath: string, relPath: string): string | null {
  const { claudeDir, rootMemo } = allowedRoots(projectPath)
  const target = resolve(projectPath, relPath)

  if (target === rootMemo) return target

  // 必须真正在 .claude/ 之下。
  //
  // 用 relative 判断,不能用 startsWith 比字符串 —— 否则同级的
  // `.claude-backup` 会被误判成在范围内。
  //
  // 还要挡 isAbsolute:Windows 上跨盘符时 relative 返回的是绝对路径
  // (relative('D:\\proj\\.claude', 'C:\\Windows\\win.ini') → 'C:\\Windowswin.ini'),
  // 它不以 `..` 开头,只查前缀会直接放行。
  const rel = relative(claudeDir, target)
  if (rel === '' || isAbsolute(rel) || rel.startsWith('..') || rel.includes(`..${sep}`)) return null
  return target
}

const TEXT_EXT = /\.(json|md|markdown|txt|ya?ml|toml)$/i

/** 列出这一栏能打开的东西。目录只展开一层,点开才继续。 */
export function listClaudeEntries(projectPath: string): ClaudeEntry[] {
  const out: ClaudeEntry[] = []
  const { claudeDir } = allowedRoots(projectPath)

  const walk = (dir: string, depth: number): void => {
    if (depth > 3 || !existsSync(dir)) return
    let names: string[]
    try {
      names = readdirSync(dir).sort()
    } catch {
      return
    }
    for (const name of names) {
      const full = join(dir, name)
      let s
      try {
        s = statSync(full)
      } catch {
        continue
      }
      const rel = relative(projectPath, full).split(sep).join('/')
      if (s.isDirectory()) {
        let count = 0
        try {
          count = readdirSync(full).length
        } catch {
          count = 0
        }
        out.push({ path: rel, name, kind: 'dir', count })
        walk(full, depth + 1)
      } else if (TEXT_EXT.test(name)) {
        out.push({ path: rel, name, kind: 'file', size: s.size })
      }
    }
  }

  walk(claudeDir, 0)

  // 项目根的 CLAUDE.md 也归这一栏管 —— 它是「这个项目怎么跟 AI 协作」的入口
  const { rootMemo } = allowedRoots(projectPath)
  if (existsSync(rootMemo)) {
    out.push({ path: 'CLAUDE.md', name: 'CLAUDE.md', kind: 'file', size: statSync(rootMemo).size, atRoot: true })
  }

  return out
}

export function readClaudeFile(projectPath: string, relPath: string): string | null {
  const target = resolveInScope(projectPath, relPath)
  if (!target || !existsSync(target)) return null
  try {
    return readFileSync(target, 'utf8')
  } catch {
    return null
  }
}

/**
 * JSON 写坏要在**保存前**拦住并指出行号(§10)。
 * `.claude/settings.json` 写坏会让 Claude Code 在这个项目里行为异常,
 * 而错误只会在下次启动时才暴露 —— 那时人已经不知道是这一步改坏的。
 */
export function validateJson(content: string): { line: number; message: string } | null {
  try {
    JSON.parse(content)
    return null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // 老版 V8 报 "at position N",新版不报了,只给一段上下文片段:
    //   Unexpected token ',', ..."allow": [,\n  }\n}" is not valid JSON
    // 所以两种都试:先看有没有 position,没有就把那段片段拿去原文里定位。
    const at = /at position (\d+)/.exec(message)
    if (at) {
      return { line: content.slice(0, Number(at[1])).split('\n').length, message }
    }

    const snippet = /"([\s\S]*)" is not valid JSON$/.exec(message)?.[1]?.replace(/^\.{3}/, '')
    if (snippet) {
      const idx = content.indexOf(snippet)
      // 片段是错误附近的一个窗口,给出它开头所在的行 —— 目的是把人带到那一带,
      // 不是精确到字符
      if (idx >= 0) return { line: content.slice(0, idx).split('\n').length, message }
    }

    const lineMatch = /line (\d+)/i.exec(message)
    return { line: lineMatch ? Number(lineMatch[1]) : 1, message }
  }
}

export function writeClaudeFile(
  projectPath: string,
  relPath: string,
  content: string,
): SaveResult {
  const target = resolveInScope(projectPath, relPath)
  if (!target) return { ok: false, reason: 'out-of-scope' }

  if (/\.json$/i.test(relPath)) {
    const bad = validateJson(content)
    if (bad) return { ok: false, reason: 'invalid-json', line: bad.line, message: bad.message }
  }

  try {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      reason: 'write-failed',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}
