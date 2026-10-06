'use client'
import { AlertTriangle, CloudDownload, ExternalLink, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, useTransition } from 'react'
import {
  assetUsageAction,
  deleteAssetAction,
  persistAssetAction,
  saveAssetAction,
} from '@/app/dashboard/[tenant]/media/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { ease } from '@/lib/motion'
import { formatDate } from '@/lib/utils'
import { formatBytes, isStored, type MediaItem, sized } from './types'

type Usage = { pages: string[]; services: string[]; staff: string[]; posts: number }

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const usageTotal = (u: Usage) => u.pages.length + u.services.length + u.staff.length + u.posts
/** "1 page: Home; 1 service photo: Hot stones; 2 unpublished social posts" */
const describeUsage = (u: Usage) =>
  [
    u.pages.length > 0 && `${count(u.pages.length, 'page', 'pages')}: ${u.pages.join(', ')}`,
    u.services.length > 0 &&
      `${count(u.services.length, 'service photo', 'service photos')}: ${u.services.join(', ')}`,
    u.staff.length > 0 &&
      `${count(u.staff.length, 'therapist photo', 'therapist photos')}: ${u.staff.join(', ')}`,
    u.posts > 0 && count(u.posts, 'unpublished social post', 'unpublished social posts'),
  ]
    .filter(Boolean)
    .join('; ')

/** Details for one image: preview, EN/AR alt text, tags, copy URL, delete (with a "used on …" warning). */
export function AssetSheet({
  slug,
  item,
  origin,
  onOpenChange,
}: {
  slug: string
  item: MediaItem | null
  origin: string
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet
      open={item !== null}
      onOpenChange={onOpenChange}
      title={item?.filename ?? (item?.source === 'ai' ? 'AI image' : 'Image')}
      description={item ? describe(item) : undefined}
      className="md:max-w-3xl"
    >
      {item && (
        <Details key={item.id} slug={slug} item={item} origin={origin} onClose={() => onOpenChange(false)} />
      )}
    </Sheet>
  )
}

const describe = (i: MediaItem) =>
  [
    i.width && i.height ? `${i.width} × ${i.height}px` : null,
    formatBytes(i.bytes),
    `added ${formatDate(i.createdAt)}`,
  ]
    .filter(Boolean)
    .join(' · ')

function Details({
  slug,
  item,
  origin,
  onClose,
}: {
  slug: string
  item: MediaItem
  origin: string
  onClose: () => void
}) {
  const stored = isStored(item.url)
  const absolute = stored ? `${origin}${item.url}` : item.url
  const [usage, setUsage] = useState<Usage | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [pending, start] = useTransition()

  const askDelete = () =>
    start(async () => {
      const res = await assetUsageAction(slug, item.id)
      if (!res.ok) return void toast.error(res.error)
      setUsage(res.usage)
      setConfirming(true)
    })
  const doDelete = () =>
    start(async () => {
      const res = await deleteAssetAction(slug, item.id)
      if (!res?.ok) return void toast.error(res?.error ?? 'Couldn’t delete the image')
      toast.success(res.message ?? 'Image deleted')
      onClose()
    })
  const persist = () =>
    start(async () => {
      const res = await persistAssetAction(slug, item.id)
      if (!res?.ok) return void toast.error(res?.error ?? 'Couldn’t save the image')
      toast.success(res.message ?? 'Saved')
      onClose()
    })

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-8">
      <div className="space-y-3">
        <div className="overflow-hidden rounded-lg border bg-subtle">
          {/* biome-ignore lint/performance/noImgElement: library files are already optimised WebP */}
          <img
            src={sized(item.url, 960)}
            alt={item.alt.en ?? ''}
            className="mx-auto max-h-[38dvh] w-full object-contain md:max-h-[440px]"
            style={item.width && item.height ? { aspectRatio: `${item.width} / ${item.height}` } : undefined}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={item.source === 'ai' ? 'accent' : 'neutral'}>
            {item.source === 'ai' ? 'AI image' : 'Upload'}
          </Badge>
          {!stored && <Badge tone="warning">Temporary link</Badge>}
          {item.tags.map((t) => (
            <Badge key={t}>#{t}</Badge>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        {!stored && (
          <div className="space-y-3 rounded-lg border border-warning/30 bg-warning-soft/50 p-4 text-sm">
            <p>
              This AI image still lives on the generator’s temporary link, which expires 7 days after
              creation.
            </p>
            <Button type="button" size="sm" onClick={persist} pending={pending}>
              <CloudDownload /> Save to library
            </Button>
          </div>
        )}
        <ActionForm action={saveAssetAction.bind(null, slug, item.id)} className="space-y-4">
          <Field
            label="Alt text (English)"
            name="altEn"
            hint="Describe the image for screen readers and Google."
          >
            <Input
              id="altEn"
              name="altEn"
              defaultValue={item.alt.en ?? ''}
              placeholder="Warm stones on a towel"
            />
          </Field>
          <Field label="Alt text (Arabic)" name="altAr">
            <Input id="altAr" name="altAr" dir="rtl" lang="ar" defaultValue={item.alt.ar ?? ''} />
          </Field>
          <Field label="Tags" name="tags" hint="Comma-separated, e.g. rooms, team, offers">
            <Input id="tags" name="tags" defaultValue={item.tags.join(', ')} />
          </Field>
          <SubmitButton className="w-full sm:w-auto">Save details</SubmitButton>
        </ActionForm>

        <div className="flex flex-wrap gap-2 border-t pt-5">
          <CopyButton value={absolute} label="Copy URL" />
          <Button asChild variant="secondary" size="sm">
            <a href={item.url} target="_blank" rel="noreferrer">
              <ExternalLink /> Open
            </a>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ms-auto text-danger hover:bg-danger-soft hover:text-danger"
            onClick={askDelete}
            pending={pending && !confirming}
            disabled={confirming}
          >
            <Trash2 /> Delete
          </Button>
        </div>

        <AnimatePresence initial={false}>
          {confirming && usage && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease }}
              className="overflow-hidden"
            >
              <div
                role="alert"
                className="space-y-3 rounded-lg border border-danger/25 bg-danger-soft/60 p-4 text-sm"
              >
                <p className="flex items-start gap-2 font-medium">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" strokeWidth={1.75} />
                  {usageTotal(usage) === 0
                    ? 'Not used on your website, services, team or posts. Delete it for good?'
                    : `Used on ${describeUsage(usage)}. Deleting it will leave an empty image there.`}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="danger" size="sm" onClick={doDelete} pending={pending}>
                    {usageTotal(usage) === 0 ? 'Delete image' : 'Delete anyway'}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
