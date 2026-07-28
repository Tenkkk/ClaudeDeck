import { useState } from 'react'
import { CheckIcon } from './Icons.js'
import type { AskAnswer, AskCard as Card } from '../../../shared/ipc.js'

/** 协议规定「其他」由工具自动补,不需要模型自己造 —— 界面负责把它画出来。 */
const OTHER = '其他…'

/**
 * Claude 反问你 —— 设计终稿 §13。
 *
 * 一题一屏、回车进下一题。顶上那排标签是协议给的 `header`(≤12 字),
 * 既当进度也当鼠标版的左右键。最后一题按钮变「提交」。
 *
 * ⚠️ 未经端到端验证:这条通道在当前 SDK 版本里不会响(见 CLAUDE.md)。
 * 只在真收到 dialog 时渲染,对现有行为零影响。
 */
export default function AskCard({
  card,
  onSubmit,
  onCancel,
}: {
  card: Card
  onSubmit: (answer: AskAnswer) => void
  onCancel: () => void
}): React.JSX.Element {
  const [at, setAt] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [otherText, setOtherText] = useState<Record<string, string>>({})
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({})
  const [freeform, setFreeform] = useState<string | null>(null)

  const total = card.questions.length
  const q = card.questions[at]
  const last = at === total - 1
  const picked = answers[q.question] ?? ''
  const chosen = picked ? picked.split(',').map((s) => s.trim()).filter(Boolean) : []

  function choose(label: string): void {
    if (q.multiSelect) {
      const next = chosen.includes(label)
        ? chosen.filter((c) => c !== label)
        : [...chosen, label]
      setAnswers((a) => ({ ...a, [q.question]: next.join(', ') }))
    } else {
      setAnswers((a) => ({ ...a, [q.question]: label }))
    }
  }

  function finish(): void {
    // 「其他…」填的自由文本要替换掉那个占位标签
    const merged: Record<string, string> = {}
    for (const item of card.questions) {
      const v = answers[item.question]
      if (!v) continue
      const extra = otherText[item.question]?.trim()
      merged[item.question] = extra ? v.replace(OTHER, extra) : v
    }
    onSubmit({ answers: merged, notes })
  }

  // 一道都不选,直接说一段话
  if (freeform !== null) {
    return (
      <div className="ask-card">
        <div className="card-label">等待你决定</div>
        <div className="card-title">{total} 道题都不合适,直接说</div>
        <textarea
          autoFocus
          className="ask-freeform"
          value={freeform}
          placeholder="写下你想说的"
          onChange={(e) => setFreeform(e.target.value)}
        />
        <div className="row">
          <button
            className="primary"
            disabled={!freeform.trim()}
            onClick={() => onSubmit({ answers: {}, response: freeform.trim() })}
          >
            提交
          </button>
          <button onClick={() => setFreeform(null)}>回到选项</button>
          <button className="card-remember" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    )
  }

  const hasPreview = q.options.some((o) => o.preview)
  const focusedPreview = q.options.find((o) => chosen.includes(o.label))?.preview

  return (
    <div className="ask-card">
      <div className="card-label">等待你决定</div>

      {/* 那排标签是协议给的 header,既当进度也当左右键 */}
      <div className="ask-steps">
        {card.questions.map((item, i) => (
          <button
            key={item.question}
            className={`ask-step${i === at ? ' current' : ''}${answers[item.question] ? ' done' : ''}`}
            onClick={() => setAt(i)}
          >
            {answers[item.question] && <CheckIcon size={9} />}
            {item.header}
          </button>
        ))}
        <span className="ask-count">
          第 {at + 1} 题 · 共 {total} 题
        </span>
      </div>

      <div className="card-title">{q.question}</div>

      <div className={hasPreview ? 'ask-split' : ''}>
        <div className="ask-options">
          {[...q.options, { label: OTHER, description: '自己写一个答案。' }].map((o, i) => {
            const on = chosen.includes(o.label)
            return (
              <div key={o.label}>
                <button className={`ask-option${on ? ' current' : ''}`} onClick={() => choose(o.label)}>
                  <span className={q.multiSelect ? 'todo-box' : 'ask-radio'} aria-hidden="true">
                    {on && (q.multiSelect ? <CheckIcon size={9} /> : <span className="ask-dot" />)}
                  </span>
                  <span className="pop-body">
                    <span className="pop-title">{o.label}</span>
                    {o.description && <span className="pop-desc">{o.description}</span>}
                  </span>
                  <span className="pop-index">{i + 1}</span>
                </button>
                {o.label === OTHER && on && (
                  <input
                    autoFocus
                    className="ask-other"
                    value={otherText[q.question] ?? ''}
                    placeholder="写下你的答案"
                    onChange={(e) => setOtherText((s) => ({ ...s, [q.question]: e.target.value }))}
                  />
                )}
              </div>
            )
          })}
        </div>

        {hasPreview && (
          <div className="ask-preview">
            <div className="pop-group">预览</div>
            {focusedPreview ? (
              <div className="ask-preview-body">{focusedPreview}</div>
            ) : (
              <div className="hint">选中带预览的选项后显示</div>
            )}
          </div>
        )}
      </div>

      {noteOpen[q.question] ? (
        <input
          className="ask-note"
          value={notes[q.question] ?? ''}
          placeholder="补充说明"
          onChange={(e) => setNotes((s) => ({ ...s, [q.question]: e.target.value }))}
        />
      ) : (
        <button
          className="card-remember"
          style={{ marginLeft: 0 }}
          onClick={() => setNoteOpen((s) => ({ ...s, [q.question]: true }))}
        >
          ＋ 加一句补充说明
        </button>
      )}

      <div className="row">
        {last ? (
          <button className="primary" disabled={!picked} onClick={finish}>
            提交
          </button>
        ) : (
          <button className="primary" disabled={!picked} onClick={() => setAt(at + 1)}>
            下一题
          </button>
        )}
        {at > 0 && <button onClick={() => setAt(at - 1)}>上一题</button>}
        <button className="card-remember" onClick={() => setFreeform('')}>
          {total} 道题都不合适,我直接说
        </button>
      </div>

      <div className="card-keys" style={{ marginLeft: 0 }}>
        {q.multiSelect ? `空格 勾选 · 已选 ${chosen.length}` : '↑↓ 选项'} · ←→ 换题 ·
        Enter {last ? '提交' : '下一题'}
      </div>
    </div>
  )
}
