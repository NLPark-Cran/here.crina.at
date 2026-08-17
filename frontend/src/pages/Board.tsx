import { motion } from 'motion/react'
import {
  ClipboardList,
  Code2,
  Search,
  FileText,
  Image,
  FileSpreadsheet,
  BatteryCharging,
  Hammer,
} from 'lucide-react'
import { AuthGate } from '../components/AuthGate'

const ABILITIES = [
  { icon: Code2, title: '写代码', desc: '从脚本小工具到完整项目，crina 都能搭把手' },
  { icon: Search, title: '查资料', desc: '帮你翻遍网络，把要点整理成看得懂的话' },
  { icon: FileText, title: '整理文档', desc: '乱七八糟的材料，理成清清爽爽的文档' },
  { icon: Image, title: '生成图片', desc: '脑子里有画面？说出来，画给你看' },
  { icon: FileSpreadsheet, title: '操作云文档', desc: '直接读写你的 Google 与 WPS 文档' },
]

export function BoardPage() {
  return (
    <AuthGate roomName="委托板">
      <div className="max-w-2xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center pt-6"
        >
          <div className="w-16 h-16 mx-auto rounded-2xl bg-crina/10 flex items-center justify-center mb-4">
            <ClipboardList className="w-8 h-8 text-crina" />
          </div>
          <h1 className="font-title text-3xl">委托板</h1>
          <p className="mt-3 text-ink-soft leading-relaxed">
            这里会挂上 crina 的干活委托——把活儿写在小纸条上钉上来，
            <br className="hidden sm:block" />
            她做完了会敲你。
          </p>
        </motion.div>

        {/* 即将开张 */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.12 }}
          className="mt-8 bg-paper rounded-2xl shadow-card border border-warm-line p-6 text-center"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-qiule/15 text-qiule text-sm font-medium">
            <Hammer className="w-4 h-4" />
            即将开张 · crina 正在打磨工具
          </div>
          <p className="mt-4 text-sm text-ink-soft leading-relaxed">
            开张之后，你可以委托这些事：
          </p>
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
            {ABILITIES.map(({ icon: Icon, title, desc }, i) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.18 + i * 0.06 }}
                className="card-hover flex gap-3 p-4 rounded-xl bg-cream border border-warm-line/70"
              >
                <div className="w-9 h-9 rounded-lg bg-crina/12 flex items-center justify-center shrink-0">
                  <Icon className="w-4.5 h-4.5 text-crina-deep" />
                </div>
                <div>
                  <div className="text-sm font-medium">{title}</div>
                  <div className="mt-0.5 text-xs text-ink-soft leading-relaxed">{desc}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* 词元蓄电池预告 */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-5 bg-gradient-to-br from-crina/10 to-baixu/10 rounded-2xl border border-crina/20 p-6"
        >
          <div className="flex items-center gap-2 font-title text-lg">
            <BatteryCharging className="w-5 h-5 text-crina-deep" />
            词元蓄电池
          </div>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed">
            委托干活要烧「词元」。之后你可以接上自己的 TokenDance 钥匙（BYOK），
            蓄电池就由你自己充电，用多少都不心疼。具体玩法，开张那天细说。
          </p>
        </motion.div>
      </div>
    </AuthGate>
  )
}
