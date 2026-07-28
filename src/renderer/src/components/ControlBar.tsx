import { useEffect, useRef, useState } from 'react'
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
  requestOpen,
  onRequestHandled,
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
  /** 输入框里敲 /model、/effort 时由外面点开对应浮层 —— 见 App 的 UI_COMMANDS */
  requestOpen?: 'model' | 'effort' | null
  onRequestHandled?: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState<null | 'mode' | 'model' | 'effort'>(null)
  const toggle = (k: 'mode' | 'model' | 'effort'): void => setOpen((o) => (o === k ? null : k))
  const close = (): void => setOpen(null)

  useEffect(() => {
    if (!requestOpen) return
    setOpen(requestOpen)
    onRequestHandled?.()
  }, [requestOpen, onRequestHandled])

  const modeInfo = PERMISSION_MODES.find((m) => m.value === mode)
  const current = models.find((m) => m.value === model)
  // §15:控件条上只显示第一个词,完整名进悬停
  const modelShort = (current?.displayName ?? 'Default').split(/[\s(]/)[0]
  // 档位由当前模型说了算:Haiku 不带 supportedEffortLevels,就是不支持努力程度。
  // 模型还没报上来时(models 为空)先按全档画,免得开场闪一下禁用态。
  const allowed = current?.effortLevels
  const levels = allowed ? EFFORT_LEVELS.filter((e) => allowed.includes(e.value)) : EFFORT_LEVELS
  const effortOff = current !== undefined && allowed === undefined
  const effortInfo = EFFORT_LEVELS.find((e) => e.value === effort)
  const effortIndex = Math.max(
    0,
    levels.findIndex((e) => e.value === effort),
  )

  // 拖拽中只动这个预览值,松手才提交 —— 切一档要重开一次 query,
  // 拖过五档不能变成五次重连。
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const shownIndex = dragIndex ?? effortIndex
  const shownLevel = levels[shownIndex] ?? effortInfo

  /** 轨道是等分 grid,第 i 格的中心就是第 i 个点,所以直接按格宽取整 */
  function indexAt(clientX: number): number {
    const el = trackRef.current
    if (!el) return effortIndex
    const r = el.getBoundingClientRect()
    const raw = Math.floor(((clientX - r.left) / r.width) * levels.length)
    return Math.min(levels.length - 1, Math.max(0, raw))
  }

  function commit(i: number): void {
    const next = levels[i]
    setDragIndex(null)
    if (next && next.value !== effort) onEffort(next.value)
    close()
  }

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

          {/*
            原先右侧那列 1/2/3 是 CLI 的键盘序号 —— 在鼠标界面里它不指代任何东西,
            删掉。腾出来的位置给 SDK 本来就提供的 description,也就是终端里
            /model 第二列的那句话,靠它才分得清 Opus 和 Fable 各适合干什么。
          */}
          <Popover open={open === 'model'} onClose={close} align="right" width={320} prose>
            <div className="pop-group">模型</div>
            {models.map((m) => (
              <button
                key={m.value}
                className={`pop-row two-line${m.value === model ? ' current' : ''}`}
                onClick={() => {
                  onModel(m.value)
                  close()
                }}
              >
                <span className="pop-check">{m.value === model ? '✓' : ''}</span>
                <span className="pop-body">
                  <span className="pop-title">{m.displayName}</span>
                  {m.description && <span className="pop-desc">{m.description}</span>}
                </span>
              </button>
            ))}
          </Popover>
        </div>

        {/* ---- 努力:只显示一个字 ---- */}
        <div className="control-slot">
          <button
            className="effort-btn"
            data-control="effort"
            title={effortOff ? `${current?.displayName} 不支持努力程度` : `努力程度:${effortInfo?.label}`}
            aria-expanded={open === 'effort'}
            disabled={effortOff}
            onClick={() => toggle('effort')}
          >
            {effortInfo?.label}
            {/* 切档要重开 query,中间几百毫秒没有活着的 query。
                给一个呼吸点,别让界面看起来像卡死了(§13 的预览就是这么画的)。 */}
            {effortSwitching && <span className="effort-pending" />}
          </button>

          <Popover open={open === 'effort'} onClose={close} align="right" width={240} prose>
            <div className="effort-head">
              努力程度 <strong>{shownLevel?.label}</strong>
            </div>
            <div className="effort-ends">
              <span>更快</span>
              <span>更聪明</span>
            </div>
            {/*
              停靠式滑块:值仍然只有这几档,但可以按住拖 —— 拖到哪一格就吸到哪个点。
              整条轨道自己接管指针事件(不是每个点各管各的),否则从两点之间按下去
              就没人响应;拖动期间只更新预览,松手才真正切档。
            */}
            <div
              ref={trackRef}
              className={`effort-track${dragIndex !== null ? ' dragging' : ''}`}
              role="slider"
              tabIndex={0}
              aria-label="努力程度"
              aria-valuemin={1}
              aria-valuemax={levels.length}
              aria-valuenow={shownIndex + 1}
              aria-valuetext={shownLevel?.label}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                setDragIndex(indexAt(e.clientX))
              }}
              onPointerMove={(e) => {
                if (dragIndex === null) return
                setDragIndex(indexAt(e.clientX))
              }}
              onPointerUp={(e) => {
                e.currentTarget.releasePointerCapture(e.pointerId)
                commit(indexAt(e.clientX))
              }}
              onPointerCancel={() => setDragIndex(null)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault()
                  const d = e.key === 'ArrowRight' ? 1 : -1
                  setDragIndex(Math.min(levels.length - 1, Math.max(0, shownIndex + d)))
                } else if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  commit(shownIndex)
                }
              }}
            >
              {levels.map((e, i) => (
                <span
                  key={e.value}
                  className={`effort-stop${i === shownIndex ? ' current' : ''}`}
                  title={e.label}
                >
                  <span className="effort-dot" />
                </span>
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
