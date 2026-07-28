import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SlashCommandItem } from '../shared/ipc.js'

/**
 * 给斜杠命令标来源 —— 设计终稿 §15 要按「内置 / 项目命令 / Skill」分三组。
 *
 * SDK 的 SlashCommand 只有 name / description / argumentHint / aliases,
 * **没有来源字段**。但项目命令和 skill 都躺在项目的 .claude 下,读目录就是
 * 权威答案 —— 这不是猜,是查。查不到的归「内置」。
 *
 * 界面不写死任何一条命令,只按这里标出来的来源分组。
 */

function namesIn(dir: string, mode: 'file' | 'dir'): Set<string> {
  const out = new Set<string>()
  if (!existsSync(dir)) return out
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const s = statSync(full)
      if (mode === 'dir' && s.isDirectory()) out.add(entry)
      else if (mode === 'file' && s.isFile()) out.add(entry.replace(/\.[^.]+$/, ''))
    }
  } catch {
    // 目录读不动就当没有,不该因此让整个命令面板打不开
  }
  return out
}

export function annotateSources(
  commands: { name: string; description: string; argumentHint: string; aliases?: string[] }[],
  projectPath: string | null,
): SlashCommandItem[] {
  const projectCommands = projectPath
    ? namesIn(join(projectPath, '.claude', 'commands'), 'file')
    : new Set<string>()
  const skills = projectPath ? namesIn(join(projectPath, '.claude', 'skills'), 'dir') : new Set<string>()

  return commands.map((c) => ({
    name: c.name,
    description: c.description,
    argumentHint: c.argumentHint,
    aliases: c.aliases,
    source: projectCommands.has(c.name) ? 'project' : skills.has(c.name) ? 'skill' : 'builtin',
  }))
}
