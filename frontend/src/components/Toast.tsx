import { AnimatePresence, motion } from 'motion/react'

/** 顶部居中轻提示 */
export function Toast({ text, onClose }: { text: string; onClose?: () => void }) {
  return (
    <AnimatePresence>
      {text && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          onClick={onClose}
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[calc(100%-2rem)] bg-paper rounded-2xl shadow-float border border-baixu/30 px-5 py-3.5 text-sm text-center cursor-pointer"
        >
          {text}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
