/**
 * 骨架阶段的假数据 —— IMPLEMENTATION-BRIEF §7 第 2 步。
 *
 * 内容照抄设计终稿 §05 的主界面,好让画稿和实现能逐项对照。
 * 第 3 步「接上真数据」时整个文件删除。
 *
 * 侧栏的项目模型(项目 → 会话两层、折叠状态、每项目会话数)在主进程里
 * 还不存在:偏好里目前只有 workspaces: string[]。所以这一层必须先假着,
 * 等第 3 步把 listSessions 按项目合并之后才能接真。
 */

export interface FakeSession {
  id: string
  title: string
  time: string
  branch?: string
}

export interface FakeProject {
  id: string
  name: string
  path: string
  count: number
  expanded: boolean
  sessions: FakeSession[]
}

export const FAKE_PROJECTS: FakeProject[] = [
  {
    id: 'p-claudedeck',
    name: 'ClaudeDeck',
    path: 'D:\\Code\\AI_Project\\ClaudeDeck',
    count: 12,
    expanded: true,
    sessions: [
      { id: 's-1', title: '给 Effort 分档加重连过渡态', time: '15:32', branch: 'feat/effort-reconnect' },
      { id: 's-2', title: '修复 canUseTool 的 fail closed', time: '11:08', branch: 'main' },
      { id: 's-3', title: '锁文件在 CI 上挂了两次', time: '7/26 22:47' },
    ],
  },
  {
    id: 'p-switchdeck',
    name: 'SwitchDeck',
    path: 'D:\\Code\\AI_Project\\SwitchDeck',
    count: 2,
    expanded: false,
    sessions: [],
  },
  {
    id: 'p-notes',
    name: 'notes-vault',
    path: 'C:\\Users\\12054\\Documents\\notes-vault',
    count: 5,
    expanded: false,
    sessions: [],
  },
]

/** 侧栏底部两行。额度接口是实验性的,拿不到时整块消失(§09 / 坑 4.1)。 */
export const FAKE_FOOTER = {
  rateLimits: { fiveHour: 38, sevenDay: 61 },
  appVersion: '0.1.0',
  cliVersion: '1.0.62',
  sessionCost: '$0.11',
}

/** 归属行。上下文超过 80% 转警示色 —— 自动压缩唯一的预告。 */
export const FAKE_HEADER = {
  project: 'ClaudeDeck',
  title: '给 Effort 分档加重连过渡态',
  contextPercent: 62,
}
