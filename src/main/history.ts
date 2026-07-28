/**
 * 从 store 重建历史时,把 CLI 存下来的原始形态还原成人看的样子。
 *
 * 斜杠命令在写进会话文件之前会被展开成一段标记:
 *
 * ```
 * <command-name>/config</command-name>
 *         <command-message>config</command-message>
 *         <command-args></command-args>
 * ```
 *
 * 直播时界面显示的是你打的那行 `/config`,切走再切回来就变成上面这一坨 ——
 * 同一条消息两副面孔。这里把它还原回 `/config`。
 *
 * 认不出格式就原样返回:宁可显示得朴素一点,也不能把内容吃掉。
 */
const NAME = /<command-name>([\s\S]*?)<\/command-name>/
const ARGS = /<command-args>([\s\S]*?)<\/command-args>/

export function unexpandSlashCommand(text: string): string {
  const name = NAME.exec(text)?.[1]?.trim()
  if (!name) return text

  const args = ARGS.exec(text)?.[1]?.trim() ?? ''
  // CLI 存的 name 有时带斜杠有时不带,统一补上
  const slash = name.startsWith('/') ? name : `/${name}`
  return args ? `${slash} ${args}` : slash
}
