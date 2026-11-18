'use client'
import { DatabaseZap, ImageOff } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox, Select } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { studioPath } from '@/lib/paths'
import { cn } from '@/lib/utils'
import { type DesignSeedPreview, designSeedPlanAction, seedCrmFromDesignAction } from './seed-actions'

type ServiceAction = 'fill' | 'create' | 'skip'
type Plan = DesignSeedPreview['plan']

/** Same name (score 1) / Similar (≥ 0.5) / No match. */
function MatchLabel({ match }: { match: Plan['services'][number]['match'] }) {
  if (!match) return <Badge>No match</Badge>
  return match.score >= 1 ? (
    <Badge tone="success">Same name</Badge>
  ) : (
    <Badge tone="accent">Similar · {Math.round(match.score * 100)}%</Badge>
  )
}

/** The design's own picture (its data: URI), small; a placeholder without one. */
function Thumb({ src, className }: { src?: string; className?: string }) {
  return src ? (
    // biome-ignore lint/performance/noImgElement: a server-made thumbnail of the design's picture (data: URI)
    <img
      src={src}
      alt=""
      className={cn('size-12 shrink-0 rounded-lg border bg-subtle object-cover', className)}
    />
  ) : (
    <span
      className={cn(
        'grid size-12 shrink-0 place-items-center rounded-lg border bg-subtle text-muted',
        className,
      )}
    >
      <ImageOff className="size-4" />
    </span>
  )
}

const minutes = (d: number[]) => (d.length ? `${d.join(' · ')} min` : 'No durations')

/**
 * R28 P3 "Fill the CRM from the design": for a page whose design has window.CRM_DATA, the design's treatments with
 * their own pictures and the CRM treatment each pairs with (fill / create / skip), and its team photos to assign to
 * therapists. Applies straight to the CRM (live at once); prices are never changed.
 */
