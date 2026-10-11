'use client'
import type { SiteCopy } from '@spa/services'
import { ArrowRight, FilePlus2, History, Paintbrush, Rocket, Sparkles, Undo2 } from 'lucide-react'
import { useOptimistic, useState, useTransition } from 'react'
import { ScaledFrame } from '@/components/site/scaled-frame'
import { BACKDROPS, EMBLEMS, type SiteTheme } from '@/components/site/theme'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Checkbox, Input, Label, Select, Textarea } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import {
  addPageFromTemplateAction,
  applySiteCopyAction,
  applyTemplateAction,
  generateSiteCopyAction,
  publishSiteAction,
  type SiteCopyPreview,
  saveThemeAction,
  setPageVisibleAction,
  undoTemplateAction,
} from './actions'
import { resolveChangeAction } from './studio-actions'

/** First template pick: creates the site with the template's starter pages. */
export function UseTemplateButton({
  slug,
  template,
  name,
}: {
  slug: string
  template: string
  name: string
}) {
  return (
    <ActionForm action={applyTemplateAction.bind(null, slug)}>
      <input type="hidden" name="template" value={template} />
      <SubmitButton className="h-11 w-full" aria-label={`Use ${name}`}>
        Use {name}
      </SubmitButton>
    </ActionForm>
  )
}

/**
 * Switching template later: a side-by-side of the site now and after the switch. Tokens always change;
 * starter content only when asked (as drafts). Undo stays available on the website page.
 */
export function ApplyTemplateSheet({
  slug,
  template,
  name,
  currentName,
  hasLiveContent,
  nowSrc,
  keepSrc,
  starterSrc,
}: {
  slug: string
  template: string
  name: string
  currentName: string
  hasLiveContent: boolean
  nowSrc: string
  keepSrc: string
  starterSrc: string
}) {
  const [replace, setReplace] = useState(!hasLiveContent)
  return (
    <FormSheet
      title={`Switch to ${name}?`}
      description="Colours, fonts, shapes and motion change right away. Your words and images stay."
      className="md:max-w-3xl"
      trigger={
        <Button variant="secondary" className="h-11 w-full" aria-label={`Apply ${name}`}>
          Apply
        </Button>
      }
      action={applyTemplateAction.bind(null, slug)}
      submitLabel={`Switch to ${name}`}
    >
      <input type="hidden" name="template" value={template} />
      <div className="grid gap-4 sm:grid-cols-2">
        <figure className="m-0 space-y-2">
          <figcaption className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
            Now · {currentName}
          </figcaption>
          <ScaledFrame
            src={nowSrc}
            title={`${currentName} now`}
            className="aspect-[16/11] rounded-lg border"
          />
        </figure>
        <figure className="m-0 space-y-2">
          <figcaption className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.08em] text-accent">
            <ArrowRight className="size-3.5 rtl:rotate-180" /> After · {name}
          </figcaption>
          <ScaledFrame
            key={replace ? 'starter' : 'keep'}
            src={replace ? starterSrc : keepSrc}
            title={`${name} after`}
            className="aspect-[16/11] rounded-lg border"
          />
        </figure>
      </div>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-sm transition-colors has-[:checked]:border-accent/40 has-[:checked]:bg-accent-soft/40">
        <Checkbox
          name="replaceContent"
          checked={replace}
          onChange={(e) => setReplace(e.currentTarget.checked)}
          className="mt-0.5"
        />
        <span className="space-y-1">
          <span className="block font-medium">Also start from its sample pages</span>
          <span className="block text-muted">
            Replaces your pages with this template's layout as drafts (missing pages are added). Nothing
            changes on your live site until you publish.
          </span>
        </span>
      </label>
      <p className="flex items-center gap-2 text-[13px] text-muted">
        <History className="size-4 shrink-0" /> Changed your mind? Undo it in one click afterwards.
      </p>
    </FormSheet>
  )
}

