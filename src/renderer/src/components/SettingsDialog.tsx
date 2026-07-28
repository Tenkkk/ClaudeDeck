import { useEffect, useState } from 'react'
import { CheckIcon } from './Icons.js'
import { THEME_OPTIONS } from '../../../shared/ipc.js'
import type { AccountInfo, AppConfig, DoctorReport, ThemePref, Versions } from '../../../shared/ipc.js'

/**
 * 系统设置。
 *
 * 原来只有齿轮上挂的一个小浮窗(主题 + 版本),而「这个应用到底在用哪一份
 * Claude Code」「中转端点填的是什么」这些既看不到也改不了 —— 出问题时
 * 只能去翻配置文件。
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
  versions,
  account,
  onClose,
  onTheme,
  onSaveCredentials,
}: {
  config: AppConfig | null
  doctor: DoctorReport | null
  versions: Versions | null
  account: AccountInfo | null
  onClose: () => void
  onTheme: (t: ThemePref) => void
  onSaveCredentials: (baseUrl: string, apiKey: string | null) => Promise<void>
}): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => setBaseUrl(config?.baseUrl ?? ''), [config?.baseUrl])

  const source =
    doctor?.cliSource === 'bundled'
      ? '随安装包分发'
      : doctor?.cliSource === 'path'
        ? '系统 PATH 上的全局安装'
        : '未知'

  return (
    <div className="dialog-veil" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <strong>设置</strong>
          <button className="ghost icon-btn" title="关闭" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="dialog-body">
          {/* ---- Claude Code ---- */}
          <div className="pop-group">Claude Code</div>
          <div className="set-row">
            <span className="set-label">状态</span>
            <span className={doctor?.cliFound ? 'set-ok' : 'set-bad'}>
              {doctor?.cliFound ? `可用 · ${doctor.cliVersion ?? '版本未知'}` : '不可用'}
            </span>
          </div>
          <div className="set-row">
            <span className="set-label">来源</span>
            <span className="set-value">{source}</span>
          </div>
          {doctor?.cliPath && (
            <div className="set-row">
              <span className="set-label">可执行文件</span>
              <span className="set-value mono set-path" title={doctor.cliPath}>
                {doctor.cliPath}
              </span>
            </div>
          )}
          {doctor?.cliError && <div className="set-note set-bad">{doctor.cliError}</div>}
          <div className="set-note">
            版本必须与 Agent SDK 对齐,所以优先用随包分发的那份;缺失时才回退到 PATH。
          </div>

          {/* ---- 凭据 ---- */}
          <div className="ctx-sep" />
          <div className="pop-group">API 端点与密钥</div>
          <div className="set-note">
            留空则沿用你在终端里 `claude` 登录过的凭据。填了就用这一组,
            应用不会改动你终端里的登录状态。
          </div>
          <label className="set-field">
            <span className="set-label">Base URL</span>
            <input
              value={baseUrl}
              placeholder="https://api.anthropic.com"
              onChange={(e) => {
                setBaseUrl(e.target.value)
                setSaved(false)
              }}
            />
          </label>
          <label className="set-field">
            <span className="set-label">API Key</span>
            <input
              type="password"
              value={apiKey}
              placeholder={config?.hasApiKey ? '已保存 · 重填即覆盖' : '未设置'}
              onChange={(e) => {
                setApiKey(e.target.value)
                setSaved(false)
              }}
            />
          </label>
          <div className="set-note">
            密钥经 Electron safeStorage(Windows 上是 DPAPI)加密后落盘,明文不出主进程 ——
            所以上面读不回已保存的值,只能重填或清除。
          </div>
          <div className="row set-actions">
            <button
              className="primary"
              disabled={saving}
              onClick={async () => {
                setSaving(true)
                // 密钥留空表示「不动」,不是「清空」—— 清空有单独的按钮
                await onSaveCredentials(baseUrl.trim(), apiKey.trim() || null)
                setApiKey('')
                setSaving(false)
                setSaved(true)
              }}
            >
              {saving ? '保存中…' : '保存'}
            </button>
            {config?.hasApiKey && (
              <button
                disabled={saving}
                onClick={async () => {
                  setSaving(true)
                  await onSaveCredentials(baseUrl.trim(), '')
                  setSaving(false)
                  setSaved(true)
                }}
              >
                清除密钥
              </button>
            )}
            {saved && <span className="hint">已保存,下次新建会话生效</span>}
          </div>

          {/* ---- 主题 ---- */}
          <div className="ctx-sep" />
          <div className="pop-group">主题</div>
          {THEME_OPTIONS.map((t) => (
            <button
              key={t.value}
              className={`pop-row${t.value === config?.theme ? ' current' : ''}`}
              onClick={() => onTheme(t.value)}
            >
              <span className="pop-check">
                {t.value === config?.theme ? <CheckIcon size={9} /> : ''}
              </span>
              <span className="pop-body">
                <span className="pop-title">{t.label}</span>
              </span>
            </button>
          ))}

          {/* ---- 账号与版本 ---- */}
          <div className="ctx-sep" />
          <div className="pop-group">关于</div>
          {account?.email && (
            <div className="set-row">
              <span className="set-label">账号</span>
              <span className="set-value">{account.email}</span>
            </div>
          )}
          {account?.organization && (
            <div className="set-row">
              <span className="set-label">组织</span>
              <span className="set-value">{account.organization}</span>
            </div>
          )}
          {account?.subscriptionType && (
            <div className="set-row">
              <span className="set-label">订阅</span>
              <span className="set-value">{account.subscriptionType}</span>
            </div>
          )}
          <div className="set-row">
            <span className="set-label">版本</span>
            <span className="set-value mono">
              ClaudeDeck {versions?.app ?? '—'}
              {versions?.cli ? ` · Claude Code ${versions.cli}` : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
