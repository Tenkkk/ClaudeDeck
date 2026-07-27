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
 * 这一步按 brief §7 只做「复制」;「编辑并重发 ↳」「从这里重答 ↳」要等
 * forkSession,在第 7 步。
 */
export default function Message({
  role,
  text,
}: {
  role: 'user' | 'assistant'
  text: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)

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
      </div>
    </div>
  )
}
