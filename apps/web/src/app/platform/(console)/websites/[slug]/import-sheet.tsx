'use client'
import { Download, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/form'
import { Checkbox, Input, Label } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { importSiteApplyAction, importSitePreviewAction } from './import-actions'

type SiteView = {
  url: string
  host: string
  pages: string[]
  name: string | null
  headline: string | null
  description: string | null
  sections: string[]
  services: string[]
  visit: string[]
  images: { url: string; alt: string }[]
}
type Preview = {
  site: SiteView
  skipped: { url: string; reason: string }[]
  ops: { op: string }[]
  images: string[]
  summary: string[]
  note: string
  ai: boolean
  slug: string
  title: string
}

const fileName = (u: string) => {
  try {
    return decodeURIComponent(new URL(u).pathname.split('/').pop() || u)
  } catch {
    return u
  }
}

function FieldErr({ text }: { text?: string }) {
  return text ? <p className="text-[13px] text-danger">{text}</p> : null
}

function Found({ label, items, empty }: { label: string; items: string[]; empty?: string }) {
  return (
    <div className="grid gap-1 border-t py-3 first:border-t-0 sm:grid-cols-[9rem_1fr] sm:gap-5">
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted sm:pt-0.5">{label}</p>
      {items.length ? (
        <ul className="min-w-0 space-y-1 text-sm">
          {[...new Set(items)].slice(0, 12).map((x) => (
            <li key={x} className="break-words">
              {x}
            </li>
          ))}
          {items.length > 12 && <li className="text-muted">+ {items.length - 12} more</li>}
        </ul>
      ) : (
        <p className="text-sm text-muted">{empty ?? 'Nothing found'}</p>
      )}
    </div>
  )
}

/**
 * F32 Studio "Import from existing website" (super-admin tooling, EN UI): address → server reads the public site →
 * preview of what was found and the draft page it builds (dry run) → Create draft page (images into the media
 * library; never published) → opens it in the editor.
 */
export function ImportSiteSheet({ slug, aiAvailable }: { slug: string; aiAvailable: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [page, setPage] = useState('imported')
  const [title, setTitle] = useState('Imported site')
  const [ai, setAi] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<Preview | null>(null)
  const [pending, start] = useTransition()

  const fetchPreview = () =>
    start(async () => {
      setErrors({})
      const r = await importSitePreviewAction(slug, { url, slug: page, title, ai })
      if (r?.ok) setPreview(r.data as unknown as Preview)
      else if (r) {
        setErrors(r.fieldErrors ?? {})
        toast.error(r.error)
      }
    })
  const apply = () =>
    start(async () => {
      if (!preview) return
      const r = await importSiteApplyAction(slug, {
        url: preview.site.url,
        slug: preview.slug,
        title: preview.title,
        ops: preview.ops,
        images: preview.images,
        ai: preview.ai,
      })
      if (!r?.ok) {
        if (r) toast.error(r.error)
        return
      }
      toast.success(r.message ?? 'Imported as a draft page')
      setOpen(false)
      setPreview(null)
      const href = r.data?.editorHref
      if (typeof href === 'string') router.push(href)
      else router.refresh()
    })

  const site = preview?.site
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setPreview(null)
      }}
      title="Import from existing website"
      description="We read the spa's current public website and build a new draft page from its text, prices, hours, contact details and photos. Nothing is published."
      className="md:max-w-2xl"
      trigger={
        <Button variant="secondary" size="sm" className="h-10">
          <Download /> Import from website
        </Button>
      }
    >
      {!preview || !site ? (
        <div className="anim-fade-in space-y-5">
          <Field label="Current website address" name="import-url">
            <Input
              id="import-url"
              value={url}
              inputMode="url"
              autoComplete="off"
              placeholder="www.spa-name.ae"
              onChange={(e) => setUrl(e.currentTarget.value)}
            />
            <FieldErr text={errors.url} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New page address" name="import-slug" hint="Added as a hidden draft">
              <Input id="import-slug" value={page} onChange={(e) => setPage(e.currentTarget.value)} />
              <FieldErr text={errors.slug} />
            </Field>
            <Field label="Page name" name="import-title">
              <Input id="import-title" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
              <FieldErr text={errors.title} />
            </Field>
          </div>
          {aiAvailable && (
            <div className="flex items-start gap-3 rounded-xl border p-4">
              <Checkbox
                id="import-ai"
                checked={ai}
                onChange={(e) => setAi(e.currentTarget.checked)}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <Label htmlFor="import-ai" className="font-medium">
                  Arrange the content with AI
                </Label>
                <p className="text-[13px] text-muted">
                  Uses the platform AI (counts toward this spa’s AI budget). Without it, a standard layout is
                  used.
                </p>
              </div>
            </div>
          )}
          <p className="text-[13px] text-muted">
            Only public pages are read (up to 5, robots.txt respected). Photos are copied into the spa’s media
            library when you create the page.
          </p>
          <Button onClick={fetchPreview} pending={pending} className="h-11 w-full sm:w-auto">
            <Download /> Fetch and preview
          </Button>
        </div>
      ) : (
        <div className="anim-fade-in space-y-5">
          <p className="text-sm text-muted">
            From <span className="font-medium text-fg">{site.host}</span> · {site.pages.length}{' '}
            {site.pages.length === 1 ? 'page' : 'pages'} read
            {preview.ai && (
              <span className="ms-2 inline-flex items-center gap-1 text-accent">
                <Sparkles className="size-3.5" /> arranged with AI
              </span>
            )}
          </p>
          {preview.note && (
            <p role="note" className="rounded-xl bg-subtle px-4 py-3 text-sm">
              {preview.note}
            </p>
          )}
          <section aria-label="Found on the site" className="rounded-xl border px-4 sm:px-5">
            <Found
              label="Headline"
              items={[site.headline, site.description].filter((x): x is string => !!x)}
            />
            <Found label="Sections" items={site.sections} />
            <Found label="Treatments & prices" items={site.services} empty="No prices found" />
            <Found label="Hours & contact" items={site.visit} />
            <Found
              label="Photos"
              items={site.images.map((i) => i.alt || fileName(i.url))}
              empty="No photos found"
            />
          </section>
          <section aria-label="The new draft page" className="space-y-2">
            <h3 className="text-sm font-semibold">The draft page /{preview.slug} will contain</h3>
            <ul className="list-disc space-y-1 ps-5 text-sm text-muted">
              {[...new Set(preview.summary)].slice(0, 14).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </section>
          {preview.skipped.length > 0 && (
            <p className="text-[13px] text-muted">
              Skipped: {preview.skipped.map((s) => `${fileName(s.url) || s.url} (${s.reason})`).join(', ')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setPreview(null)} disabled={pending}>
              Back
            </Button>
            <Button onClick={apply} pending={pending}>
              Create draft page
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