/** Shown after a template switch: what changed, with one-click undo. */
export function UndoTemplateBar({
  slug,
  from,
  to,
  at,
  pages,
}: {
  slug: string
  from: string
  to: string
  at: string
  pages: number
}) {
  return (
    <Card className="anim-fade-in flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <History className="size-[18px]" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className="text-[15px] font-medium">
            {from === to ? `New ${to} starter drafts` : `Switched from ${from} to ${to}`}
          </p>
          <p className="text-sm text-muted">
            {at} ·{' '}
            {pages
              ? `${pages} ${pages === 1 ? 'page' : 'pages'} got new drafts · undo is available until you edit or publish them`
              : 'Colours, fonts and shapes only · undo is available until you change the theme'}
          </p>
        </div>
      </div>
      <ActionForm action={undoTemplateAction.bind(null, slug)}>
        <SubmitButton variant="secondary" className="h-11 w-full sm:w-auto">
          <Undo2 /> Undo
        </SubmitButton>
      </ActionForm>
    </Card>
  )
}

/** Adds a whole page (Ramadan offers, Couples package…) as a draft. */
export function AddPageSheet({
  slug,
  templates,
}: {
  slug: string
  templates: { key: string; name: string; description: string; slug: string }[]
}) {
  return (
    <FormSheet
      title="Add a page"
      description="Start from a designed page. It is added as a draft with your theme and live prices."
      className="md:max-w-xl"
      trigger={
        <Button variant="secondary" size="sm" className="h-10">
          <FilePlus2 /> Add page
        </Button>
      }
      action={addPageFromTemplateAction.bind(null, slug)}
      submitLabel="Add page"
    >
      <div className="grid gap-2" role="radiogroup" aria-label="Page template">
        {templates.map((t, i) => (
          <label
            key={t.key}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors hover:border-fg/20 has-[:checked]:border-accent has-[:checked]:bg-accent-soft/50"
          >
            <input
              type="radio"
              name="template"
              value={t.key}
              defaultChecked={i === 0}
              className="mt-1 size-4 accent-[var(--accent)]"
            />
            <span className="min-w-0 space-y-0.5">
              <span className="block text-sm font-medium">{t.name}</span>
              <span className="block text-[13px] text-muted">{t.description}</span>
              <span className="block text-xs text-muted">/{t.slug}</span>
            </span>
          </label>
        ))}
      </div>
    </FormSheet>
  )
}

type Lang = 'en' | 'ar'
type Bi = { en: string; ar?: string }

function CopyRow({ label, before, after, lang }: { label: string; before?: Bi; after: Bi; lang: Lang }) {
  const now = (lang === 'ar' ? before?.ar : before?.en)?.trim()
  const next = lang === 'ar' ? after.ar || after.en : after.en
  return (
    <div className="grid gap-2 border-t py-4 first:border-t-0 sm:grid-cols-[9rem_1fr] sm:gap-5">
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted sm:pt-0.5">{label}</p>
      <div className="min-w-0 space-y-1.5" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
        {now && now !== next && (
          <p className="whitespace-pre-line text-sm text-muted line-through decoration-border">{now}</p>
        )}
        <p className="whitespace-pre-line text-sm">{next}</p>
      </div>
    </div>
  )
}

/** What "Apply as drafts" will do, in plain words (see `SiteCopyMode`). */
const APPLY_NOTE: Record<SiteCopyPreview['mode'], (name: string) => string> = {
  new: (name) =>
    `Applying creates your site from ${name} with this copy as drafts. Nothing goes live until you publish.`,
  'in-place': () =>
    'Applying writes this copy into your pages as drafts. Your layout, images and colours stay as they are, and nothing goes live until you publish.',
  starter: (name) =>
    `Your pages don't have matching text areas yet, so applying replaces each page's draft with the ${name} starter layout filled with this copy — sections, images and order you changed are replaced. Your colours stay; nothing goes live until you publish, and you can undo it.`,
  switch: (name) =>
    `Applying switches your site to ${name}: its colours, fonts and shapes change on your live site right away, and each page's draft is replaced with the ${name} starter layout filled with this copy. Pages go live only when you publish, and you can undo the switch.`,
}

/**
 * "Write my site with AI": spa facts → hero, about, USPs, FAQs and CTA in EN + AR, previewed against what the
 * site says now, then applied to the chosen template's pages as drafts.
 */
