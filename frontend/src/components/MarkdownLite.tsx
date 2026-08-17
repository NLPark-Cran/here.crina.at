import { Fragment, type ReactNode } from 'react'

/** 行内渲染：**粗体** 与 `代码` */
function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="px-1 py-0.5 rounded bg-crina/10 text-crina-deep text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      )
    }
    return <Fragment key={i}>{part}</Fragment>
  })
}

/** 轻量 markdown 渲染：标题 / 段落 / 无序有序列表 / 引用，够用就好 */
export function MarkdownLite({ content }: { content: string }) {
  const lines = content.split('\n')
  const blocks: ReactNode[] = []
  let list: string[] = []
  let listOrdered = false
  let key = 0

  const flushList = () => {
    if (list.length === 0) return
    const items = list.map((item, i) => <li key={i}>{renderInline(item)}</li>)
    blocks.push(
      listOrdered ? (
        <ol key={key++} className="list-decimal pl-5 my-3 space-y-1 text-ink-soft leading-relaxed">
          {items}
        </ol>
      ) : (
        <ul key={key++} className="list-disc pl-5 my-3 space-y-1 text-ink-soft leading-relaxed">
          {items}
        </ul>
      ),
    )
    list = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const ulMatch = /^[-*]\s+(.+)/.exec(line)
    const olMatch = /^\d+[.、]\s*(.+)/.exec(line)
    if (ulMatch) {
      if (list.length && listOrdered) flushList()
      listOrdered = false
      list.push(ulMatch[1])
      continue
    }
    if (olMatch) {
      if (list.length && !listOrdered) flushList()
      listOrdered = true
      list.push(olMatch[1])
      continue
    }
    flushList()
    if (!line.trim()) continue
    const h = /^(#{1,4})\s+(.*)/.exec(line)
    if (h) {
      const level = h[1].length
      const cls =
        level === 1
          ? 'font-title text-2xl mt-6 mb-3 text-ink'
          : level === 2
            ? 'font-title text-xl mt-5 mb-2 text-ink'
            : 'font-title text-lg mt-4 mb-2 text-ink'
      blocks.push(
        <div key={key++} className={cls}>
          {renderInline(h[2])}
        </div>,
      )
    } else if (line.startsWith('>')) {
      blocks.push(
        <blockquote
          key={key++}
          className="border-l-2 border-crina/50 pl-3 my-3 text-ink-soft italic"
        >
          {renderInline(line.replace(/^>\s?/, ''))}
        </blockquote>,
      )
    } else {
      blocks.push(
        <p key={key++} className="my-2.5 text-ink-soft leading-relaxed">
          {renderInline(line)}
        </p>,
      )
    }
  }
  flushList()
  return <div>{blocks}</div>
}
