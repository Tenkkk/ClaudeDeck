import { useEffect, useState } from 'react'
import type { AgentInfo } from '../../../shared/ipc.js'

/**
 * `/agents` —— 本会话可用的子 Agent。
 *
 * `supportedAgents()` 一直在那儿,界面里此前完全没有。子 Agent 决定了 Claude
 * 会把活分给谁、用哪个模型跑,是「这次会话到底带着什么家伙」的一部分。
 */
export default function AgentsPanel(): React.JSX.Element {
  const [agents, setAgents] = useState<AgentInfo[] | null>(null)

  useEffect(() => {
    void window.api.chat.agents().then(setAgents)
  }, [])

  if (agents === null) {
    return (
      <div className="mcp-panel">
        <div className="card-label">子 Agent</div>
        <div className="hint">正在读取…</div>
      </div>
    )
  }

  if (agents.length === 0) {
    return (
      <div className="mcp-panel">
        <div className="card-label">子 Agent</div>
        <div className="hint">这个会话没有可用的子 Agent。</div>
      </div>
    )
  }

  return (
    <div className="mcp-panel">
      <div className="mcp-head">
        <span className="card-label">子 Agent</span>
        <span className="hint">{agents.length} 个</span>
      </div>
      {agents.map((a) => (
        <div key={a.name} className="agent-row">
          <div className="agent-head">
            <span className="mcp-name">{a.name}</span>
            {/* 没写模型就是跟随主对话,那正是要说清楚的事 */}
            <span className="mcp-tools">{a.model ?? '跟随当前模型'}</span>
          </div>
          <div className="agent-desc">{a.description}</div>
        </div>
      ))}
    </div>
  )
}
