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

/**
 * CLI 会把一些自己生成的记录以 user 角色写进会话文件:本地命令的输出、
 * 压缩后的接续前言、后台任务通知……直播时界面上从没画过它们,回放时照画
 * 就是一串凭空多出来的「用户气泡」。更要命的是 id:每多一条幽灵气泡,
 * 其后所有消息的 uuid 都可能对错一位,而这些 id 是分支与文件回退的靶子。
 *
 * SDK 的 getSessionMessages 已经滤掉了 isMeta / isSidechain / teamName,
 * 但下面这些**只能按内容认**(返回的对象上没有对应标志):
 *
 * - 「命令对」(<command-name> + <command-message>)**不算幽灵**:那是用户
 *   真敲过的命令,unexpandSlashCommand 会把它还原成 `/cmd` 显示;
 * - 只有 <command-name> 没有 <command-message> 的记录是 CLI 注入的;
 * - 压缩前言以固定句式开头,整段是机器写给模型的,不是人说的话。
 */
export function isInjectedUserText(text: string): boolean {
  if (text.includes('<command-name>') && text.includes('<command-message>')) return false
  if (text.startsWith('This session is being continued from a previous conversation')) return true
  if (text.includes('<command-name>')) return true
  if (text.includes('<local-command-stdout>') || text.includes('<local-command-stderr>')) return true
  if (text.includes('<task-notification>')) return true
  return false
}
