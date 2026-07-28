import { useEffect, useState } from 'react'
import { CheckIcon } from './Icons.js'
import type { RewindPreview } from '../../../shared/ipc.js'

/**
 * 从这条重答的确认 —— 设计终稿 §12。
 *
 * `↳` 在这套界面里只有一个意思:**会多出一条分支会话**。SDK 没有 regenerate、
 * 也删不掉已写入的消息,所以「重答」只能是分支,界面必须说出来(坑 4.4)。
 *
 * 「同时把文件回退到那一刻」**默认勾上**:只 fork 对话不回退磁盘的话,
 * 文件停在改后的状态,而分支里的上下文以为没改过,之后 Edit 会开始报错(坑 4.2)。
 * 没开检查点时禁用并写明原因,不要悄悄跳过。
 *
 * 「能回退 N 个文件」那个数字来自真的 dryRun,不编。
 */
export default function ForkDialog({
  messageId,
  onCancel,
  onConfirm,
}: {
  messageId: string
  onCancel: () => void
  onConfirm: (rewind: boolean) => void
}): React.JSX.Element {
  const [preview, setPreview] = useState<RewindPreview | null>(null)
  const [rewind, setRewind] = useState(true)

  useEffect(() => {
    let alive = true
    void window.api.sessions.rewindPreview(messageId).then((p) => {
      if (!alive) return
      setPreview(p)
      // 回退不可用时不能默认勾着 —— 那是个骗人的勾
      if (!p.canRewind) setRewind(false)
    })
    return () => {
      alive = false
    }
  }, [messageId])

  const canRewind = preview?.canRewind === true

  return (
    <div className="fork-card">
      <strong>从这条重答,会新建一条分支</strong>
      <p>原来这条会话保持不动。分支会挂在它下面,标题后面加「分支」。</p>

      <button
        className={`fork-check${canRewind ? '' : ' disabled'}`}
        disabled={!canRewind}
        onClick={() => setRewind((v) => !v)}
      >
        <span className={`todo-box${rewind ? ' checked' : ''}`}>{rewind && <CheckIcon size={9} />}</span>
        <span className="fork-check-body">
          <span>同时把文件回退到那一刻</span>
          <span className="hint">
            {preview === null
              ? '正在确认能回退哪些文件…'
              : canRewind
                ? `已开启文件检查点,能回退 ${preview.fileCount} 个改动过的文件。`
                : (preview.reason ?? '这条会话没有文件检查点,无法回退文件。')}
          </span>
        </span>
      </button>

      <div className="row">
        <button onClick={onCancel}>取消</button>
        <button className="primary" onClick={() => onConfirm(rewind && canRewind)}>
          创建分支
        </button>
      </div>
    </div>
  )
}
