'use client'
import { Film, Layers, Plus, SlidersHorizontal, Square, Timer, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Input, Select } from '@/components/ui/input'
import { useT } from '@/i18n/client'
import { cn } from '@/lib/utils'
import { setPostFormatAction } from './publish-actions'

type Kind = 'image' | 'video'
type Item = { key: number; url: string; kind: Kind }
const TYPES = [
  { value: 'feed', icon: Square },
  { value: 'reel', icon: Film },
  { value: 'story', icon: Timer },
  { value: 'carousel', icon: Layers },
] as const
const MAX_ITEMS = 10

/**
 * F18: choose how an Instagram post goes out — feed image, reel (video), story (image or video) or carousel (2–10
 * images/videos) — and its media links (public https; videos as .mp4 links, the media library holds images only).
 */
export function PostFormatSheet({
  slug,
  postId,
  type,
  media,
}: {
  slug: string
  postId: string
  type: string
  media: { url: string; type?: Kind }[]
}) {
  const t = useT()
  const guess = (url: string): Kind => (/\.(mp4|mov|m4v)(?:[?#]|$)/i.test(url) ? 'video' : 'image')
  const [kind, setKind] = useState(TYPES.some((x) => x.value === type) ? type : 'feed')
  const [items, setItems] = useState<Item[]>(() =>
    (media.length ? media : [{ url: '' }]).map((m, i) => ({
      key: i,
      url: m.url,
      kind: 'type' in m && m.type ? m.type : guess(m.url),
    })),
  )
  const [next, setNext] = useState(items.length)
  const update = (key: number, patch: Partial<Item>) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  return (
    <FormSheet
      title={t('marketing.format.title')}
      description={t('marketing.format.description')}
      action={setPostFormatAction.bind(null, slug, postId)}
      submitLabel={t('marketing.format.save')}
      trigger={
        <Button size="sm" variant="ghost" data-testid="post-format">
          <SlidersHorizontal /> {t('marketing.format.trigger')}
        </Button>
      }
    >
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">{t('marketing.format.type')}</legend>
        <div className="grid grid-cols-2 gap-2">
          {TYPES.map((x) => (
            <label
              key={x.value}
              className={cn(
                'flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-subtle',
                kind === x.value && 'border-accent bg-accent-soft/50',
              )}
            >
              <input
                type="radio"
                name="type"
                value={x.value}
                checked={kind === x.value}
                onChange={() => setKind(x.value)}
                className="sr-only"
              />
              <x.icon className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={1.5} />
              <span className="min-w-0">
                <span className="block font-medium">{t(`marketing.format.types.${x.value}`)}</span>
                <span className="block text-xs text-muted">{t(`marketing.format.typeHints.${x.value}`)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">{t('marketing.format.media')}</legend>
        <p className="text-xs text-muted">{t('marketing.format.mediaHint')}</p>
        {items.map((it, i) => (
          <div key={it.key} className="flex items-center gap-2">
            <Input
              name="url"
              type="url"
              inputMode="url"
              value={it.url}
              onChange={(e) => update(it.key, { url: e.target.value, kind: guess(e.target.value) })}
              placeholder="https://…"
              aria-label={t('marketing.format.itemUrl', { n: i + 1 })}
              className="min-w-0 flex-1"
            />
            <Select
              name="kind"
              value={it.kind}
              onChange={(e) => update(it.key, { kind: e.target.value as Kind })}
              aria-label={t('marketing.format.itemKind', { n: i + 1 })}
              className="w-auto"
            >
              <option value="image">{t('marketing.format.image')}</option>
              <option value="video">{t('marketing.format.video')}</option>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('marketing.format.removeItem', { n: i + 1 })}
              disabled={items.length === 1}
              onClick={() => setItems((list) => list.filter((x) => x.key !== it.key))}
            >
              <X />
            </Button>
          </div>
        ))}
        <FieldError name="url" />
        {items.length < MAX_ITEMS && (kind === 'carousel' || (kind === 'reel' && items.length < 2)) && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setItems((list) => [...list, { key: next, url: '', kind: 'image' }])
              setNext(next + 1)
            }}
          >
            <Plus /> {kind === 'reel' ? t('marketing.format.addCover') : t('marketing.format.addItem')}
          </Button>
        )}
      </fieldset>
    </FormSheet>
  )
}
