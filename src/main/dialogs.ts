import type { AskAnswer, AskCard, AskOption, AskQuestion, PlanCard } from '../shared/ipc.js'

/**
 * 把 AskUserQuestion / ExitPlanMode 的工具入参归一化成能渲染的卡片。
 *
 * ## 走的是哪条路(实测,不是推断)
 *
 * 这两件事**不是 user dialog,是普通工具调用**,通过 `canUseTool` 到达:
 *
 * ```
 * canUseTool('AskUserQuestion', { questions: [...] })
 *   → { behavior:'allow', updatedInput: { ...input, answers } }
 *     answers 以**题干原文**为键,值是选项 label(多选可用数组或逗号分隔)
 *     模型随后收到 "The user answered: ..." ;不带 answers 放行的话,
 *     收到的是 "The user did not answer the questions."
 *
 * canUseTool('ExitPlanMode', { plan, planFilePath })
 *   → allow 即批准计划,deny 的 message 会回到模型那里
 * ```
 *
 * 我一开始把它们接在 `onUserDialog` 上,因为 CLI 二进制里确实注册了
 * `kind:"permission_ask_user_question"` 这样的条目。那是个真实存在、但在
 * Agent SDK 会话里**不会响**的通道:声明了 supportedDialogKinds 也照样只有
 * canUseTool 被调用。结论只能靠跑一次拿到,靠读二进制字符串会读岔。
 *
 * 认不出形状时一律返回 null,交给调用方原样放行 —— 宁可让 CLI 走它自己的
 * 默认路径,也不猜着画一个框:猜错的选择会真的落到文件上。
 */

/**
 * 我们声明会画的 user dialog 种类 —— 一种都没有。
 *
 * 空着是有意的:CLI 对没声明的 kind 一律按「宿主画不了」处理,退回它自己的
 * 默认行为,这正是我们要的。声明一个画不出来的 kind 反而会把流程停在那儿等
 * 一张永远不会出现的卡。
 */
export const SUPPORTED_DIALOG_KINDS: string[] = []

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
 * 作答要打进 `updatedInput` 的那几个字段。
 *
 * 只返回补丁,不带 `questions` —— 调用方是 `{ ...input, ...这里 }`,原样保留
 * CLI 自己给的 questions,免得我归一化过的版本把它盖掉。
 *
 * 键用**题干原文**:CLI 内部的作答 reducer 就是 `answers[questionText]`,
 * 用 header 当键的话字段收得下、校验过不了,模型照样收到「没人作答」。
 */
export function askAnswerPatch(card: AskCard, answer: AskAnswer): Record<string, unknown> {
  const answers: Record<string, string> = {}
  for (const q of card.questions) {
    const v = answer.answers[q.question]
    if (v) answers[q.question] = v
  }

  const out: Record<string, unknown> = { answers }
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
