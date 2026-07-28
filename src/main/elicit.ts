import type { ElicitationField } from '../shared/ipc.js'

/**
 * 把 MCP 的 `requestedSchema`(标准 JSON Schema)压成能直接渲染的字段表 —— §14。
 *
 * 类型映射按终稿:
 *   enum → 分段(超过 5 项转竖排单选)· boolean → 勾选 ·
 *   number → 数字框带单位 · string → 输入框 · required → 标题后一个陶土小点
 *
 * 这里之所以敢写通用渲染器,是因为 requestedSchema 是**有标准**的;
 * dialog 的 payload 没有标准,所以那边只能白名单,不能通用(坑 4.3)。
 *
 * 认不出的类型一律降级成 string 输入框:少一个控件形态,不会把值写错。
 */

interface Rec {
  [k: string]: unknown
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

export function fieldsFromSchema(schema: unknown): ElicitationField[] {
  const root = (schema ?? {}) as Rec
  const props = (root.properties ?? {}) as Rec
  const required = new Set(
    Array.isArray(root.required) ? root.required.filter((r): r is string => typeof r === 'string') : [],
  )

  return Object.entries(props).map(([key, raw]) => {
    const p = (raw ?? {}) as Rec
    const label = str(p.title) ?? key
    const description = str(p.description)
    const type = str(p.type)

    const enumValues = Array.isArray(p.enum)
      ? p.enum.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
      : undefined

    let kind: ElicitationField['kind'] = 'string'
    if (enumValues && enumValues.length > 0) kind = 'enum'
    else if (type === 'boolean') kind = 'boolean'
    else if (type === 'number' || type === 'integer') kind = 'number'

    const def = p.default
    const field: ElicitationField = {
      key,
      label,
      description,
      required: required.has(key),
      kind,
      options: enumValues,
      // 数字框的单位:schema 里常写在 title 后或用自定义扩展,取不到就不显示
      unit: str(p.unit) ?? str((p['x-unit'] as string | undefined) ?? undefined),
      default:
        typeof def === 'string' || typeof def === 'number' || typeof def === 'boolean'
          ? def
          : undefined,
    }
    return field
  })
}

/**
 * 把用户填的值按 schema 声明的类型还原 —— 表单控件出来的都是字符串,
 * 直接回传会让 number 字段变成 "30000" 这种字符串。
 *
 * 返回类型跟着 MCP 的 ElicitResult.content 收窄:只允许标量与字符串数组。
 */
export type ElicitContent = Record<string, string | number | boolean | string[]>

export function coerceValues(
  fields: ElicitationField[],
  raw: Record<string, string | boolean>,
): ElicitContent {
  const out: ElicitContent = {}
  for (const f of fields) {
    const v = raw[f.key]
    if (v === undefined || v === '') continue
    if (f.kind === 'boolean') {
      out[f.key] = v === true || v === 'true'
    } else if (f.kind === 'number') {
      const n = Number(v)
      if (!Number.isNaN(n)) out[f.key] = n
    } else {
      out[f.key] = String(v)
    }
  }
  return out
}
