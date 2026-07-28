import type { PlanCard as Card } from '../../../shared/ipc.js'

/**
 * Claude 提交计划请你点头 —— 设计终稿 §06。
 *
 * 沙绿左条,和权限卡的陶土左条区分:**一个在拦你,一个在等你满意。**
 * 正文用 Source Serif —— 它是 Claude 写的散文,不是日志。
 *
 * ⚠️ 未经端到端验证:ExitPlanMode 在当前 SDK 版本里不上场(见 CLAUDE.md)。
 * 只在真收到 dialog 时渲染,对现有行为零影响。
 */
export default function PlanCard({
  card,
  onAccept,
  onDiscuss,
}: {
  card: Card
  onAccept: () => void
  onDiscuss: () => void
}): React.JSX.Element {
  // 「N 步」取自计划正文里的有序列表条目数,数不出来就不显示,不编
  const steps = (card.plan.match(/^\s*\d+[.、)]\s+/gm) ?? []).length

  return (
    <div className="plan-card">
      <div className="plan-head">
        <span className="card-label live">计划模式 · 只读</span>
        {steps > 0 && <span className="plan-steps">{steps} 步</span>}
      </div>
      <div className="plan-body">{card.plan}</div>
      <div className="row">
        <button className="primary" onClick={onAccept}>
          按这个做
        </button>
        <button onClick={onDiscuss}>继续讨论</button>
      </div>
    </div>
  )
}
