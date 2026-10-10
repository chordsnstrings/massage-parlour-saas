import { plans, platformDb, tenants } from '@spa/db'
import { type AnnouncementRow, listAnnouncements } from '@spa/services'
import { asc, isNull } from 'drizzle-orm'
import { BellRing, Plus } from 'lucide-react'
import type { Metadata } from 'next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { formatDateTime } from '@/lib/utils'
import { deleteAnnouncementAction, endAnnouncementAction, saveAnnouncementAction } from './actions'

export const metadata: Metadata = { title: 'Announcements' }

/** Instant → `datetime-local` value in Dubai time (UTC+4, no DST). */
const dubaiLocal = (d: Date) => new Date(d.getTime() + 4 * 3_600_000).toISOString().slice(0, 16)

type Options = { plans: { code: string; name: string }[]; spas: { id: string; name: string; slug: string }[] }

function AnnouncementFields({ a, options }: { a?: AnnouncementRow; options: Options }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {a && <input type="hidden" name="id" value={a.id} />}
      <Field label="Title (English)" name="titleEn">
        <Input id="titleEn" name="titleEn" defaultValue={a?.titleEn} required maxLength={120} />
      </Field>
      <Field label="Title (Thai)" name="titleTh" hint="Optional — English is shown when empty.">
        <Input id="titleTh" name="titleTh" defaultValue={a?.titleTh ?? ''} maxLength={120} lang="th" />
      </Field>
      <Field label="Message (English)" name="bodyEn">
        <Textarea id="bodyEn" name="bodyEn" defaultValue={a?.bodyEn} required maxLength={1000} />
      </Field>
      <Field label="Message (Thai)" name="bodyTh">
        <Textarea id="bodyTh" name="bodyTh" defaultValue={a?.bodyTh ?? ''} maxLength={1000} lang="th" />
      </Field>
      <Field label="Severity" name="severity">
        <Select id="severity" name="severity" defaultValue={a?.severity ?? 'info'}>
          <option value="info">Info (green)</option>
          <option value="warning">Warning (amber)</option>
          <option value="critical">Critical (red)</option>
        </Select>
      </Field>
      <Field label="Show to" name="audience" hint="Plan / spa choices below apply to that audience only.">
        <Select id="audience" name="audience" defaultValue={a?.audience ?? 'all'}>
          <option value="all">Every spa</option>
          <option value="plan">Spas on the plans ticked below</option>
          <option value="tenants">The spas selected below</option>
        </Select>
      </Field>
      <fieldset className="space-y-2 text-sm">
        <legend className="mb-1.5 font-medium">Plans</legend>
        {options.plans.map((p) => (
          <label key={p.code} className="flex items-center gap-2.5">
            <Checkbox name="planCodes" value={p.code} defaultChecked={a?.planCodes.includes(p.code)} />{' '}
            {p.name}
          </label>
        ))}
      </fieldset>
      <Field label="Spas" name="tenantIds" hint="Ctrl/⌘-click to pick several.">
        <Select
          id="tenantIds"
          name="tenantIds"
          multiple
          size={Math.min(6, Math.max(3, options.spas.length))}
          defaultValue={a?.tenantIds ?? []}
          className="h-auto"
        >
          {options.spas.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.slug})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Show from (Dubai time)" name="startsAt">
        <Input
          id="startsAt"
          name="startsAt"
          type="datetime-local"
          defaultValue={dubaiLocal(a?.startsAt ?? new Date())}
          required
        />
      </Field>
      <Field label="Until (Dubai time)" name="endsAt" hint="Empty = until you end it.">
        <Input
          id="endsAt"
          name="endsAt"
          type="datetime-local"
          defaultValue={a?.endsAt ? dubaiLocal(a.endsAt) : ''}
        />
      </Field>
    </div>
  )
}

function state(a: AnnouncementRow, now: Date) {
  if (a.endsAt && a.endsAt <= now) return { label: 'ended', tone: 'neutral' as const }
  if (a.startsAt > now) return { label: 'scheduled', tone: 'warning' as const }
  return { label: 'live', tone: 'success' as const }
}

const SEVERITY_TONE = { info: 'success', warning: 'warning', critical: 'danger' } as const

export default async function AnnouncementsPage() {
  const db = platformDb()
  const [rows, planRows, spas] = await Promise.all([
    listAnnouncements(db),
    db.select({ code: plans.code, name: plans.name }).from(plans).orderBy(asc(plans.sort)),
    db
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
      .from(tenants)
      .where(isNull(tenants.deletedAt))
      .orderBy(asc(tenants.name)),
  ])
  const options: Options = { plans: planRows, spas }
  const spaName = new Map(spas.map((s) => [s.id, s.name]))
  const planName = new Map(planRows.map((p) => [p.code, p.name]))
  const now = new Date()
  return (
    <>
      <PageHeader
        title="Announcements"
        description="Notices shown at the top of the spa dashboard (each member can dismiss them). Never sent by email or SMS."
        actions={
          <FormSheet
            title="New announcement"
            action={saveAnnouncementAction}
            submitLabel="Publish"
            className="md:max-w-2xl"
            trigger={
              <Button>
                <Plus /> New announcement
              </Button>
            }
          >
            <AnnouncementFields options={options} />
          </FormSheet>
        }
      />
      <PageBody>
        {rows.length === 0 && (
          <EmptyState icon={<BellRing className="size-5" />} title="No announcements yet" />
        )}
        {rows.map(({ a, dismissed }) => {
          const st = state(a, now)
          const audience =
            a.audience === 'all'
              ? 'Every spa'
              : a.audience === 'plan'
                ? `Plans: ${a.planCodes.map((c) => planName.get(c) ?? c).join(', ')}`
                : `Spas: ${a.tenantIds.map((id) => spaName.get(id) ?? 'deleted spa').join(', ')}`
          return (
            <Card key={a.id} data-testid="announcement">
              <CardHeader
                title={a.titleEn}
                description={audience}
                action={
                  <div className="flex flex-wrap justify-end gap-2">
                    <Badge tone={SEVERITY_TONE[a.severity]}>{a.severity}</Badge>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                }
              />
              <CardBody className="space-y-4">
                <p className="whitespace-pre-line text-sm">{a.bodyEn}</p>
                {(a.titleTh || a.bodyTh) && (
                  <p className="whitespace-pre-line text-sm text-muted" lang="th">
                    {a.titleTh ? `${a.titleTh} — ` : ''}
                    {a.bodyTh}
                  </p>
                )}
                <p className="text-xs text-muted">
                  {formatDateTime(a.startsAt)} → {a.endsAt ? formatDateTime(a.endsAt) : 'no end'} · dismissed
                  by {dismissed} member{dismissed === 1 ? '' : 's'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <FormSheet
                    title="Edit announcement"
                    action={saveAnnouncementAction}
                    className="md:max-w-2xl"
                    trigger={
                      <Button variant="secondary" size="sm">
                        Edit
                      </Button>
                    }
                  >
                    <AnnouncementFields a={a} options={options} />
                  </FormSheet>
                  {st.label !== 'ended' && (
                    <ActionForm action={endAnnouncementAction.bind(null, a.id)}>
                      <SubmitButton variant="secondary" size="sm">
                        End now
                      </SubmitButton>
                    </ActionForm>
                  )}
                  <ActionForm action={deleteAnnouncementAction.bind(null, a.id)}>
                    <SubmitButton variant="ghost" size="sm">
                      Delete
                    </SubmitButton>
                  </ActionForm>
                </div>
              </CardBody>
            </Card>
          )
        })}
      </PageBody>
    </>
  )
}
