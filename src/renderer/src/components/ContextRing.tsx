import { useState } from 'react'
import Popover from './Popover.js'
import type { ContextUsage, UsageInfo } from '../../../shared/ipc.js'

/**
 * 上下文占用的环形入口 —— 挨着权限按钮,和「发这条之前要知道的事」放在一起。
 *
 * 原先这是归属行右端的一行小字「上下文 2%」:位置远、只有一个百分比。
 * 百分比能告诉你快满了,却告诉不了你**该删什么**;而 SDK 一直在给分类明细,
 * 我此前把它扔了。
 *
 * 环本身只画一个数,点开才是明细 —— 平时它就该安静。
 */
export default function ContextRing({
  context,
  usage,
  warnAt,
}: {
  context: ContextUsage | null
  usage: UsageInfo | null
  warnAt: number
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (!context) return null

  const pct = Math.min(100, Math.max(0, context.percentage))
  const warn = pct >= warnAt
  const live = context.categories.filter((c) => !c.deferred)
  const deferred = context.categories.filter((c) => c.deferred)

  return (
    <div className="control-slot">
      <button
        className={`ctx-ring${warn ? ' warn' : ''}`}
        aria-expanded={open}
        aria-label={`上下文占用 ${Math.round(pct)}%`}
        title={`上下文 ${Math.round(pct)}%`}
        onClick={() => setOpen((v) => !v)}
      >
        <Ring pct={pct} warn={warn} />
      </button>

      <Popover open={open} onClose={() => setOpen(false)} width={330} prose>
        <div className="ctx-head">
          <span>上下文窗口</span>
          <span className="ctx-head-num">
            {fmt(context.totalTokens)} / {fmt(context.maxTokens)}({Math.round(pct)}%)
          </span>
        </div>

        {/* 一条按分类分段的总条,和下面的行同色 —— 看一眼就知道谁占大头 */}
        <div className="ctx-bar">
          {live.map((c) => (
            <span
              key={c.name}
              style={{ width: `${(c.tokens / context.maxTokens) * 100}%`, background: c.color }}
            />
          ))}
        </div>

        {live.map((c) => (
          <Row key={c.name} name={c.name} tokens={c.tokens} color={c.color} max={context.maxTokens} />
        ))}

        {deferred.length > 0 && (
          <>
            <div className="ctx-sep" />
            {/* 这些还没加载进来,不占当前窗口,所以不给百分比 —— 摆在一起会误导 */}
            {deferred.map((c) => (
              <Row key={c.name} name={c.name} tokens={c.tokens} color={c.color} max={0} />
            ))}
          </>
        )}

        {usage?.available && (
          <>
            <div className="ctx-sep" />
            <div className="ctx-head">
              <span>额度</span>
            </div>
            {usage.fiveHour !== null && (
              <Limit label="5 小时" pct={usage.fiveHour} resetsAt={usage.fiveHourResetsAt} />
            )}
            {usage.sevenDay !== null && (
              <Limit label="7 天" pct={usage.sevenDay} resetsAt={usage.sevenDayResetsAt} />
            )}
          </>
        )}
      </Popover>
    </div>
  )
}

/** 环:一圈底 + 一段弧。用 stroke-dasharray 画,不引任何图表库 */
function Ring({ pct, warn }: { pct: number; warn: boolean }): React.JSX.Element {
  const r = 6.5
  const c = 2 * Math.PI * r
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r={r} fill="none" stroke="var(--border)" strokeWidth="2.4" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke={warn ? 'var(--warn)' : 'var(--accent)'}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray={`${(c * pct) / 100} ${c}`}
        // 从 12 点开始顺时针,不是默认的 3 点
        transform="rotate(-90 9 9)"
      />
    </svg>
  )
}

function Row({
  name,
  tokens,
  color,
  max,
}: {
  name: string
  tokens: number
  color: string
  max: number
}): React.JSX.Element {
  return (
    <div className="ctx-row-item">
      <span className="ctx-dot" style={{ background: color }} />
      <span className="ctx-name">{name}</span>
      <span className="ctx-tokens">{fmt(tokens)}</span>
      <span className="ctx-pct">{max > 0 ? `${((tokens / max) * 100).toFixed(1)}%` : '—'}</span>
    </div>
  )
}

function Limit({
  label,
  pct,
  resetsAt,
}: {
  label: string
  pct: number
  resetsAt?: string | null
}): React.JSX.Element {
  return (
    <div className="ctx-limit">
      <div className="ctx-limit-head">
        <span>{label}</span>
        <span className="ctx-tokens">{Math.round(pct)}%</span>
      </div>
      <div className="ctx-limit-bar">
        <span style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      {resetsAt && <div className="hint">{resetsAt} 重置</div>}
    </div>
  )
}

/** 25200 → 25.2k。token 数的个位没有意义,只会让这列每次都在抖 */
function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
