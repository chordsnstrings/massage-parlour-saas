'use client'
import { ImageIcon, Images, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { MediaPicker } from './media-picker'
import { sized } from './types'

/**
 * Form input for a single image URL (service photo, therapist portrait): preview + "Choose from library".
 * Posts `name` as a hidden field; '' clears the image.
 */
export function ImageInput({
  slug,
  name,
  label,
  hint,
  defaultValue,
}: {
  slug: string
  name: string
  label: string
  hint?: string
  defaultValue?: string | null
}) {
  const [value, setValue] = useState(defaultValue ?? '')
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-1.5">
      <p className="text-[13px] font-medium text-fg">{label}</p>
      <div className="flex items-center gap-4">
        <div className="relative grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg border bg-subtle text-muted">
          {value ? (
            // biome-ignore lint/performance/noImgElement: library thumbnail
            <img src={sized(value, 480)} alt="" className="size-full object-cover" />
          ) : (
            <ImageIcon className="size-5" strokeWidth={1.5} />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-10"
            onClick={() => setOpen(true)}
          >
            <Images /> {value ? 'Replace' : 'Choose from library'}
          </Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" className="min-h-10" onClick={() => setValue('')}>
              <X /> Remove
            </Button>
          )}
        </div>
      </div>
      {hint && <p className="text-[13px] text-muted">{hint}</p>}
      <input type="hidden" name={name} value={value} />
      <MediaPicker
        slug={slug}
        open={open}
        onOpenChange={setOpen}
        onPick={(item) => {
          setValue(item.url)
          setOpen(false)
        }}
      />
    </div>
  )
}
