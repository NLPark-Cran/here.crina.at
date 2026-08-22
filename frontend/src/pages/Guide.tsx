import { motion } from 'motion/react'
import {
  Archive,
  Coins,
  Hammer,
  Heart,
  Mailbox,
  Moon,
  Shirt,
  Sparkles,
  Timer,
} from 'lucide-react'

const SECTIONS = [
  {
    icon: Heart,
    color: 'text-crina',
    bg: 'bg-crina/12',
    title: '关系是怎么升温的',
    body: '和居民聊得越多，关系就越亲近：访客 → 熟人 → 老友。升温是自然发生的，不用刻意刷。关系近了，ta 们的语气会真的不一样——老友之间，撒娇和贴贴都很自然。',
  },
  {
    icon: Sparkles,
    color: 'text-xianmo',
    bg: 'bg-xianmo/12',
    title: 'MBTI 与人格',
    body: '每位居民的卡片上都标着自己的 MBTI。人格不是贴上去的标签：作息、口癖、反应方式都是照设定集活的，同一个人在清晨和深夜的状态也不一样。',
  },
  {
    icon: Coins,
    color: 'text-tuanman',
    bg: 'bg-tuanman/12',
    title: '小金库',
    body: '门厅里可以往小金库投喂零花钱。这是给居民们添置衣物的基金——攒够了，就能许愿一件新装。',
  },
  {
    icon: Shirt,
    color: 'text-anfeng',
    bg: 'bg-anfeng/12',
    title: '衣橱',
    body: '小金库攒够后就能给居民许愿新衣物。新衣服生成出来，ta 会真的换上，还会在客厅碎碎念里晒。',
  },
  {
    icon: Hammer,
    color: 'text-baixu',
    bg: 'bg-baixu/12',
    title: '委托板',
    body: '钉一张小纸条，crina 会真的去施工：写文、查资料、改代码都行。施工过程可以围观，交付了会收到汇报。聊天里说到活儿，crina 也会主动提议「钉到委托板」。',
  },
  {
    icon: Mailbox,
    color: 'text-qiule',
    bg: 'bg-qiule/12',
    title: '信箱与问候',
    body: '居民们会给你写信。早安和晚安的问候会按你当地的八点和二十二点来——睡前说晚安，第二天早上真的能收到回信。',
  },
  {
    icon: Archive,
    color: 'text-baixu',
    bg: 'bg-baixu/12',
    title: '档案馆',
    body: '聊出来的精华可以一键萃取成一页收进档案馆；你的文章、收藏和空间的记忆都躺在这里。居民们记得关于你的事，也在档案馆里。',
  },
  {
    icon: Timer,
    color: 'text-tuanman',
    bg: 'bg-tuanman/12',
    title: '一起专注',
    body: '私聊里点「一起专注」，居民会陪你二十五分钟——浮窗里能看到 ta 此刻正在做什么。时间到了，ta 会为你鼓掌。',
  },
  {
    icon: Moon,
    color: 'text-xianmo',
    bg: 'bg-xianmo/12',
    title: '卧室',
    body: '二楼有一间为你留灯的房间。睡前去看看，和 crina 道一声晚安。',
  },
]

/** 小屋指南：把看不见的机制讲清楚 */
export function GuidePage() {
  return (
    <div className="max-w-2xl mx-auto py-8 px-1">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="font-title text-3xl mb-2">小屋指南</h1>
        <p className="text-sm text-ink-soft leading-relaxed mb-8">
          这栋小屋里没有说明书，只有慢慢熟起来的关系。
          不过有些机制藏在角落里，先替你翻开看一眼。
        </p>
      </motion.div>

      <div className="space-y-4">
        {SECTIONS.map((s, i) => (
          <motion.section
            key={s.title}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 + i * 0.05 }}
            className="bg-paper rounded-2xl shadow-card border border-warm-line p-5"
          >
            <h2 className="font-title text-lg flex items-center gap-2 mb-2">
              <span className={`inline-flex p-1.5 rounded-lg ${s.bg}`}>
                <s.icon className={`w-4.5 h-4.5 ${s.color}`} />
              </span>
              {s.title}
            </h2>
            <p className="text-sm text-ink-soft leading-relaxed">{s.body}</p>
          </motion.section>
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.6 }}
        className="mt-8 text-center text-xs text-ink-soft/70"
      >
        剩下的，就让居民们自己告诉你吧。
      </motion.p>
    </div>
  )
}