export function AiWriterSheet({
  slug,
  ready,
  templates,
  current,
}: {
  slug: string
  ready: boolean
  templates: { key: string; name: string }[]
  current: string
}) {
  const [open, setOpen] = useState(false)
  const [template, setTemplate] = useState(current)
  const [notes, setNotes] = useState('')
  const [preview, setPreview] = useState<SiteCopyPreview | null>(null)
  const [lang, setLang] = useState<Lang>('en')
  const [pending, start] = useTransition()

  const generate = () =>
    start(async () => {
      const r = await generateSiteCopyAction(slug, { template, notes })
      if (r.ok) setPreview(r.preview)
      else toast.error(r.error)
    })
  const apply = (copy: SiteCopy) =>
    start(async () => {
      const r = await applySiteCopyAction(slug, { template: preview?.template ?? template, copy })
      if (r?.ok) {
        toast.success(r.message ?? 'Saved as drafts')
        setOpen(false)
        setPreview(null)
      } else if (r) toast.error(r.error)
    })

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="Write my site with AI"
      description="Headline, about text, reasons to visit, FAQs and a booking prompt — in English and Arabic."
      className="md:max-w-2xl"
      trigger={
        <Button variant="secondary">
          <Sparkles /> Write with AI
        </Button>
      }
    >
      {!ready ? (
        <div className="anim-fade-in flex flex-col items-center gap-3 rounded-xl bg-subtle px-6 py-10 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-surface text-muted">
            <Sparkles className="size-5" strokeWidth={1.75} />
          </span>
          <p className="text-[15px] font-medium">AI writing isn't set up yet</p>
          <p className="max-w-sm text-sm text-muted">
            The platform hasn't switched on the AI writer yet. You can still edit every word in the editor.
          </p>
        </div>
      ) : !preview ? (
        <div className="anim-fade-in space-y-5">
          <Field label="Template" name="ai-template">
            <Select id="ai-template" value={template} onChange={(e) => setTemplate(e.currentTarget.value)}>
              {templates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Anything to highlight? (optional)"
            name="ai-notes"
            hint="We already use your services, prices, hours, address and brand voice."
          >
            <Textarea
              id="ai-notes"
              value={notes}
              maxLength={400}
              onChange={(e) => setNotes(e.currentTarget.value)}
              placeholder="e.g. female therapists, free parking, open until 2 am"
            />
          </Field>
          <Button onClick={generate} pending={pending} className="h-11 w-full sm:w-auto">
            <Sparkles /> Write my site
          </Button>
        </div>
      ) : (
        <div className="anim-fade-in space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              For <span className="font-medium text-fg">{preview.templateName}</span> ·{' '}
              {preview.current
                ? 'crossed-out text is what your pages say now.'
                : "your pages don't have matching text areas yet, so there is nothing to compare."}
            </p>
            <div className="inline-flex rounded-lg border p-0.5" role="radiogroup" aria-label="Language">
              {(['en', 'ar'] as const).map((l) => (
                <label
                  key={l}
                  className={cn(
                    'grid min-h-10 min-w-16 cursor-pointer place-items-center rounded-md px-3 text-sm transition-colors',
                    lang === l ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg',
                  )}
                >
                  <input
                    type="radio"
                    name="ai-lang"
                    value={l}
                    checked={lang === l}
                    onChange={() => setLang(l)}
                    className="sr-only"
                  />
                  {l === 'en' ? 'English' : 'عربي'}
                </label>
              ))}
            </div>
          </div>
          <div className="rounded-xl border px-4 sm:px-5">
            <CopyRow
              label="Headline"
              before={preview.current?.hero.headline}
              after={preview.proposed.hero.headline}
              lang={lang}
            />
            <CopyRow
              label="Subheading"
              before={preview.current?.hero.sub}
              after={preview.proposed.hero.sub}
              lang={lang}
            />
            <CopyRow
              label="About"
              before={preview.current?.about}
              after={preview.proposed.about}
              lang={lang}
            />
            {preview.proposed.usps.map((u, i) => (
              <CopyRow
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed three positions
                key={i}
                label={`Reason ${i + 1}`}
                before={preview.current?.usps[i]?.title}
                after={{ en: `${u.title.en} — ${u.text.en}`, ar: `${u.title.ar} — ${u.text.ar}` }}
                lang={lang}
              />
            ))}
            {preview.proposed.faqs.map((f, i) => (
              <CopyRow
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed four positions
                key={i}
                label={`FAQ ${i + 1}`}
                before={preview.current?.faqs[i]?.q}
                after={{ en: `${f.q.en}\n${f.a.en}`, ar: `${f.q.ar}\n${f.a.ar}` }}
                lang={lang}
              />
            ))}
            <CopyRow
              label="Booking prompt"
              before={preview.current?.cta.title}
              after={{
                en: `${preview.proposed.cta.title.en} — ${preview.proposed.cta.text.en}`,
                ar: `${preview.proposed.cta.title.ar} — ${preview.proposed.cta.text.ar}`,
              }}
              lang={lang}
            />
          </div>
          <p className="text-[13px] text-muted" data-testid="ai-apply-note">
            {APPLY_NOTE[preview.mode](preview.templateName)}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setPreview(null)} disabled={pending} className="h-11">
              Start over
            </Button>
            <Button variant="secondary" onClick={generate} pending={pending} className="h-11">
              Write again
            </Button>
            <Button onClick={() => apply(preview.proposed)} pending={pending} className="h-11">
              Apply as drafts
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

export function PublishSiteSheet({
  slug,
  pending,
  theme = false,
  themeWarnings = [],
  defaultOpen = false,
}: {
  slug: string
  pending: number
  /** The console list's "Publish" step lands here with the sheet open. */
  defaultOpen?: boolean
  /** An unpublished draft theme (Ask AI / Claude) goes live with it, on every page. */
  theme?: boolean
  themeWarnings?: string[]
}) {
  const what = [
    pending ? `${pending} ${pending === 1 ? 'page has' : 'pages have'} unpublished changes` : null,
    theme ? `${pending ? 'the' : 'The'} site theme has unpublished changes (every page)` : null,
  ].filter(Boolean)
  return (
    <FormSheet
      title="Publish your site?"
      description={`${what.join('; ')}. Visitors will see them immediately.`}
      defaultOpen={defaultOpen}
      trigger={
        <Button>
          <Rocket /> Publish site
        </Button>
      }
      action={publishSiteAction.bind(null, slug)}
      submitLabel="Publish now"
    >
      <p className="text-sm text-muted">
        Prices, team and opening hours always show live data from your dashboard.
      </p>
      {themeWarnings.length > 0 && (
        <ul aria-label="Theme checks" className="mt-3 space-y-1 text-xs text-muted">
          {themeWarnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </FormSheet>
  )
}

/** Show / hide a page in the site navigation (home is always visible). */
export function VisibilityToggle({
  slug,
  pageId,
  visible,
  disabled,
  label,
}: {
  slug: string
  pageId: string
  visible: boolean
  disabled?: boolean
  label: string
}) {
  const [pending, start] = useTransition()
  const [optimistic, setOptimistic] = useOptimistic(visible)
  return (
    <button
      type="button"
      role="switch"
      aria-checked={optimistic}
      aria-label={`${label} visible`}
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          setOptimistic(!optimistic)
          const r = await setPageVisibleAction(slug, pageId, !optimistic)
          if (r && !r.ok) toast.error(r.error)
        })
      }
      className="group inline-flex min-h-11 items-center gap-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span
        className={cn(
          'relative h-6 w-10 rounded-full transition-colors duration-200',
          optimistic ? 'bg-accent' : 'bg-border',
        )}
      >
        <span
          className={cn(
            'absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[var(--ease-calm)]',
            optimistic && 'translate-x-4',
          )}
        />
      </span>
      <span className="text-muted">{optimistic ? 'Visible' : 'Hidden'}</span>
    </button>
  )
}

/**
 * The LIVE theme. With an unpublished AI theme draft (Ask AI / Claude MCP) the panel says so: only the fields
 * changed here are saved (live, and into the draft too), the rest of the draft waits for a publish.
 */
export function ThemeSheet({
  slug,
  theme,
  draft = false,
}: {
  slug: string
  theme: SiteTheme
  draft?: boolean
}) {
  return (
    <FormSheet
      title="Theme"
      description="Fine-tune the template. Changes are live on your site right away."
      trigger={
        <Button variant="secondary" className="w-full sm:w-auto">
          <Paintbrush /> Theme
        </Button>
      }
      action={saveThemeAction.bind(null, slug)}
      submitLabel="Save theme"
    >
      {draft && (
        <p role="note" className="mb-4 rounded-xl border bg-subtle/50 p-3 text-sm">
          An unpublished theme draft (Ask AI / Claude) is waiting. This shows the live theme: what you change
          here goes live now and into the draft; the rest of the draft goes live when you publish.
        </p>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Accent colour" name="accent">
          <span className="flex items-center gap-2">
            <Input
              id="accent"
              name="accent"
              type="color"
              defaultValue={theme.accent}
              className="h-11 w-16 p-1"
            />
            <span className="text-xs text-muted">Buttons, links, highlights</span>
          </span>
        </Field>
        <Field label="Text on accent" name="accentFg">
          <span className="flex items-center gap-2">
            <Input
              id="accentFg"
              name="accentFg"
              type="color"
              defaultValue={theme.accentFg}
              className="h-11 w-16 p-1"
            />
            <span className="text-xs text-muted">Keep it readable</span>
          </span>
        </Field>
        <Field label="Headings" name="headingFont">
          <Select id="headingFont" name="headingFont" defaultValue={theme.headingFont}>
            <option value="serif">Serif — classic, calm</option>
            <option value="sans">Sans — clean, modern</option>
          </Select>
        </Field>
        <Field label="Corners" name="radius">
          <Select id="radius" name="radius" defaultValue={theme.radius}>
            <option value="none">Square</option>
            <option value="soft">Soft</option>
            <option value="round">Round</option>
          </Select>
        </Field>
        <Field label="Buttons" name="buttonShape">
          <Select id="buttonShape" name="buttonShape" defaultValue={theme.buttonShape}>
            <option value="square">Square</option>
            <option value="rounded">Rounded</option>
            <option value="pill">Pill</option>
          </Select>
        </Field>
        <Field label="Spacing" name="density">
          <Select id="density" name="density" defaultValue={theme.density}>
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
            <option value="airy">Airy</option>
          </Select>
        </Field>
        <Field label="Hero art" name="backdrop">
          <Select id="backdrop" name="backdrop" defaultValue={theme.backdrop ?? 'none'}>
            {BACKDROPS.map((b) => (
              <option key={b} value={b} className="capitalize">
                {b === 'none' ? 'None' : b}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Hero emblem" name="emblem">
          <Select id="emblem" name="emblem" defaultValue={theme.emblem ?? 'none'}>
            {EMBLEMS.map((e) => (
              <option key={e} value={e}>
                {e === 'none' ? 'None (photo)' : e}
              </option>
            ))}
          </Select>
        </Field>
        <div className="space-y-2 sm:col-span-2">
          <Label>Motion</Label>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Motion">
            {(['none', 'subtle', 'expressive'] as const).map((m) => (
              <label
                key={m}
                className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border text-sm capitalize transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent"
              >
                <input
                  type="radio"
                  name="motion"
                  value={m}
                  defaultChecked={theme.motion === m}
                  className="sr-only"
                />
                {m}
              </label>
            ))}
          </div>
          <p className="text-[13px] text-muted">
            Visitors who prefer reduced motion always get gentle fades.
          </p>
        </div>
      </div>
    </FormSheet>
  )
}

/** Closes a spa's change request as done or declined, with an optional note the spa sees next to it. */
export function ResolveRequestSheet({ slug, id }: { slug: string; id: string }) {
  return (
    <FormSheet
      title="Close this request"
      description="The spa sees the outcome and your note next to their request."
      trigger={
        <Button variant="secondary" size="sm" className="h-10">
          Mark done
        </Button>
      }
      action={resolveChangeAction.bind(null, slug)}
      submitLabel="Close request"
    >
      <input type="hidden" name="id" value={id} />
      <Field label="Outcome" name="status">
        <Select id="status" name="status" defaultValue="done">
          <option value="done">Done</option>
          <option value="declined">Declined</option>
        </Select>
      </Field>
      <Field label="Note to the spa (optional)" name="response">
        <Textarea id="response" name="response" maxLength={2000} />
      </Field>
    </FormSheet>
  )
}
