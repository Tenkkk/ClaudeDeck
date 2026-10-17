import { useEffect, useRef, useState } from 'react'
import type { AppConfig, DoctorReport, UpdateState } from '../../../shared/ipc.js'

/**
 * 更新那一节。
 *
 * 检查、下载、安装分成三次点击 —— 153 MB 的东西不该在人不知情时占带宽,
 * 正聊着一半被重启更是不能接受。
 *
 * 下载时显示的是**实际传输量**:差分更新只传变化的块,那个数字明显小于
 * 安装包大小,也就成了「增量确实生效了」最直接的证据。
 */
function UpdateSection({ state }: { state: UpdateState | null }): React.JSX.Element {
  const phase = state?.phase ?? 'idle'

  if (phase === 'downloading') {
    return (
      <>
        <div className="ctx-limit">
          <div className="ctx-limit-head">
            <span>正在下载 {state?.version ?? ''}</span>
            <span className="ctx-tokens">{state?.percent ?? 0}%</span>
          </div>
          <div className="ctx-limit-bar" role="progressbar" aria-label="更新下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state?.percent ?? 0}>
            <span style={{ width: `${state?.percent ?? 0}%` }} />
          </div>
          {state?.totalMb !== undefined && (
            <div className="hint">
              {state.transferredMb} / {state.totalMb} MB —— 只传有变化的部分
            </div>
          )}
        </div>
      </>
    )
  }

  return (
    <>
      {phase === 'available' && (
        <>
          <div className="set-row">
            <span className="set-label">新版本</span>
            <span className="set-value">{state?.version}</span>
          </div>
          {state?.notes && <div className="set-note">{state.notes}</div>}
        </>
      )}
      {phase === 'latest' && <div className="set-note">已经是最新版本。</div>}
      {phase === 'ready' && (
        <div className="set-note set-ok">{state?.version} 已下载完毕,重启即可完成安装。</div>
      )}
      {phase === 'error' && <div className="set-note set-bad">{state?.message}</div>}

      <div className="row set-actions update-actions">
        {phase === 'ready' ? (
          <button className="primary" onClick={() => void window.api.update.install()}>
            重启并安装
          </button>
        ) : phase === 'available' ? (
          <button className="primary" onClick={() => void window.api.update.download()}>
            下载更新
          </button>
        ) : (
          <button disabled={phase === 'checking'} onClick={() => void window.api.update.check()}>
            {phase === 'checking' ? '检查中…' : '检查更新'}
          </button>
        )}
      </div>
    </>
  )
}

/**
 * 系统设置。
 *
 * 只管一件事:**这个应用怎么连上 Claude Code**。接管的是哪一份可执行文件、
 * 走哪个端点、用哪把密钥。这些原本既看不到也改不了,出问题只能去翻配置文件。
 *
 * 主题和账号不在这儿 —— 那是「看着舒不舒服」和「我是谁」,跟着侧栏底部
 * 那颗按钮走。两件事混在一屏里,找哪个都要先扫一遍。
 *
 * ## API Key 不回读
 *
 * 主进程只回报 hasApiKey 这个布尔,明文永远不经 IPC(safeStorage 加密落盘)。
 * 所以这里显示的是「已保存」,不是掩码后的值 —— 掩码会让人以为读得回来。
 * 要换就重填,要清就点清除。
 */
