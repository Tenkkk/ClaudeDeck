import pkg from 'electron-updater'
import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import type { UpdateState } from '../shared/ipc.js'

// electron-updater 是 CommonJS,具名导入在 ESM 下拿不到
const { autoUpdater } = pkg

/**
 * 应用内更新 —— 走 GitHub Releases。
 *
 * ## 为什么是「增量」
 *
 * 打包时 electron-builder 会同时产出 `latest.yml` 和 `.exe.blockmap`,
 * 两者都随 Release 一起发布。blockmap 把安装包切成块并记下每块的哈希,
 * electron-updater 拿新旧两份 blockmap 一比,只下载变了的块 ——
 * 153 MB 的包,改几行代码往往只需要下几 MB。
 * 差分失败(比如本地那份包被改过)时它会自动退回整包下载,不会卡死。
 *
 * ## 三条刻意的选择
 *
 * - **不自动下载。** 153 MB 的东西不该在人不知情时占带宽。检查是主动的,
 *   下载要点一下,装要再点一下。
 * - **不自动重启。** 正聊着一半被重启,比晚一天更新糟糕得多。
 * - **开发态直接说明,不假装。** 未打包时 electron-updater 会抛
 *   「dev-app-update.yml not found」,那不是错误,是它本来就只对安装版生效。
 */
export class Updater {
  private state: UpdateState = { phase: 'idle', current: app.getVersion() }

  constructor(private readonly send: (state: UpdateState) => void) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    // 日志走主进程的 stderr 即可,不引 electron-log 再多一个依赖
    autoUpdater.logger = null

    autoUpdater.on('download-progress', (p) => {
      this.set({
        phase: 'downloading',
        percent: Math.round(p.percent),
        // 差分下载时 total 是「实际要传的字节」,不是安装包大小 ——
        // 这正是能看出增量生效了的地方
        transferredMb: Math.round((p.transferred / 1024 / 1024) * 10) / 10,
        totalMb: Math.round((p.total / 1024 / 1024) * 10) / 10,
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      this.set({ phase: 'ready', version: info.version })
    })

    autoUpdater.on('error', (err) => {
      this.set({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    })
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch, current: app.getVersion() }
    this.send(this.state)
  }

  current(): UpdateState {
    return this.state
  }

  async check(): Promise<UpdateState> {
    if (!app.isPackaged) {
      this.set({
        phase: 'error',
        message: '开发模式下不检查更新 —— 更新只对安装版生效。',
      })
      return this.state
    }

    this.set({ phase: 'checking', message: undefined })
    try {
      const result = await autoUpdater.checkForUpdates()
      const latest = result?.updateInfo.version
      // updateInfo 里永远有版本号;是否比当前新由 electron-updater 判断,
      // 它没触发 update-available 就说明已经是最新
      if (latest && latest !== app.getVersion()) {
        this.set({ phase: 'available', version: latest, notes: releaseNotes(result?.updateInfo) })
      } else {
        this.set({ phase: 'latest' })
      }
    } catch (err) {
      this.set({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    return this.state
  }

  async download(): Promise<void> {
    if (this.state.phase !== 'available') return
    this.set({ phase: 'downloading', percent: 0 })
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      this.set({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  /** 装完会退出并重启,所以只在 ready 之后可用 */
  install(): void {
    if (this.state.phase !== 'ready') return
    autoUpdater.quitAndInstall()
  }
}

/** 发布说明可能是字符串,也可能是一组条目,取决于 provider */
function releaseNotes(info: { releaseNotes?: string | { note?: string | null }[] | null } | undefined): string | undefined {
  const raw = info?.releaseNotes
  if (typeof raw === 'string') return stripHtml(raw).slice(0, 600)
  if (Array.isArray(raw)) {
    return stripHtml(raw.map((n) => n?.note ?? '').join('\n')).slice(0, 600)
  }
  return undefined
}

/** GitHub 的发布说明是 HTML。这里只做纯文本展示,不渲染 —— 内容来自网络 */
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

export function bindUpdater(win: BrowserWindow | null): Updater {
  return new Updater((state) => win?.webContents.send('update:state', state))
}
