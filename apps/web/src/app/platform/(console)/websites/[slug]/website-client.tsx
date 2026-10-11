'use client'
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
import { studioPath } from '@/lib/paths'
import { cn } from '@/lib/utils'
import {
  addPageFromTemplateAction,
  applyTemplateAction,
  publishSiteAction,
  saveThemeAction,
  setPageVisibleAction,
  undoTemplateAction,
} from './actions'
import { resolveChangeAction } from './studio-actions'
import { type WriteTextsResult, writeTextsAction } from './write-texts-actions'

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

/**
 * R23 "Write texts": the AI drafts the texts of every page in EN + AR from the spa's own data (drafts only; images
 * and layout stay). Shown to SITE_AI_EDITOR_EMAILS super-admins only; the action re-checks.
 */
export function WriteTextsSheet({ slug, ready }: { slug: string; ready: boolean }) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [done, setDone] = useState<{ message: string; result: WriteTextsResult } | null>(null)
  const [pending, start] = useTransition()

  const write = () =>
    start(async () => {
      const r = await writeTextsAction(slug, { notes })
      if (r?.ok) setDone({ message: r.message ?? '', result: r.data as WriteTextsResult })
      else if (r) toast.error(r.error)
    })

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setDone(null)
      }}
      title="Write texts with AI"
      description="Drafts the texts of every page in English and Arabic from the spa's own details: name, services and prices, branches, opening hours and contact. Images and layout stay as they are."
      className="md:max-w-xl"
      trigger={
        <Button variant="secondary">
          <Sparkles /> Write texts
        </Button>
      }
    >
      {!ready ? (
        <div className="anim-fade-in flex flex-col items-center gap-3 rounded-xl bg-subtle px-6 py-10 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-surface text-muted">
            <Sparkles className="size-5" strokeWidth={1.75} />
          </span>
          <p className="text-[15px] font-medium">AI isn't set up yet</p>
          <p className="max-w-sm text-sm text-muted">
            Add the ModelArk key and switch on the site editor model in AI models. You can still edit every
            word in the editor.
          </p>
        </div>
      ) : !done ? (
        <div className="anim-fade-in space-y-5">
          <Field
            label="Anything to highlight? (optional)"
            name="write-notes"
            hint="We already use the spa's services, prices, branches, hours, contact and brand voice."
          >
            <Textarea
              id="write-notes"
              value={notes}
              maxLength={400}
              onChange={(e) => setNotes(e.currentTarget.value)}
              placeholder="e.g. female therapists, free parking, open until 2 am"
            />
          </Field>
          <p className="text-[13px] text-muted">
            Every page's texts are replaced in its draft — nothing is published. A page open in someone else's
            editor is skipped. It can take a minute or two.
          </p>
          <Button onClick={write} pending={pending} className="h-11 w-full sm:w-auto">
            <Sparkles /> Write texts
          </Button>
        </div>
      ) : (
        <div className="anim-fade-in space-y-5">
          <p role="status" className="text-sm">
            {done.message}
          </p>
          {done.result.pages.length > 0 && (
            <ul aria-label="Drafted pages" className="divide-y rounded-xl border">
              {done.result.pages.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{p.title}</span>{' '}
                    <span className="text-muted">· {p.filled} texts</span>
                  </span>
                  <Button variant="ghost" size="sm" asChild>
                    <a href={studioPath(slug, `/editor/${p.id}`)}>
                      Open editor <ArrowRight />
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[13px] text-muted">Read each page, adjust what you like, then Publish.</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setDone(null)} className="h-11">
              Write again
            </Button>
            <Button onClick={() => setOpen(false)} className="h-11">
              Done
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
