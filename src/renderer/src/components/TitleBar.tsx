import { useEffect, useState } from 'react'
import { PanelIcon, SearchIcon } from './Icons.js'

/**
 * 自绘标题栏。
 *
 * 系统标题栏和这套界面是两张皮 —— 它有自己的底色、字体、高度,怎么调都对不上。
 * 窗口改成 frame:false,这一条自己画,和侧栏同底,视觉上是一整块。
 *
 * 整条是拖拽区(-webkit-app-region: drag),按钮各自 no-drag ——
 * 不单独标的话按钮会被拖拽区吃掉点击。
 *
 * 关闭按钮是唯一一颗悬停变红的:它和另外两颗的后果不是一个量级。
 */
export default function TitleBar({
  onToggleSidebar,
  sidebarOpen,
  onSearch,
  bare,
}: {
  onToggleSidebar: () => void
  sidebarOpen: boolean
  onSearch: () => void
  /** 加载页/引导页/选项目页:还没有侧栏和会话,左侧那两个入口就不给 */
  bare?: boolean
}): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.api.window.isMaximized().then(setMaximized)
    return window.api.window.onMaximizedChange(setMaximized)
  }, [])

  return (
    <div className="titlebar">
      <div className="titlebar-left">
        {!bare && (
          <>
            <button
              className="win-btn"
              title={sidebarOpen ? '收起侧栏' : '展开侧栏'}
              aria-pressed={sidebarOpen}
              onClick={onToggleSidebar}
            >
              <PanelIcon />
            </button>
            <button className="win-btn" title="搜索会话" onClick={onSearch}>
              <SearchIcon size={14} />
            </button>
          </>
        )}
      </div>

      {/* 中间整块留给拖拽。不写标题:窗口标题在归属行里已经有了,
          再写一遍就是同一句话占两行 */}
      <div className="titlebar-drag" />

      <div className="titlebar-right">
        <button className="win-ctl" title="最小化" onClick={() => void window.api.window.minimize()}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          className="win-ctl"
          title={maximized ? '还原' : '最大化'}
          onClick={async () => setMaximized(await window.api.window.toggleMaximize())}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              {/* 还原:两个错开的方框,和系统那颗一个意思 */}
              <rect x="1" y="3" width="6" height="6" stroke="currentColor" strokeWidth="1" />
              <path d="M3 3V1h6v6H7" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <rect x="1" y="1" width="8" height="8" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>
        <button
          className="win-ctl close"
          title="关闭"
          onClick={() => void window.api.window.close()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </div>
  )
}
