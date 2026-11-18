'use client'
import { ImageIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'

/** Server actions accept 1 MB bodies; logos are shrunk in the browser first, so this only trips on odd files. */
export const LOGO_UPLOAD_MAX = 1024 * 1024
const MAX_EDGE = 512

/** Shrinks a picked image to ≤ 512 px WebP before upload (the server re-encodes it anyway via processLogo). */
async function shrink(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92))
  if (!blob) throw new Error('encode failed')
  return new File([blob], 'logo.webp', { type: 'image/webp' })
}

/** File input for the spa logo with a live preview (used at sign-up and in Settings). */
export function LogoInput({
  id = 'logo',
  name = 'logo',
  current,
  tooLargeText,
}: {
  id?: string
  name?: string
  current?: string | null
  tooLargeText: string
}) {
  const [preview, setPreview] = useState<string | null>(current ?? null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setPreview(current ?? null)
  }, [current])
  useEffect(() => {
    if (!preview?.startsWith('blob:')) return
    return () => {
      URL.revokeObjectURL(preview)
    }
  }, [preview])

  return (
    <div className="flex items-center gap-3">
      <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-[10px] border bg-subtle text-muted">
        {preview ? (
          // biome-ignore lint/performance/noImgElement: local blob / public /files preview
          <img src={preview} alt="" className="size-full object-contain" />
        ) : (
          <ImageIcon className="size-5" strokeWidth={1.5} />
        )}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <Input
          id={id}
          name={name}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="h-auto py-1.5 file:me-3 file:rounded-md file:border-0 file:bg-subtle file:px-2.5 file:py-1 file:text-[length:inherit] file:font-medium file:text-fg"
          aria-invalid={error ? true : undefined}
          onChange={async (e) => {
            const input = e.currentTarget
            const picked = input.files?.[0]
            setError(null)
            if (!picked) {
              setPreview(current ?? null)
              return
            }
            const file = await shrink(picked).catch(() => picked)
            if (file.size > LOGO_UPLOAD_MAX) {
              input.value = ''
              setPreview(current ?? null)
              setError(tooLargeText)
              return
            }
            if (file !== picked) {
              const dt = new DataTransfer()
              dt.items.add(file)
              input.files = dt.files
            }
            setPreview(URL.createObjectURL(file))
          }}
        />
        {error && <p className="anim-fade-in text-[13px] text-danger">{error}</p>}
      </div>
    </div>
  )
}
