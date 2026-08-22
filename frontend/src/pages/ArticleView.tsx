import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { motion } from 'motion/react'
import { BookOpen, Bookmark, Check, Eye, PenLine } from 'lucide-react'
import { articlesApi, ApiError } from '../api/client'
import { useAuth } from '../store/auth'
import type { Article } from '../api/types'
import { CharacterAvatar } from '../components/CharacterAvatar'
import { Markdown } from '../components/Markdown'
import { formatDateTime } from '../lib/time'

export function ArticleViewPage() {
  const { id } = useParams<{ id: string }>()
  const [article, setArticle] = useState<Article | null>(null)
  const [isAuthor, setIsAuthor] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const user = useAuth((s) => s.user)
  // 摘抄即记忆：划词弹「收进档案馆」（R9.4）
  const contentRef = useRef<HTMLDivElement>(null)
  const [clipPop, setClipPop] = useState<{ x: number; y: number; text: string } | null>(null)
  const [clipState, setClipState] = useState<'idle' | 'saving' | 'done'>('idle')

  const onSelect = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !contentRef.current) {
      setClipPop(null)
      return
    }
    const text = (sel.toString() || '').trim()
    if (text.length < 2 || text.length > 500 || !contentRef.current.contains(sel.anchorNode)) {
      setClipPop(null)
      return
    }
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    setClipState('idle')
    setClipPop({ x: rect.left + rect.width / 2, y: rect.top - 8, text })
  }

  const saveClip = async () => {
    if (!clipPop || !id || clipState === 'saving') return
    setClipState('saving')
    try {
      await articlesApi.clip(id, clipPop.text)
      setClipState('done')
      setTimeout(() => setClipPop(null), 1200)
    } catch (e) {
      setClipState('idle')
      setClipPop(null)
      alert(e instanceof ApiError ? e.message : '没收进去，再试一次？')
    }
    window.getSelection()?.removeAllRanges()
  }

  useEffect(() => {
    if (!id) return
    setLoaded(false)
    setError('')
    articlesApi
      .read(id)
      .then((d) => {
        setArticle(d.article)
        setIsAuthor(d.is_author)
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : '这篇文找不到啦'))
      .finally(() => setLoaded(true))
  }, [id])

  if (!loaded) {
    return <div className="py-20 text-center text-sm text-ink-soft">从书架上取文中…</div>
  }

  if (error || !article) {
    return (
      <div className="max-w-sm mx-auto mt-16 bg-paper rounded-2xl shadow-card border border-warm-line p-8 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-cream flex items-center justify-center mb-4">
          <BookOpen className="w-7 h-7 text-ink-soft" />
        </div>
        <h2 className="font-title text-xl">{error || '这篇文找不到啦'}</h2>
        <Link to="/parlor" className="inline-block mt-5 text-sm text-crina-deep hover:underline">
          回客厅坐坐 →
        </Link>
      </div>
    )
  }

  const kindLabel =
    article.kind === 'daily' ? '小屋日报' : article.kind === 'birdnote' ? '观鸟笔记' : null

  return (
    <div className="max-w-3xl mx-auto">
      <motion.article
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="bg-paper rounded-2xl shadow-card border border-warm-line p-6 md:p-10"
      >
        {kindLabel && (
          <span className="inline-block text-xs px-2.5 py-1 rounded-full bg-qiule/15 text-qiule border border-qiule/30">
            {kindLabel}
          </span>
        )}
        <h1 className="mt-2 font-title text-3xl leading-snug">{article.title}</h1>
        <div className="mt-3 flex items-center gap-2.5 text-xs text-ink-soft">
          <CharacterAvatar
            name={article.author.name}
            color={article.author.color}
            avatarUrl={article.author.avatar_url}
            size={26}
          />
          <span className="font-medium" style={{ color: article.author.color ?? undefined }}>
            {article.author.name}
          </span>
          <span>·</span>
          <span>{formatDateTime(article.created_at)}</span>
          <span>·</span>
          <span className="inline-flex items-center gap-1">
            <Eye className="w-3.5 h-3.5" />
            {article.views}
          </span>
          {isAuthor && (
            <Link
              to={`/write/${article.id}`}
              className="ml-auto inline-flex items-center gap-1 text-crina-deep hover:underline"
            >
              <PenLine className="w-3.5 h-3.5" />
              改一改
            </Link>
          )}
        </div>
        <div ref={contentRef} onMouseUp={onSelect} className="mt-6 pt-6 border-t border-warm-line">
          <Markdown content={article.content} />
        </div>
      </motion.article>

      {/* 划词摘抄 popover */}
      {user && clipPop && (
        <div
          className="fixed z-50 -translate-x-1/2 -translate-y-full"
          style={{ left: clipPop.x, top: clipPop.y }}
        >
          <button
            onClick={saveClip}
            disabled={clipState === 'saving'}
            className="btn-press inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-baixu text-white text-xs shadow-float hover:opacity-90 disabled:opacity-60"
          >
            {clipState === 'done' ? (
              <><Check className="w-3.5 h-3.5" /> 收好了</>
            ) : (
              <><Bookmark className="w-3.5 h-3.5" /> {clipState === 'saving' ? '收进档案馆…' : '收进档案馆'}</>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
