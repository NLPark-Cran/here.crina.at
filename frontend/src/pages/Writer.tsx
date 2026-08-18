import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { motion } from 'motion/react'
import { Eye, PenLine, Save, Sparkles, Bird, FileText } from 'lucide-react'
import { articlesApi, ApiError } from '../api/client'
import { AuthGate } from '../components/AuthGate'
import { Markdown } from '../components/Markdown'

const BIRDNOTE_TEMPLATE = `## 📅 观察记录

- **日期**：
- **地点**：
- **天气**：

## 🐦 鸟种与行为

| 鸟种 | 数量 | 行为 |
| --- | --- | --- |
|  |  |  |

## 📝 备注

`

const TEMPLATES = [
  { key: 'blank', label: '空白', kind: 'article', content: '', icon: FileText },
  { key: 'birdnote', label: '观鸟笔记', kind: 'birdnote', content: BIRDNOTE_TEMPLATE, icon: Bird },
] as const

export function WriterPage() {
  return (
    <AuthGate roomName="书桌的写作角">
      <WriterInner />
    </AuthGate>
  )
}

function WriterInner() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [summary, setSummary] = useState('')
  const [kind, setKind] = useState<string>('article')
  const [isPublic, setIsPublic] = useState(false)
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(!id)
  const [showCompose, setShowCompose] = useState(false)
  const [rawNotes, setRawNotes] = useState('')
  const [composing, setComposing] = useState(false)

  useEffect(() => {
    if (!id) return
    articlesApi
      .read(id)
      .then((d) => {
        if (!d.is_author) throw new ApiError(403, '这篇文不是你写的哦')
        setTitle(d.article.title)
        setContent(d.article.content)
        setSummary(d.article.summary)
        setKind(d.article.kind === 'daily' ? 'article' : d.article.kind)
        setIsPublic(d.article.public)
        setLoaded(true)
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : '文章搬不过来'))
  }, [id])

  const applyTemplate = (t: (typeof TEMPLATES)[number]) => {
    setKind(t.kind)
    if (t.content && !content.trim()) setContent(t.content)
  }

  const compose = async () => {
    const raw = rawNotes.trim()
    if (!raw || composing) return
    setComposing(true)
    setError('')
    try {
      const draft = await articlesApi.compose({ raw_text: raw, kind })
      setTitle(draft.title)
      setSummary(draft.summary)
      setContent(draft.content)
      setShowCompose(false)
      setPreview(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'crina 走神了，再试一次？')
    } finally {
      setComposing(false)
    }
  }

  const save = async () => {
    if (!title.trim() || !content.trim() || saving) return
    setSaving(true)
    setError('')
    const body = {
      title: title.trim(),
      content,
      summary: summary.trim(),
      kind,
      public: isPublic,
    }
    try {
      if (id) {
        await articlesApi.update(id, body)
        navigate(`/p/${id}`)
      } else {
        const r = await articlesApi.create(body)
        navigate(`/p/${r.id}`)
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存失败，再试一次？')
      setSaving(false)
    }
  }

  if (!loaded) {
    return <div className="py-20 text-center text-sm text-ink-soft">搬稿纸中…</div>
  }

  return (
    <div className="max-w-3xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <h1 className="font-title text-3xl flex items-center gap-2">
          <PenLine className="w-7 h-7 text-crina" />
          {id ? '改一改' : '写一篇'}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">慢慢写，不着急。写好了可以公开挂上文章架，也可以只留给自己。</p>
      </motion.div>

      {/* 模板 */}
      <div className="mt-4 flex items-center gap-2 text-sm">
        <span className="text-ink-soft text-xs">从模板开始：</span>
        {TEMPLATES.map((t) => (
          <button
            key={t.key}
            onClick={() => applyTemplate(t)}
            className={`btn-press inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs border transition-colors ${
              kind === t.kind && (t.key !== 'blank' || kind === 'article')
                ? 'bg-crina/15 border-crina/40 text-crina-deep'
                : 'bg-paper border-warm-line text-ink-soft hover:border-crina/30'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* 整理成文 */}
      <div className="mt-3">
        {!showCompose ? (
          <button
            onClick={() => setShowCompose(true)}
            className="btn-press inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-qiule/15 border border-qiule/40 text-qiule hover:bg-qiule/25 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            帮我把这些整理成文
          </button>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-paper rounded-2xl border border-qiule/30 p-4"
          >
            <p className="text-xs text-ink-soft mb-2">
              把零散的碎碎念、观察记录贴进来，crina 帮你理顺成文（会忠于原文，不瞎编）。
            </p>
            <textarea
              value={rawNotes}
              onChange={(e) => setRawNotes(e.target.value)}
              rows={5}
              maxLength={20000}
              placeholder="比如：今天早上六点半去河边，雾很大，看到一只白鹭……"
              className="w-full resize-none bg-cream/60 rounded-xl p-3 text-sm outline-none border border-warm-line focus:border-qiule/50"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => void compose()}
                disabled={!rawNotes.trim() || composing}
                className="btn-press inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-qiule text-white text-xs disabled:opacity-40"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {composing ? 'crina 整理中…' : '整理成文'}
              </button>
              <button
                onClick={() => setShowCompose(false)}
                className="text-xs text-ink-soft hover:text-ink"
              >
                先不用了
              </button>
            </div>
          </motion.div>
        )}
      </div>

      {/* 编辑区 */}
      <div className="mt-4 bg-paper rounded-2xl shadow-card border border-warm-line p-5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="给这篇文起个名字…"
          maxLength={200}
          className="w-full font-title text-xl bg-transparent outline-none placeholder:text-ink-soft/50"
        />
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="一句话摘要（可选）"
          maxLength={300}
          className="mt-2 w-full text-sm text-ink-soft bg-transparent outline-none placeholder:text-ink-soft/50"
        />
        <div className="mt-3 pt-3 border-t border-warm-line">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-ink-soft/70">支持 Markdown</span>
            <button
              onClick={() => setPreview((v) => !v)}
              className="btn-press inline-flex items-center gap-1 text-xs text-ink-soft hover:text-crina-deep"
            >
              <Eye className="w-3.5 h-3.5" />
              {preview ? '继续写' : '看看效果'}
            </button>
          </div>
          {preview ? (
            <div className="min-h-64 py-2">
              {content.trim() ? (
                <Markdown content={content} />
              ) : (
                <p className="text-sm text-ink-soft/50">还什么都没有写呢。</p>
              )}
            </div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={16}
              maxLength={50000}
              placeholder="正文……"
              className="w-full resize-y bg-transparent outline-none text-[15px] leading-relaxed placeholder:text-ink-soft/50"
            />
          )}
        </div>
        <div className="mt-3 pt-3 border-t border-warm-line flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-ink-soft cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="accent-crina"
            />
            公开挂上文章架（有链接的人都能读）
          </label>
          <button
            onClick={() => void save()}
            disabled={!title.trim() || !content.trim() || saving}
            className="btn-press inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-crina text-white text-sm disabled:opacity-40 hover:bg-crina-deep"
          >
            <Save className="w-4 h-4" />
            {saving ? '收进抽屉中…' : id ? '保存修改' : '写好了'}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-anfeng">{error}</p>}
      </div>
    </div>
  )
}
