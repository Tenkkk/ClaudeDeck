import { useEffect, useRef, useState } from 'react'
import type { AppConfig, DoctorReport } from '../../../shared/ipc.js'

const INSTALL_COMMAND = 'npm install -g @anthropic-ai/claude-code'

/**
 * 屏幕 B · 首次配置 —— 设计终稿 §03。
 * 评委看到的第一屏。只在缺 CLI 或想改凭据时出现,装好之后不再拦人。
 */
export default function Onboarding({
  doctor,
  config,
  onDone,
}: {
  doctor: DoctorReport | null
  config: AppConfig | null
  onDone: () => void | Promise<void>
}): React.JSX.Element {
  const [installing, setInstalling] = useState(false)
  const [log, setLog] = useState('')
  const [failed, setFailed] = useState(false)
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [copied, setCopied] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  // §03:日志区自动滚到底
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [log])

  async function install(): Promise<void> {
    setInstalling(true)
    setFailed(false)
    setLog('')
    const result = await window.api.doctor.install()
    setLog(result.output)
    setFailed(!result.ok)
    setInstalling(false)
    if (result.ok) await onDone()
  }

  const found = doctor?.cliFound === true

  return (
    <div className="screen-center">
      <div className="card">
        <div className="brand">
          <span className="brand-dot" />
          ClaudeDeck
        </div>
        <h1>第一次使用,先配两件事</h1>

        <section>
          <div className="step-label">
            <span className="step-num">01</span>
            <span className="step-title">Claude Code 命令行</span>
            {found ? (
              <span className="badge ok">已检测到 {doctor?.cliVersion}</span>
            ) : failed ? (
              <span className="badge warn">装不上</span>
            ) : (
              <span className="badge">未检测到</span>
            )}
          </div>

          {!found && (
            <>
              <p className="hint" style={{ margin: 0 }}>
                {failed
                  ? 'npm 没能连上仓库。挂代理或换镜像后重试,也可以自己在终端里装完再回来。'
                  : 'ClaudeDeck 通过官方 Agent SDK 驱动 Claude Code,必须先装它。'}
              </p>
              <div className="cmd-row">
                <code>{INSTALL_COMMAND}</code>
                <button
                  className="ghost"
                  onClick={async () => {
                    await navigator.clipboard.writeText(INSTALL_COMMAND)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1600)
                  }}
                >
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
              <div>
                <button className="primary" disabled={installing} onClick={install}>
                  {installing ? '安装中…' : failed ? '重试' : '一键安装'}
                </button>
              </div>
              {log && (
                <div className="log" ref={logRef}>
                  {log}
                </div>
              )}
            </>
          )}
        </section>

        <section>
          <div className="step-label">
            <span className="step-num">02</span>
            <span className="step-title">凭据</span>
            <span className="badge">可选</span>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            留空就沿用你在终端里已登录的账号。填了会覆盖它。
          </p>
          <input
            placeholder="ANTHROPIC_BASE_URL(如使用中转端点)"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <input
            type="password"
            placeholder="API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <div className="trust">
            <span className="brand-dot" />
            <span>
              <strong>Key 不会明文落盘。</strong>
              交给 Windows 凭据管理(DPAPI)加密后保存,不写进配置文件,也不会传给界面层。
            </span>
          </div>
        </section>

        <button
          className="primary"
          onClick={async () => {
            await window.api.config.update({ baseUrl })
            if (apiKey) await window.api.config.setApiKey(apiKey)
            await onDone()
          }}
        >
          保存并继续
        </button>
      </div>
    </div>
  )
}
