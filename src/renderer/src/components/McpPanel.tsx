import { useCallback, useEffect, useState } from 'react'
import { CaretIcon } from './Icons.js'
import type { McpServer } from '../../../shared/ipc.js'

/**
 * `/mcp` 的服务面板 —— 可以点进去。
 *
 * 原生的 `/mcp` 是能按回车进某个服务、看它的工具、启停、重连的。SDK 把这些
 * 全给了:`mcpServerStatus()` 返回每个服务的 `tools[]`(带只读 / 破坏性标注),
 * `reconnectMcpServer` 和 `toggleMcpServer` 是公开方法。
 *
 * **数据由这个组件自己取、自己刷。** 放在 transcript 里当静态数据的话,
 * 点完「重连」画面还停在旧状态上 —— 那种「按钮点了像没点」的感觉比不做还糟。
 */
const STATUS: Record<McpServer['status'], { label: string; tone: string }> = {
  connected: { label: '已连接', tone: 'ok' },
  failed: { label: '连接失败', tone: 'bad' },
  'needs-auth': { label: '需要授权', tone: 'warn' },
  pending: { label: '连接中', tone: 'muted' },
  disabled: { label: '已停用', tone: 'muted' },
}

/** 来源的中文名。认不出的原样显示,不猜 */
const SCOPE: Record<string, string> = {
  user: '用户级',
  project: '项目级',
  local: '本地',
  claudeai: 'claude.ai',
  managed: '受管',
}

export default function McpPanel(): React.JSX.Element {
  const [servers, setServers] = useState<McpServer[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setServers(await window.api.chat.mcp())
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** 动作跑完必须重新取一次状态 —— 否则界面还是旧的 */
  const act = useCallback(
    async (name: string, run: () => Promise<string | null>) => {
      setBusy(name)
      setError(null)
      const err = await run()
      if (err) setError(`${name}:${err}`)
      await load()
      setBusy(null)
    },
    [load],
  )

  if (servers === null) {
    return (
      <div className="mcp-panel">
        <div className="card-label">MCP 服务</div>
        <div className="hint">正在读取…</div>
      </div>
    )
  }

  if (servers.length === 0) {
    return (
      <div className="mcp-panel">
        <div className="card-label">MCP 服务</div>
        <div className="hint">这个会话没有配置任何 MCP 服务。</div>
      </div>
    )
  }

  const scopes = [...new Set(servers.map((s) => s.scope ?? '其他'))]
  const connected = servers.filter((s) => s.status === 'connected').length

  return (
    <div className="mcp-panel">
      <div className="mcp-head">
        <span className="card-label">MCP 服务</span>
        <span className="hint">
          {servers.length} 个 · {connected} 个已连接
        </span>
      </div>

      {error && <div className="mcp-error">{error}</div>}

      {scopes.map((scope) => (
        <div key={scope} className="mcp-group">
          <div className="pop-group">{SCOPE[scope] ?? scope}</div>
          {servers
            .filter((s) => (s.scope ?? '其他') === scope)
            .map((s) => {
              const st = STATUS[s.status]
              const expanded = open === s.name
              const canOpen = s.tools.length > 0
              return (
                <div key={s.name} className={`mcp-item${expanded ? ' open' : ''}`}>
                  <div className="mcp-row">
                    <button
                      className="mcp-main"
                      disabled={!canOpen}
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : s.name)}
                    >
                      {/* 没有工具可看的服务不给箭头 —— 免得点了没反应 */}
                      {canOpen ? (
                        <CaretIcon size={11} className={expanded ? 'mcp-caret open' : 'mcp-caret'} />
                      ) : (
                        <span className="mcp-caret-space" />
                      )}
                      <span className={`mcp-dot ${st.tone}`} />
                      <span className="mcp-name">{s.name}</span>
                      <span className={`mcp-status ${st.tone}`}>{st.label}</span>
                      {s.tools.length > 0 && (
                        <span className="mcp-tools">{s.tools.length} 个工具</span>
                      )}
                    </button>

                    <span className="mcp-actions">
                      {(s.status === 'failed' || s.status === 'needs-auth') && (
                        <button
                          className="mcp-action"
                          disabled={busy === s.name}
                          onClick={() => void act(s.name, () => window.api.chat.mcpReconnect(s.name))}
                        >
                          {busy === s.name ? '…' : '重连'}
                        </button>
                      )}
                      <button
                        className="mcp-action"
                        disabled={busy === s.name}
                        onClick={() =>
                          void act(s.name, () =>
                            window.api.chat.mcpToggle(s.name, s.status === 'disabled'),
                          )
                        }
                      >
                        {s.status === 'disabled' ? '启用' : '停用'}
                      </button>
                    </span>
                  </div>

                  {s.error && <div className="mcp-error">{s.error}</div>}

                  {expanded && (
                    <div className="mcp-tool-list">
                      {s.tools.map((t) => (
                        <div key={t.name} className="mcp-tool">
                          <span className="mcp-tool-name">{t.name}</span>
                          {/* 只读 / 破坏性是服务自己声明的标注,批准前值得看见 */}
                          {t.readOnly && <span className="mcp-tag">只读</span>}
                          {t.destructive && <span className="mcp-tag bad">有破坏性</span>}
                          {t.description && (
                            <span className="mcp-tool-desc">{firstLine(t.description)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
        </div>
      ))}
    </div>
  )
}

/** 工具描述常常是一整段,列表里只取第一句 */
function firstLine(text: string): string {
  const line = text.trim().split('\n')[0]
  return line.length > 90 ? `${line.slice(0, 90)}…` : line
}
