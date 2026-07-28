import { useState } from 'react'
import { CheckIcon } from './Icons.js'
import type { ElicitationCard as Card, ElicitationField } from '../../../shared/ipc.js'

/** enum 超过这个数就从分段转成竖排单选 · §14 */
const SEGMENT_MAX = 5

/**
 * MCP 服务要你填的表 —— 设计终稿 §14。
 *
 * 头部必须写清是**哪个 MCP 服务**在要:说话的不是 Claude,是外部服务。
 * requestedSchema 是标准 JSON Schema,所以这里是通用渲染器 —— 和 dialog
 * 那边只能白名单不同(坑 4.3)。
 */
export default function ElicitationCard({
  card,
  onSubmit,
  onCancel,
}: {
  card: Card
  onSubmit: (values: Record<string, string | boolean>) => void
  onCancel: () => void
}): React.JSX.Element {
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const init: Record<string, string | boolean> = {}
    for (const f of card.fields) {
      if (f.default !== undefined) init[f.key] = typeof f.default === 'boolean' ? f.default : String(f.default)
    }
    return init
  })

  const set = (key: string, v: string | boolean): void => setValues((s) => ({ ...s, [key]: v }))
  const missing = card.fields.filter((f) => f.required && (values[f.key] === undefined || values[f.key] === ''))

  if (card.mode === 'url') {
    return (
      <div className="ask-card">
        <div className="card-label">等待你决定</div>
        <div className="card-source">MCP · {card.serverName}</div>
        <div className="card-title">{card.message}</div>
        <div className="hint">需要在浏览器里授权一次。授权完成后这张卡会自己消失,不用回来点确认。</div>
        <div className="row">
          <button
            className="primary"
            onClick={() => {
              if (card.url) window.open(card.url, '_blank')
            }}
          >
            打开授权页
          </button>
          <button onClick={onCancel}>取消</button>
        </div>
      </div>
    )
  }

  return (
    <div className="ask-card">
      <div className="card-label">等待你决定</div>
      <div className="card-source">MCP · {card.serverName}</div>
      <div className="card-title">{card.message}</div>

      <div className="fields">
        {card.fields.map((f) => (
          <Field key={f.key} field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />
        ))}
      </div>

      <div className="row">
        <button className="primary" disabled={missing.length > 0} onClick={() => onSubmit(values)}>
          提交
        </button>
        <button onClick={onCancel}>取消</button>
        <span className="card-keys">Tab 切字段 · Esc 取消</span>
      </div>
    </div>
  )
}

function Field({
  field,
  value,
  onChange,
}: {
  field: ElicitationField
  value: string | boolean | undefined
  onChange: (v: string | boolean) => void
}): React.JSX.Element {
  const label = (
    <span className="field-label">
      {field.label}
      {/* required → 标题后一个陶土小点 */}
      {field.required && <span className="required-dot" aria-label="必填" />}
    </span>
  )

  if (field.kind === 'boolean') {
    const on = value === true
    return (
      <label className="field field-inline">
        <button
          type="button"
          className={`todo-box${on ? ' checked' : ''}`}
          aria-pressed={on}
          onClick={() => onChange(!on)}
        >
          {on && <CheckIcon size={9} />}
        </button>
        {label}
        {field.description && <span className="field-desc">{field.description}</span>}
      </label>
    )
  }

  if (field.kind === 'enum' && field.options) {
    const wide = field.options.length > SEGMENT_MAX
    return (
      <div className="field">
        {label}
        <div className={wide ? 'enum-list' : 'segmented'}>
          {field.options.map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={value === o}
              onClick={() => onChange(o)}
            >
              {o}
            </button>
          ))}
        </div>
        {field.description && <span className="field-desc">{field.description}</span>}
      </div>
    )
  }

  return (
    <div className="field">
      {label}
      <span className="field-input">
        <input
          type={field.kind === 'number' ? 'number' : 'text'}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.required ? '' : '可留空'}
          onChange={(e) => onChange(e.target.value)}
        />
        {field.unit && <span className="field-unit">{field.unit}</span>}
      </span>
      {field.description && <span className="field-desc">{field.description}</span>}
    </div>
  )
}