export default function SettingsDialog({
  config,
  doctor,
  onClose,
  onSaveCredentials,
}: {
  config: AppConfig | null
  doctor: DoctorReport | null
  onClose: () => void
  onSaveCredentials: (baseUrl: string, apiKey: string | null) => Promise<void>
}): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [section, setSection] = useState<'connection' | 'runtime' | 'about'>('connection')
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const submitting = useRef(false)

  useEffect(() => {
    const dialog = dialogRef.current
    const previous = document.activeElement as HTMLElement | null
    dialog?.showModal()
    return () => {
      dialog?.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  useEffect(() => setBaseUrl(config?.baseUrl ?? ''), [config?.baseUrl])

  // 打开设置时取一次当前状态,之后跟着主进程推的进度走
  useEffect(() => {
    void window.api.update.state().then(setUpdate)
    return window.api.update.onState(setUpdate)
  }, [])

  const source =
    doctor?.cliSource === 'bundled'
      ? '随安装包分发'
      : doctor?.cliSource === 'path'
        ? '系统 PATH 上的全局安装'
        : '未知'

  async function save(clear = false): Promise<void> {
    if (submitting.current) return
    submitting.current = true
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      // 留空不动原密钥;清除仍使用独立入口,不改变 IPC 约定。
      await onSaveCredentials(baseUrl.trim(), clear ? '' : apiKey.trim() || null)
      setApiKey('')
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败,请重试。')
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return (
    <dialog ref={dialogRef} className="dialog settings-dialog" aria-labelledby="settings-title"
      onCancel={(e) => { e.preventDefault(); onClose() }}
      onKeyDown={(e) => {
        if (e.key !== 'Tab') return
        const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary')]
          .filter((control) => control.getClientRects().length > 0)
        const target = e.shiftKey && document.activeElement === controls[0] ? controls.at(-1)
          : !e.shiftKey && document.activeElement === controls.at(-1) ? controls[0] : null
        if (target) { e.preventDefault(); target.focus() }
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return
        const bounds = e.currentTarget.getBoundingClientRect()
        if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) onClose()
      }}>
      <div className="dialog-head">
        <div><h1 id="settings-title">设置</h1><p>管理连接、运行环境与应用更新</p></div>
        <button autoFocus className="ghost icon-btn" aria-label="关闭设置" title="关闭" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg>
        </button>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分类">
          {([
            ['connection', '连接配置'], ['runtime', '运行环境'], ['about', '关于与更新'],
          ] as const).map(([value, label]) => <button key={value} aria-current={section === value ? 'page' : undefined}
            onClick={() => setSection(value)}>{label}</button>)}
          <span className="settings-nav-note">ClaudeDeck</span>
        </nav>
        <div className="settings-content">
          <div className="dialog-body">
            {section === 'connection' && <section aria-labelledby="settings-connection-title">
              <div className="settings-section-head"><h2 id="settings-connection-title">连接配置</h2><p>设置 Claude Code 使用的 API 端点与密钥。</p></div>
              <form id="settings-connection" onSubmit={(e) => { e.preventDefault(); void save() }}>
                <label className="set-field">
                  <span className="set-label">Base URL <small>可选</small></span>
                  <input value={baseUrl} placeholder="https://api.anthropic.com" disabled={saving} spellCheck={false}
                    onChange={(e) => { setBaseUrl(e.target.value); setSaved(false); setError(null) }} />
                  <span className="set-field-hint">留空沿用 Claude Code 的端点配置。</span>
                </label>
                <label className="set-field">
                  <span className="set-label">API Key <small>{config?.hasApiKey ? '已保存' : '未设置'}</small></span>
                  <input type="password" value={apiKey} placeholder={config?.hasApiKey ? '输入新密钥以替换' : '输入 API 密钥（可选）'}
                    autoComplete="off" disabled={saving}
                    onChange={(e) => { setApiKey(e.target.value); setSaved(false); setError(null) }} />
                  <span className="set-field-hint">留空不修改已保存密钥;未设置时沿用终端登录凭据。</span>
                </label>
              </form>
              <details className="settings-details"><summary>凭据与安全</summary>
                <p>不会修改终端的登录状态。密钥通过 Electron safeStorage（Windows DPAPI）加密保存,已保存的密钥不会回传到界面。更换请重填,移除请使用“清除密钥”。</p>
              </details>
            </section>}
            {section === 'runtime' && <section aria-labelledby="settings-runtime-title">
              <div className="settings-section-head"><h2 id="settings-runtime-title">运行环境</h2><p>查看应用实际使用的 Claude Code。</p></div>
              <div className="settings-card">
                <div className="settings-runtime-head"><strong>Claude Code</strong><span className={`settings-status ${doctor?.cliFound ? 'set-ok' : 'set-bad'}`}>{doctor?.cliFound ? '可用' : '不可用'}</span></div>
                <div className="set-row"><span className="set-label">版本</span><span className="set-value mono">{doctor?.cliVersion ?? '未知'}</span></div>
                <div className="set-row"><span className="set-label">来源</span><span className="set-value">{source}</span></div>
              </div>
              {doctor?.cliError && <p className="set-note set-bad" role="alert">{doctor.cliError}</p>}
              <details className="settings-details"><summary>可执行文件与版本说明</summary>
                {doctor?.cliPath && <p className="mono set-path">{doctor.cliPath}</p>}
                <p>Claude Code 版本需与 Agent SDK 对齐。优先使用随安装包分发的版本,缺失时才回退到系统 PATH。</p>
              </details>
            </section>}
            {section === 'about' && <section aria-labelledby="settings-about-title">
              <div className="settings-section-head"><h2 id="settings-about-title">关于与更新</h2><p>查看当前版本,按需检查与安装更新。</p></div>
              <div className="settings-card"><div className="settings-runtime-head"><strong>ClaudeDeck</strong><span className="settings-version mono">{update?.current ?? '—'}</span></div><p>Claude Code 的桌面聊天工作区</p></div>
              <div className="settings-update"><h3>应用更新</h3><p className="set-note">不会自动下载或重启。安装更新前,请先结束正在执行的任务。</p><UpdateSection state={update} /></div>
            </section>}
          </div>
          <footer className="settings-footer">
            {section === 'connection' ? <>
              <div className="settings-save-status">{error ? <span className="set-bad" role="alert">{error}</span> : <span role="status">{saving ? '正在保存连接配置…' : saved ? '已保存,下次新建会话生效' : '更改将在下次新建会话生效'}</span>}</div>
              <div className="settings-footer-actions">
                {config?.hasApiKey && <button className="ghost" disabled={saving} onClick={() => void save(true)}>清除密钥</button>}
                <button className="primary" form="settings-connection" type="submit" disabled={saving}>{saving ? '保存中…' : '保存'}</button>
              </div>
            </> : <><span className="settings-footer-note">仅影响应用配置,不会修改项目文件</span><button onClick={onClose}>完成</button></>}
          </footer>
        </div>
      </div>
  </dialog>
  )
}
