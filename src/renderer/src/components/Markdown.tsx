import { useState } from 'react'
import { parseMarkdown, type Block, type Inline } from '../lib/markdown.js'

/**
 * 把解析结果画成 React 元素。
 *
 * 全程用元素、不碰 innerHTML —— 模型吐出来的 `<script>` 只会被当字面文本
 * 显示,没有注入面。
 *
 * 代码块单独一块,带语言标签和复制按钮:聊天里贴出来的代码多半是要拿去用的,
 * 让人手选反而容易漏首尾。
 */
export default function Markdown({ text }: { text: string }): React.JSX.Element {
  return <div className="md">{parseMarkdown(text).map((b, i) => renderBlock(b, i))}</div>
}

function renderBlock(b: Block, key: number): React.JSX.Element {
  switch (b.kind) {
    case 'heading': {
      // h1/h2 在气泡里太吵,统一压到三档字号,层级靠粗细和间距区分
      const level = Math.min(b.level, 3)
      return (
        <div key={key} className={`md-h md-h${level}`}>
          {renderInline(b.content)}
        </div>
      )
    }
    case 'code':
      return <CodeBlock key={key} lang={b.lang} text={b.text} />
    case 'list':
      return <List key={key} block={b} />
    case 'quote':
      return (
        <blockquote key={key} className="md-quote">
          {b.blocks.map((x, i) => renderBlock(x, i))}
        </blockquote>
      )
    case 'hr':
      return <hr key={key} className="md-hr" />
    case 'table':
      return (
        <div key={key} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {b.head.map((c, i) => (
                  <th key={i}>{renderInline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((c, j) => (
                    <td key={j}>{renderInline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    default:
      return (
        <p key={key} className="md-p">
          {renderInline(b.content)}
        </p>
      )
  }
}

function List({ block }: { block: Extract<Block, { kind: 'list' }> }): React.JSX.Element {
  const items = block.items.map((it, i) => (
    <li key={i}>
      {renderInline(it.content)}
      {it.children.length > 0 && (
        <ul className="md-list">
          {it.children.map((c, j) => (
            <li key={j}>{renderInline(c.content)}</li>
          ))}
        </ul>
      )}
    </li>
  ))
  return block.ordered ? (
    <ol className="md-list" start={block.start}>
      {items}
    </ol>
  ) : (
    <ul className="md-list">{items}</ul>
  )
}

function CodeBlock({ lang, text }: { lang: string; text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span className="md-code-lang">{lang || 'text'}</span>
        <button
          className="md-code-copy"
          onClick={async () => {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1400)
          }}
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  )
}

function renderInline(nodes: Inline[]): React.ReactNode {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case 'code':
        return (
          <code key={i} className="md-inline-code">
            {n.text}
          </code>
        )
      case 'strong':
        return <strong key={i}>{renderInline(n.children)}</strong>
      case 'em':
        return <em key={i}>{renderInline(n.children)}</em>
      case 'del':
        return <del key={i}>{renderInline(n.children)}</del>
      case 'link':
        // 外链交给系统浏览器 —— 应用窗口里没有地址栏,导航走了就回不来
        return (
          <a
            key={i}
            className="md-link"
            href={n.href}
            onClick={(e) => {
              e.preventDefault()
              void window.api.app.openExternal(n.href)
            }}
          >
            {renderInline(n.children)}
          </a>
        )
      default:
        return <span key={i}>{n.text}</span>
    }
  })
}
