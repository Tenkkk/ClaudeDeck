import { useState } from 'react'
import { CaretIcon } from './Icons.js'

/**
 * Claude 回答之前的思考。
 *
 * **默认折叠。** 思考是过程不是结论,摊开来会把真正的回答挤到屏幕外;但它又
 * 确实有用 —— 答得不对时,想看的正是它在哪一步拐错了。所以留一行摘要,
 * 想看再展开。
 *
 * 正在思考时(live)自动展开并显示最后几行:那会儿屏幕上没有别的东西,
 * 让人看着它在动,比一个空白的「思考中」有信息量得多。
 */
export default function Thought({ text, live }: { text: string; live?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const show = open || live === true

  return (
    <div className={`thought${show ? ' open' : ''}`}>
      <button className="thought-head" onClick={() => setOpen((v) => !v)} aria-expanded={show}>
        <CaretIcon size={11} className={show ? 'thought-caret open' : 'thought-caret'} />
        <span>思考</span>
        {!show && <span className="thought-peek">{firstLine(text)}</span>}
      </button>
      {show && <div className="thought-body">{text}</div>}
    </div>
  )
}

/** 折叠时露一行 —— 让人判断值不值得展开 */
function firstLine(text: string): string {
  const line = text.trim().split('\n').find((l) => l.trim() !== '') ?? ''
  return line.length > 60 ? `${line.slice(0, 60)}…` : line
}
