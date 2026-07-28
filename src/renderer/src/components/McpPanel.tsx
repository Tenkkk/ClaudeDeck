import type { McpServer } from '../../../shared/ipc.js'

/**
 * `/mcp` 的结果面板。
 *
 * 之前这条命令是把文本发给 CLI、拿回一段纯文本 —— 那是 CLI 给 SDK 宿主的
 * **降级回复**,它自己在末尾就写着「详情请去终端看」。把降级回复当成功能,
 * 等于把「我没做」包装成「做了」。
 *
 * 现在数据来自 `mcpServerStatus()`:名字、状态、失败原因、来源、工具数,
 * SDK 全都给了。
 *
 * 状态标记不用 emoji —— 打包的四套拉丁字体没有那些字形,靠系统回落会出豆腐块。
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

export default function McpPanel({
  servers,
  onReconnect,
}: {
  servers: McpServer[]
  onReconnect: (name: string) => void
}): React.JSX.Element {
  if (servers.length === 0) {
    return (
      <div className="mcp-panel">
        <div className="card-label">MCP 服务</div>
        <div className="hint">这个会话没有配置任何 MCP 服务。</div>
      </div>
    )
  }

  // 按来源分组,组内保持 SDK 给的顺序
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

      {scopes.map((scope) => (
        <div key={scope} className="mcp-group">
          <div className="pop-group">{SCOPE[scope] ?? scope}</div>
          {servers
            .filter((s) => (s.scope ?? '其他') === scope)
            .map((s) => {
              const st = STATUS[s.status]
              return (
                <div key={s.name} className="mcp-row">
                  <span className={`mcp-dot ${st.tone}`} />
                  <span className="mcp-name">{s.name}</span>
                  <span className={`mcp-status ${st.tone}`}>{st.label}</span>
                  {s.status === 'connected' && (
                    <span className="mcp-tools">{s.toolCount} 个工具</span>
                  )}
                  {/* 连不上才给重连 —— 好着的服务不需要这颗按钮 */}
                  {(s.status === 'failed' || s.status === 'needs-auth') && (
                    <button className="mcp-action" onClick={() => onReconnect(s.name)}>
                      重连
                    </button>
                  )}
                  {s.error && <div className="mcp-error">{s.error}</div>}
                </div>
              )
            })}
        </div>
      ))}
    </div>
  )
}
