import { useEffect, useState } from 'react'
import type { TurnStatus } from '../../../shared/ipc.js'

/**
 * 等待态 —— 设计终稿 §06 的空档。
 *
 * 在 Claude 吐出第一个字之前,这块地方原本是全空的:界面看起来和卡死一模一样。
 * 三样东西补上这个空档 —— 一个还在动的点(证明进程活着)、已经等了多久、
 * 这一轮产出了多少 token。
 *
 * 文案不自己编:requesting / compacting 是 SDK 报上来的状态,其余一律说
 * 「处理中」—— 那种时候它多半在跑工具,而具体在跑什么,上面的工具行已经写了,
 * 这里再猜一个更细的说法只会和事实对不上。
 *
 * token 数**不是逐字跳的**:usage 只在每条助手消息收尾的 message_delta 上
 * 出现,所以一轮里有几次工具往返它就跳几级。拿到之前干脆不显示,而不是先挂
 * 一个 0 在那儿装作在数。
 */
export default function Thinking({
  since,
  status,
  outputTokens,
  streaming,
  effort,
}: {
  since: number
  status: TurnStatus
  outputTokens: number
  streaming: boolean
  /** 努力档的中文名。终端里这一行也会带上它,因为它直接决定你要等多久 */
  effort?: string
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [since])

  const secs = Math.max(0, Math.round((now - since) / 1000))
  const elapsed =
    secs < 60 ? `${secs} 秒` : `${Math.floor(secs / 60)} 分 ${String(secs % 60).padStart(2, '0')} 秒`

  const label =
    status === 'compacting' ? '正在压缩上下文' : streaming ? '输出中' : status === 'requesting' ? '思考中' : '处理中'

  /** 上千了就写成 1.9k —— 四位数字每秒变一次太吵 */
  function formatTokens(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
  }

  return (
    <div className="thinking" role="status" aria-live="polite">
      <span className="brand-dot breathing" />
      <span className="thinking-label">{label}</span>
      <span className="thinking-meta">
        {elapsed}
        {outputTokens > 0 && ` · ↓ ${formatTokens(outputTokens)} tokens`}
        {effort && ` · ${effort}努力`}
      </span>
    </div>
  )
}
