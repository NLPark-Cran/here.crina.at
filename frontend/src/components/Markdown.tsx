import { memo } from 'react'
import { Streamdown } from 'streamdown'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import { cjk } from '@streamdown/cjk'
import 'katex/dist/katex.min.css'

/**
 * 全站统一的 Markdown 渲染（streamdown）
 * - code: Shiki 高亮 / math: KaTeX / cjk: 中文标点与边界处理
 * - streaming=true 时开启动画与未完成语法容错（用于 SSE 流式气泡）
 */
export const Markdown = memo(function Markdown({
  content,
  className,
  streaming = false,
}: {
  content: string
  className?: string
  streaming?: boolean
}) {
  return (
    <Streamdown
      className={className}
      plugins={{ code, math, cjk }}
      isAnimating={streaming}
      parseIncompleteMarkdown={streaming}
      shikiTheme={['github-light', 'github-light']}
    >
      {content}
    </Streamdown>
  )
})
