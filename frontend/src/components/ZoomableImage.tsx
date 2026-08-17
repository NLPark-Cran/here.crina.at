import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'

interface Props {
  src: string
  alt?: string
  className?: string
}

/** 圆角图片，点击放大查看（灯箱） */
export function ZoomableImage({ src, alt = '', className = '' }: Props) {
  const [zoomed, setZoomed] = useState(false)
  return (
    <>
      <img
        src={src}
        alt={alt}
        onClick={() => setZoomed(true)}
        className={`cursor-zoom-in ${className}`}
        loading="lazy"
      />
      <AnimatePresence>
        {zoomed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setZoomed(false)}
            className="fixed inset-0 z-[60] bg-ink/70 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out"
          >
            <motion.img
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              src={src}
              alt={alt}
              className="max-w-full max-h-[85dvh] rounded-2xl shadow-float object-contain"
            />
            <button
              className="absolute top-4 right-4 p-2 rounded-full bg-paper/90 text-ink"
              aria-label="关闭"
            >
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
