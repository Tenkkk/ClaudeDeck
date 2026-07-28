import { useState } from 'react'

/**
 * 一条消息 —— 设计终稿 §06。
 *
 * 用户靠右有气泡、Claude 靠左无气泡,**署名删掉** —— 左右分侧本身就说明了
 * 谁在说话,再写一遍是冗余。
 *
 * 动作行只在悬停时出现,但下面**常留 20px 空槽**(样式在 .msg-slot),
 * 所以悬停不会让后面的内容跳动。正在输出的那条不出动作行 —— 半截文本
 * 复制过去没意义。
 *
 * 「编辑并重发 ↳」「从这里重答 ↳」走 forkSession —— 见 ForkDialog(§12)。
 */
export default function Message({
  role,
  text,
  ts,
  id,
  onFork,
}: {
  role: 'user' | 'assistant'
  text: string
  ts?: number
  id?: string
  onFork?: (id: string) => void
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const time = ts
    ? new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    : null

  return (
    <div className={`msg-wrap${role === 'user' ? ' user' : ''}`}>
      <div className={role === 'user' ? 'msg-user' : 'msg-claude'}>{text}</div>
      <div className="msg-slot">
        <button
          className="msg-action"
          onClick={async () => {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1400)
          }}
        >
          {copied ? '已复制' : '复制'}
        </button>
        {/* ↳ 只有一个意思:会多出一条分支会话 · §12。
            消息还没进 SDK 的 store 时没有 id,那就不给这个动作 ——
            给一个点了没反应的按钮更糟。 */}
        {id && onFork && (
          <button className="msg-action" onClick={() => onFork(id)}>
            {role === 'user' ? '编辑并重发 ↳' : '从这里重答 ↳'}
          </button>
        )}
        {time && <span className="msg-time">{time}</span>}
      </div>
    </div>
  )
}