export function SeedSheet({
  slug,
  pageId,
  pageTitle,
  compact = false,
  onDone,
}: {
  slug: string
  pageId: string
  pageTitle: string
  /** A short trigger label (a Pages row). */
  compact?: boolean
  /** After the CRM was filled. */
  onDone?: () => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<DesignSeedPreview | null>(null)
  const [actions, setActions] = useState<Record<string, ServiceAction>>({})
  const [people, setPeople] = useState<Record<string, { staffId: string; showOnSite: boolean }>>({})
  const [replace, setReplace] = useState(false)
  const [loading, startLoad] = useTransition()
  const [saving, startSave] = useTransition()

  const load = () =>
    startLoad(async () => {
      const r = await designSeedPlanAction(slug, pageId)
      if (!r?.ok) {
        if (r) toast.error(r.error)
        setOpen(false)
        return
      }
      const p = r.data as unknown as DesignSeedPreview
      setPreview(p)
      setActions(Object.fromEntries(p.plan.services.map((s) => [s.designId, s.match ? 'fill' : 'skip'])))
      setPeople({})
      setReplace(false)
    })
  const onOpenChange = (o: boolean) => {
    setOpen(o)
    if (o) load()
    else setPreview(null)
  }

  const apply = () =>
    startSave(async () => {
      if (!preview) return
      const r = await seedCrmFromDesignAction(slug, {
        page: preview.page.id,
        hash: preview.hash,
        replace,
        services: preview.plan.services.map((s) => ({
          designId: s.designId,
          action: actions[s.designId] ?? 'skip',
          ...(actions[s.designId] === 'fill' && s.match ? { serviceId: s.match.serviceId } : {}),
        })),
        staff: Object.entries(people)
          .filter(([, v]) => v.staffId)
          .map(([designId, v]) => ({ designId, staffId: v.staffId, showOnSite: v.showOnSite })),
      })
      if (!r?.ok) {
        if (r) toast.error(r.error)
        return
      }
      toast.success(r.message ?? 'CRM updated')
      setOpen(false)
      setPreview(null)
      onDone?.()
      router.refresh()
    })

  const plan = preview?.plan
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Fill the CRM from the design"
      description={`${pageTitle}: the design’s treatments, photos and descriptions into this spa’s CRM.`}
      className="md:max-w-2xl"
      trigger={
        <Button
          variant="secondary"
          size="sm"
          className="h-10"
          aria-label={compact ? 'Fill the CRM from the design' : undefined}
        >
          <DatabaseZap /> {compact ? 'Fill the CRM' : 'Fill the CRM from the design'}
        </Button>
      }
    >
      {!plan || !preview ? (
        <p className="py-6 text-sm text-muted" aria-busy={loading}>
          Reading the design…
        </p>
      ) : (
        <div className="anim-fade-in space-y-6" data-testid="seed-sheet">
          <p role="note" className="rounded-xl bg-subtle px-4 py-3 text-sm">
            These change the CRM right away (treatments and therapists); the website shows them on its next
            load. Prices are never changed.
          </p>

          <section aria-labelledby="seed-services" className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="seed-services" className="text-sm font-semibold">
                Treatments in the design
              </h3>
              <p className="text-xs text-muted">{plan.services.length} found</p>
            </div>
            {plan.services.length === 0 ? (
              <p className="text-sm text-muted">The design lists no treatments.</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {plan.services.map((s) => (
                  <li
                    key={s.designId}
                    data-testid="seed-service"
                    className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-3">
                      <Thumb src={preview.pictures.services[s.designId]} />
                      <span className="min-w-0 space-y-0.5">
                        <span className="block truncate text-sm font-medium">{s.designName}</span>
                        <span className="block truncate text-xs text-muted">
                          {s.match ? <>CRM: {s.match.name}</> : 'Not in the CRM'} · {minutes(s.durations)}
                        </span>
                        <MatchLabel match={s.match} />
                      </span>
                    </span>
                    <Select
                      aria-label={`What to do with ${s.designName}`}
                      value={actions[s.designId] ?? 'skip'}
                      onChange={(e) => {
                        const v = e.currentTarget.value as ServiceAction
                        setActions((a) => ({ ...a, [s.designId]: v }))
                      }}
                      className="sm:w-56"
                    >
                      {s.match && <option value="fill">Fill photo & description</option>}
                      <option value="create">Create in CRM</option>
                      <option value="skip">Skip</option>
                    </Select>
                  </li>
                ))}
              </ul>
            )}
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <Checkbox
                checked={replace}
                onChange={(e) => setReplace(e.currentTarget.checked)}
                className="mt-0.5"
              />
              <span className="space-y-0.5">
                <span className="block font-medium">Replace existing photos</span>
                <span className="block text-[13px] text-muted">
                  Also over the photos and descriptions the CRM already has. Without it, only empty ones are
                  filled. Created treatments get the design’s durations, price on request.
                </span>
              </span>
            </label>
          </section>

          <section aria-labelledby="seed-team" className="space-y-3">
            <h3 id="seed-team" className="text-sm font-semibold">
              Team photos in the design
            </h3>
            {plan.staffPhotos.length === 0 ? (
              <p className="text-sm text-muted">The design has no team photos.</p>
            ) : plan.crmStaff.length === 0 ? (
              <p className="text-sm text-muted">
                The CRM has no therapists yet: add them first, then assign the photos here.
              </p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {plan.staffPhotos.map((s, i) => {
                  const pick = people[s.designId] ?? { staffId: '', showOnSite: false }
                  const label = s.name || `Photo ${i + 1}`
                  return (
                    <li
                      key={s.designId}
                      className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4"
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-3">
                        <Thumb src={preview.pictures.staff[s.designId]} />
                        <span className="truncate text-sm font-medium">{label}</span>
                      </span>
                      <Select
                        aria-label={`Therapist for ${label}`}
                        value={pick.staffId}
                        onChange={(e) => {
                          const staffId = e.currentTarget.value
                          setPeople((p) => ({ ...p, [s.designId]: { ...pick, staffId } }))
                        }}
                        className="sm:w-56"
                      >
                        <option value="">Nobody</option>
                        {plan.crmStaff.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {p.hasPhoto ? ' (has a photo)' : ''}
                          </option>
                        ))}
                      </Select>
                      <label className="flex shrink-0 items-center gap-2 text-sm">
                        <Checkbox
                          checked={pick.showOnSite}
                          disabled={!pick.staffId}
                          aria-label={`Show ${label} on website`}
                          onChange={(e) => {
                            const showOnSite = e.currentTarget.checked
                            setPeople((p) => ({ ...p, [s.designId]: { ...pick, showOnSite } }))
                          }}
                        />
                        Show on website
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <p className="text-[13px] text-muted">
            Every picture of the design also goes into the spa’s media library (once, even when applied
            again).
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
              Not now
            </Button>
            <Button onClick={apply} pending={saving}>
              Fill the CRM
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

/**
 * The step offered right after applying an HTML design with window.CRM_DATA (`?seed={pageId}`, set by the apply
 * forms in website-client.tsx): fill the CRM from it. Non-modal, so publishing first stays one click away.
 */
export function SeedOffer({ slug, pages }: { slug: string; pages: { id: string; title: string }[] }) {
  const seed = useSearchParams().get('seed')
  const page = seed ? pages.find((p) => p.id === seed) : undefined
  if (!page) return null
  const dismiss = () => window.history.replaceState(null, '', studioPath(slug))
  return (
    <Card
      className="anim-fade-in flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 sm:px-6"
      data-testid="seed-offer"
    >
      <DatabaseZap className="size-5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">Next: fill the CRM from the design</p>
        <p className="text-sm text-muted">
          The design brings its own treatment photos, descriptions and team photos. Put them into the spa’s
          CRM (missing treatments can be created); prices stay as they are.
        </p>
      </div>
      <span className="flex flex-wrap items-center gap-2">
        <SeedSheet slug={slug} pageId={page.id} pageTitle={page.title} onDone={dismiss} />
        <Button variant="ghost" size="sm" className="h-10" onClick={dismiss}>
          Not now
        </Button>
      </span>
    </Card>
  )
}
