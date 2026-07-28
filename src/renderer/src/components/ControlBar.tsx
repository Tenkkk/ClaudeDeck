import { useState } from 'react'
import Popover from './Popover.js'
import TaskChip from './TaskChip.js'
import {
  EFFORT_LEVELS,
  PERMISSION_MODES,
  type EffortLevel,
  type BackgroundTask,
  type ModelOption,
  type PermissionMode,
} from '../../../shared/ipc.js'

/**
 * 控件条 —— 设计终稿 §05 / §08。
 *
 * 左:权限。右:模型、努力、发送。三件事都是「发这条消息之前要决定的」,
 * 所以手和眼都在输入框上,不放顶栏。
 *
 * 输出中「发送」整颗变「停止」—— 同一个位置的互斥状态,不另设按钮。
 */
export default function ControlBar({
  mode,
  models,
  model,
  effort,
  busy,
  effortSwitching,
  canSend,
  onMode,
  onModel,
  onEffort,
  onSend,
  onStop,
  tasks,
  onStopTask,
  onStopAllTasks,
}: {
  mode: PermissionMode
  models: ModelOption[]
  model: string
  effort: EffortLevel
  busy: boolean
  effortSwitching: boolean
  canSend: boolean
  onMode: (m: PermissionMode) => void
  onModel: (v: string) => void
  onEffort: (v: EffortLevel) => void
  onSend: () => void
  onStop: () => void
  tasks: BackgroundTask[]
  onStopTask: (id: string) => void
  onStopAllTasks: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState<null | 'mode' | 'model' | 'effort'>(null)
  const toggle = (k: 'mode' | 'model' | 'effort'): void => setOpen((o) => (o === k ? null : k))
  const close = (): void => setOpen(null)

  const modeInfo = PERMISSION_MODES.find((m) => m.value === mode)
  const current = models.find((m) => m.value === model)
  // §15:控件条上只显示第一个词,完整名进悬停
  const modelShort = (current?.displayName ?? 'Default').split(/[\s(]/)[0]
  const effortInfo = EFFORT_LEVELS.find((e) => e.value === effort)
  const effortIndex = EFFORT_LEVELS.findIndex((e) => e.value === effort)

  return (
    <div className="controls">
      {/* ---- 权限 ---- */}
      <div className="control-slot">
        <button
          className={`chip pill${mode === 'bypassPermissions' ? ' warn' : ''}`}
          data-control="permission"
          aria-expanded={open === 'mode'}
          onClick={() => toggle('mode')}
        >
          <span className="chip-icon">⊙</span>
          {modeInfo?.label}
          <span className="chip-caret" />
        </button>

        <Popover open={open === 'mode'} onClose={close} width={264} prose>
          {PERMISSION_MODES.map((m) => (
            <button
              key={m.value}
              className={`pop-row two-line${m.value === mode ? ' current' : ''}${
                m.value === 'bypassPermissions' ? ' warn' : ''
              }`}
              onClick={() => {
                onMode(m.value)
                close()
              }}
            >
              <span className="pop-check">{m.value === mode ? '✓' : ''}</span>
              <span className="pop-body">
                <span className="pop-title">
                  {m.value === 'bypassPermissions' && <span className="pop-warn-icon">⊙</span>}
                  {m.label}
                </span>
                <span className="pop-desc">{m.hint}</span>
              </span>
            </button>
          ))}
        </Popover>
      </div>

      {/* 子进程胶囊插在权限右边;没有后台任务时整颗消失 · §11 */}
      <TaskChip tasks={tasks} onStop={onStopTask} onStopAll={onStopAllTasks} />

      <div className="right">
        {/* ---- 模型:纯文字,不画胶囊 ---- */}
        <div className="control-slot">
          <button
            className="model-btn"
            data-control="model"
            title={current?.displayName}
            aria-expanded={open === 'model'}
            disabled={models.length === 0}
            onClick={() => toggle('model')}
          >
            {models.length === 0 ? '…' : modelShort}
          </button>

          {/* §15:按最长项 Default (recommended) 定宽 250px */}
          <Popover open={open === 'model'} onClose={close} align="right" width={250}>
            <div className="pop-group">模型</div>
            {models.map((m, i) => (
              <button
                key={m.value}
                className={`pop-row${m.value === model ? ' current' : ''}`}
                onClick={() => {
                  onModel(m.value)
                  close()
                }}
              >
                <span className="pop-check">{m.value === model ? '✓' : ''}</span>
                <span className="pop-body">
                  <span className="pop-title">{m.displayName}</span>
                </span>
                <span className="pop-index">{i === 0 ? '' : i + 1}</span>
              </button>
            ))}
          </Popover>
        </div>

        {/* ---- 努力:只显示一个字 ---- */}
        <div className="control-slot">
          <button
            className="effort-btn"
            data-control="effort"
            title={`努力程度:${effortInfo?.label}`}
            aria-expanded={open === 'effort'}
            onClick={() => toggle('effort')}
          >
            {effortInfo?.label}
            {/* 切档要重开 query,中间几百毫秒没有活着的 query。
                给一个呼吸点,别让界面看起来像卡死了(§13 的预览就是这么画的)。 */}
            {effortSwitching && <span className="effort-pending" />}
          </button>

          <Popover open={open === 'effort'} onClose={close} align="right" width={240} prose>
            <div className="effort-head">
              努力程度 <strong>{effortInfo?.label}</strong>
            </div>
            <div className="effort-ends">
              <span>更快</span>
              <span>更聪明</span>
            </div>
            {/* 五个固定停靠点,不是连续滑块 */}
            <div className="effort-track">
              {EFFORT_LEVELS.map((e, i) => (
                <button
                  key={e.value}
                  className={`effort-stop${i === effortIndex ? ' current' : ''}`}
                  title={e.label}
                  aria-label={e.label}
                  onClick={() => {
                    onEffort(e.value)
                    close()
                  }}
                >
                  <span className="effort-dot" />
                </button>
              ))}
            </div>
            <div className="effort-note">
              越往右,Claude 在回答前想得越久、也越贵。切换会短暂重连,几百毫秒。
            </div>
          </Popover>
        </div>

        {busy ? (
          <button className="btn-stop send" data-state="stop" onClick={onStop}>
            <span className="stop-glyph" />
            停止
          </button>
        ) : (
          <button className="primary send" data-state="send" disabled={!canSend} onClick={onSend}>
            发送
          </button>
        )}
      </div>
    </div>
  )
}
