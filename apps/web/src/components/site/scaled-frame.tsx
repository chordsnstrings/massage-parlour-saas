'use client'
import { useEffect, useRef, useState } from 'react'
import { Skeleton } from '@/components/ui/page'
import { cn } from '@/lib/utils'

/**
 * A live page rendered at desktop width and scaled to fit its box (template "try on" thumbnails).
 * The iframe keeps real media queries, so the thumbnail shows the true desktop layout.
 */
export function ScaledFrame({
  src,
  title,
  width = 1280,
  className,
}: {
  src: string
  title: string
  width?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => entry && setScale(entry.contentRect.width / width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [width])
  return (
    <div ref={ref} className={cn('relative isolate overflow-hidden bg-subtle', className)}>
      {!loaded && <Skeleton className="absolute inset-0 rounded-none" />}
      {scale > 0 && (
        <iframe
          src={src}
          title={title}
          loading="lazy"
          // Thumbnails are server-rendered HTML: no scripts, so a gallery of previews doesn't boot one app each.
          sandbox="allow-same-origin"
          tabIndex={-1}
          aria-hidden
          onLoad={() => setLoaded(true)}
          className={cn(
            'pointer-events-none absolute top-0 left-0 origin-top-left border-0 transition-opacity duration-300',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
          style={{ width, height: `${100 / scale}%`, transform: `scale(${scale})` }}
        />
      )}
    </div>
  )
}
