'use client'
import { ReceiptText } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

/** Small receipt preview linking to the private file; PDFs and unreadable images fall back to an icon. */
export function ReceiptThumb({ url, className }: { url: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label="View receipt"
      className={cn(
        'grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg border bg-subtle text-muted transition-[transform,border-color] duration-150 hover:-translate-y-px hover:border-accent/60',
        className,
      )}
    >
      {failed ? (
        <ReceiptText className="size-4" strokeWidth={1.5} />
      ) : (
        // biome-ignore lint/performance/noImgElement: private, session-checked file; next/image can't proxy it
        <img
          src={`${url}?w=480`}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </a>
  )
}
