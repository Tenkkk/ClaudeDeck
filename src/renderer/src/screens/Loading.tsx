/** 屏幕 A · 加载 —— 设计终稿 §02。通常不到 1 秒,但必须有画面,否则冷启动闪白。 */
export default function Loading(): React.JSX.Element {
  return (
    <div className="screen-center">
      <div>
        <div className="brand">
          <span className="brand-dot breathing" />
          ClaudeDeck
        </div>
        <div className="loading-note">正在检查运行环境…</div>
      </div>
    </div>
  )
}
