import type { AskAnswer, AskCard, AskOption, AskQuestion, PlanCard } from '../shared/ipc.js'

/**
 * 把 CLI 的 user dialog payload 归一化成能渲染的卡片。
 *
 * ## 这些字段是怎么来的
 *
 * `dialogKind` 是开放字符串,`payload` 在协议层只是不透明对象 —— SDK 的类型
 * 里查不到任何一种的形状。但 CLI 二进制里带着它自己的 payload 校验器,
 * 从那儿读出来的是实证,不是猜测:
 *
 * ```
 * {kind:"permission_ask_user_question",
 *  payload 必含 requestId / toolName / permissionResult / questions}
 * {kind:"permission_exit_plan_mode_v2",
 *  payload 必含 requestId / toolName / permissionResult / plan}
 * 两者的 result 都必须含 behavior,超时默认 {behavior:"cancelled"}
 * ```
 *
 * ## ⚠️ 未经端到端验证
 *
 * `AskUserQuestion` 与 `ExitPlanMode` 在当前的 SDK 会话里不上场(见 CLAUDE.md
 * 「SDK 会话里拿不到的东西」),所以这两条通道**永远不会响**。这里的代码只在
 * 真收到对应 dialog 时才执行,对现有行为零影响;等 SDK 放开就能自动生效。
 *
 * 认不出形状时一律返回 null,交给调用方走「安全取消」那条路 ——
 * 宁可不画,也不猜着画一个框:猜错的选择会真的落到文件上。
 */

export const KIND_ASK = 'permission_ask_user_question'
export const KIND_PLAN = 'permission_exit_plan_mode_v2'

/** 我们声明会画的那几种。没声明的 CLI 自己按默认处理,根本不问我们。 */
export const SUPPORTED_DIALOG_KINDS = [KIND_ASK, KIND_PLAN]

interface Rec {
  [k: string]: unknown
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined
}

export function askCardFromPayload(id: string, payload: unknown): AskCard | null {
  const p = (payload ?? {}) as Rec
  if (!Array.isArray(p.questions)) return null

  const questions: AskQuestion[] = []
  for (const raw of p.questions) {
    const q = (raw ?? {}) as Rec
    const question = str(q.question)
    if (!question) continue

    const options: AskOption[] = (Array.isArray(q.options) ? q.options : []).flatMap((o) => {
      const opt = (o ?? {}) as Rec
      const label = str(opt.label)
      if (!label) return []
      const preview = str(opt.preview)
      return [{ label, description: str(opt.description) ?? '', ...(preview ? { preview } : {}) }]
    })

    if (options.length === 0) continue

    questions.push({
      question,
      // header 是协议给的短标签(≤12 字),既当进度也当鼠标版的左右键
      header: str(q.header) ?? question.slice(0, 12),
      options,
      multiSelect: q.multiSelect === true,
    })
  }

  return questions.length > 0 ? { id, questions } : null
}

export function planCardFromPayload(id: string, payload: unknown): PlanCard | null {
  const p = (payload ?? {}) as Rec
  const plan = str(p.plan)
  return plan ? { id, plan } : null
}

/**
 * 拼回给 CLI 的作答。键用**题干原文** —— 这是 AskUserQuestion 的输出契约
 * 规定的(`answers: { [question]: string }`,多选逗号分隔)。
 */
export function askResult(card: AskCard, answer: AskAnswer): Record<string, unknown> {
  const answers: Record<string, string> = {}
  for (const q of card.questions) {
    const v = answer.answers[q.question]
    if (v) answers[q.question] = v
  }

  const out: Record<string, unknown> = { questions: card.questions, answers }
  if (answer.response?.trim()) out.response = answer.response.trim()

  // 注意判断的是**过滤之后**的结果:输入里可能有键但值全是空串,
  // 那种情况不该回一个空的 annotations 对象过去。
  const notes = answer.notes ? mapNotes(answer.notes) : {}
  if (Object.keys(notes).length > 0) out.annotations = notes

  return out
}

function mapNotes(notes: Record<string, string>): Record<string, { notes: string }> {
  const out: Record<string, { notes: string }> = {}
  for (const [k, v] of Object.entries(notes)) {
    if (v.trim()) out[k] = { notes: v.trim() }
  }
  return out
}
