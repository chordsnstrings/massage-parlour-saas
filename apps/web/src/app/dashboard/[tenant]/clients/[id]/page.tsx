import { whatsappLink } from '@spa/core'
import {
  bookingItems,
  bookings,
  clients,
  intakeSubmissions,
  intakeTemplates,
  platformDb,
  staff,
  treatmentNotes,
  user,
  withTenant,
} from '@spa/db'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { ArrowLeft, CalendarX2, FileSignature, MessageCircle, NotebookPen, ShieldAlert } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { formatPhone, STATUS_LABEL, STATUS_TONE } from '@/components/calendar/time'
import { GENDER_LABEL, LANGUAGE_LABEL, maskClientPhone } from '@/components/clients/shared'
import { StatStrip } from '@/components/clients/stat-strip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { formatAed, formatDate, formatDateTime, initials } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { BlocklistSheet, EditDetailsSheet, PreferencesSheet, TreatmentNoteForm } from './profile-client'

export const metadata: Metadata = { title: 'Client' }

export default async function ClientPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  const ctx = await requireMember(tenant)
  if (!can(ctx, 'clients.view')) notFound()
  if (!z.uuid().safeParse(id).success) notFound()
  const slug = ctx.tenant.slug
  const seePhone = can(ctx, 'clients.phone')
  const canManage = can(ctx, 'clients.manage')
  const canNote = can(ctx, 'calendar.view')

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const [client] = await tx.select().from(clients).where(eq(clients.id, id))
    if (!client) return null
    const team = await tx
      .select({ id: staff.id, name: staff.displayName })
      .from(staff)
      .orderBy(asc(staff.sort), asc(staff.displayName))
    const visits = await tx
      .select({
        id: bookings.id,
        ref: bookings.refCode,
        status: bookings.status,
        startsAt: bookings.startsAt,
        source: bookings.source,
      })
      .from(bookings)
      .where(eq(bookings.clientId, id))
      .orderBy(desc(bookings.startsAt))
      .limit(50)
    const items = visits.length
      ? await tx
          .select({
            bookingId: bookingItems.bookingId,
            name: bookingItems.serviceName,
            duration: bookingItems.durationMin,
            price: bookingItems.priceAed,
            staffIds: bookingItems.staffIds,
          })
          .from(bookingItems)
          .where(
            inArray(
              bookingItems.bookingId,
              visits.map((v) => v.id),
            ),
          )
          .orderBy(asc(bookingItems.startsAt))
      : []
    const [totals] = await tx
      .select({
        visits: sql<number>`count(distinct ${bookings.id})::int`,
        spend: sql<string>`coalesce(sum(${bookingItems.priceAed}), 0)`,
      })
      .from(bookings)
      .innerJoin(bookingItems, eq(bookingItems.bookingId, bookings.id))
      .where(and(eq(bookings.clientId, id), eq(bookings.status, 'completed')))
    const notes = await tx
      .select({
        id: treatmentNotes.id,
        text: treatmentNotes.text,
        createdAt: treatmentNotes.createdAt,
        staffId: treatmentNotes.staffId,
        createdBy: treatmentNotes.createdBy,
        bookingRef: bookings.refCode,
      })
      .from(treatmentNotes)
      .leftJoin(bookings, eq(bookings.id, treatmentNotes.bookingId))
      .where(eq(treatmentNotes.clientId, id))
      .orderBy(desc(treatmentNotes.createdAt))
      .limit(100)
    const intakes = await tx
      .select({
        id: intakeSubmissions.id,
        signedAt: intakeSubmissions.signedAt,
        version: intakeSubmissions.templateVersion,
        templateName: intakeTemplates.name,
      })
      .from(intakeSubmissions)
      .leftJoin(intakeTemplates, eq(intakeTemplates.id, intakeSubmissions.templateId))
      .where(eq(intakeSubmissions.clientId, id))
      .orderBy(desc(intakeSubmissions.signedAt))
    const [template] = await tx
      .select({ version: intakeTemplates.version })
      .from(intakeTemplates)
      .where(eq(intakeTemplates.active, true))
      .orderBy(desc(intakeTemplates.version))
      .limit(1)
    return { client, team, visits, items, totals: totals!, notes, intakes, template }
  })
  if (!data) notFound()
  const { client, team, visits, items, totals, notes, intakes, template } = data

  const staffName = new Map(team.map((s) => [s.id, s.name]))
  const authorIds = [...new Set(notes.filter((n) => !n.staffId && n.createdBy).map((n) => n.createdBy!))]
  const authors = authorIds.length
    ? new Map(
        (
          await platformDb()
            .select({ id: user.id, name: user.name })
            .from(user)
            .where(inArray(user.id, authorIds))
        ).map((u) => [u.id, u.name]),
      )
    : new Map<string, string>()
  const itemsBy = new Map<string, typeof items>()
  for (const i of items) itemsBy.set(i.bookingId, [...(itemsBy.get(i.bookingId) ?? []), i])
  const prefs = client.preferences
  const phone = client.phoneE164
  const phoneLabel = phone ? (seePhone ? formatPhone(phone) : maskClientPhone(phone)) : null
  const firstName = client.name.split(/\s+/)[0] ?? client.name
  const latestIntake = intakes[0]
  const intakeStale = Boolean(template && latestIntake && latestIntake.version < template.version)
  const base = appPath(`/${slug}/clients/${client.id}`)

  const prefRows: [string, string | undefined][] = [
    ['Pressure', prefs.pressure],
    ['Oils', prefs.oils],
    ['Allergies', prefs.allergies],
    ['Focus areas', prefs.focus],
    ['Therapist gender', prefs.therapistGender ? GENDER_LABEL[prefs.therapistGender] : undefined],
    ['Preferred therapist', prefs.preferredStaffId ? staffName.get(prefs.preferredStaffId) : undefined],
  ]

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={appPath(`/${slug}/clients`)}
            className="inline-flex min-h-6 items-center gap-1 hover:text-fg"
          >
            <ArrowLeft className="size-3.5 rtl:rotate-180" /> Clients
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span
              className={`grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold ${client.blocklisted ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'}`}
            >
              {initials(client.name)}
            </span>
            <span className="min-w-0 break-words">{client.name}</span>
            {client.blocklisted && <Badge tone="danger">Blocklisted</Badge>}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {phoneLabel && <span className="tabular-nums">{phoneLabel}</span>}
            <span>{LANGUAGE_LABEL[client.language] ?? client.language}</span>
            <span>Client since {formatDate(client.createdAt)}</span>
          </span>
        }
        actions={
          <>
            {seePhone && phone && (
              <Button variant="secondary" asChild>
                <a href={whatsappLink(phone, `Hi ${firstName}, `)} target="_blank" rel="noreferrer">
                  <MessageCircle /> WhatsApp
                </a>
              </Button>
            )}
            {canManage && template && (
              <Button variant={latestIntake && !intakeStale ? 'secondary' : 'primary'} asChild>
                <Link href={`${base}/intake`}>
                  <FileSignature /> Sign intake
                </Link>
              </Button>
            )}
            {canManage && (
              <EditDetailsSheet
                slug={slug}
                clientId={client.id}
                showPhone={seePhone}
                value={{
                  name: client.name,
                  phone: phone && seePhone ? `0${phone.slice(3)}` : '',
                  email: client.email ?? '',
                  gender: client.gender ?? '',
                  language: client.language,
                  birthday: client.birthday ?? '',
                  nationality: client.nationality ?? '',
                  tags: client.tags,
                  notes: client.notes ?? '',
                }}
              />
            )}
          </>
        }
      />
      <PageBody>
        {client.blocklisted && (
          <div
            role="status"
            className="flex items-start gap-3 rounded-xl border border-danger/25 bg-danger-soft px-5 py-4 text-sm text-danger sm:px-6"
          >
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              <span className="font-medium">Blocklisted.</span> {client.blocklistReason}
            </p>
          </div>
        )}
        <StatStrip
          stats={[
            { label: 'Visits', value: totals.visits },
            { label: 'Spend', value: Number(totals.spend), format: 'aed' },
            { label: 'No-shows', value: client.noShowCount },
            { label: 'Last visit', value: client.lastVisitAt ? formatDate(client.lastVisitAt) : '—' },
          ]}
        />
        <div className="grid gap-6 lg:grid-cols-12 sm:gap-8">
          <div className="min-w-0 space-y-6 sm:space-y-8 lg:col-span-8">
            <Card>
              <CardHeader
                title="Visit history"
                description={`${visits.length} booking${visits.length === 1 ? '' : 's'}`}
              />
              {visits.length === 0 ? (
                <EmptyState icon={<CalendarX2 className="size-5" />} title="No bookings yet" />
              ) : (
                <ol className="mt-4 divide-y border-t" data-testid="visit-history">
                  {visits.map((v) => {
                    const lines = itemsBy.get(v.id) ?? []
                    const total = lines.reduce((s, l) => s + Number(l.price), 0)
                    const people = [...new Set(lines.flatMap((l) => l.staffIds))]
                      .map((s) => staffName.get(s))
                      .filter(Boolean)
                    return (
                      <li
                        key={v.id}
                        className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-5 py-4 sm:px-6"
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            <span className="tabular-nums">{formatDateTime(v.startsAt)}</span>
                            <Badge tone={STATUS_TONE[v.status]}>{STATUS_LABEL[v.status]}</Badge>
                          </p>
                          <p className="text-sm text-muted">
                            {lines.map((l) => `${l.name} · ${l.duration} min`).join(', ') || 'No services'}
                            {people.length > 0 && ` · with ${people.join(', ')}`}
                          </p>
                        </div>
                        <div className="text-end text-sm">
                          <p className="font-medium tabular-nums">{formatAed(total)}</p>
                          <p className="font-mono text-xs text-muted">{v.ref}</p>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </Card>

            <Card>
              <CardHeader title="Treatment notes" description="Written by therapists after each session." />
              <CardBody className="space-y-5">
                {canNote && (
                  <TreatmentNoteForm
                    slug={slug}
                    clientId={client.id}
                    visits={visits.slice(0, 10).map((v) => ({
                      id: v.id,
                      label: `${formatDateTime(v.startsAt)} · ${v.ref}`,
                    }))}
                  />
                )}
                {notes.length === 0 ? (
                  <EmptyState icon={<NotebookPen className="size-5" />} title="No treatment notes yet" />
                ) : (
                  <ol className="space-y-3" data-testid="treatment-notes">
                    {notes.map((n) => (
                      <li key={n.id} className="rounded-xl bg-subtle/60 px-4 py-3.5">
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">{n.text}</p>
                        <p className="mt-2 text-xs text-muted">
                          {(n.staffId && staffName.get(n.staffId)) ||
                            (n.createdBy && authors.get(n.createdBy)) ||
                            'Team'}
                          {' · '}
                          {formatDateTime(n.createdAt)}
                          {n.bookingRef && ` · ${n.bookingRef}`}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Intake & waiver"
                description={
                  template
                    ? intakeStale
                      ? 'The form has changed since the last signature — ask the client to sign again.'
                      : 'Signed health questionnaires and consent.'
                    : 'Set up an intake form in Settings to collect signatures.'
                }
                action={intakeStale ? <Badge tone="warning">Re-sign needed</Badge> : undefined}
              />
              {intakes.length === 0 ? (
                <EmptyState icon={<FileSignature className="size-5" />} title="No signed forms yet" />
              ) : (
                <ul className="mt-4 divide-y border-t" data-testid="intake-list">
                  {intakes.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`${base}/intake/${s.id}`}
                        className="flex min-h-14 items-center justify-between gap-4 px-5 py-3 text-sm transition-colors hover:bg-subtle/50 sm:px-6"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {s.templateName ?? 'Intake form'}
                          </span>
                          <span className="block text-xs text-muted">
                            Signed {formatDateTime(s.signedAt)}
                          </span>
                        </span>
                        <Badge tone={template && s.version < template.version ? 'warning' : 'accent'}>
                          v{s.version}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="min-w-0 space-y-6 sm:space-y-8 lg:col-span-4">
            <Card>
              <CardHeader title="Details" />
              <CardBody>
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                  <Detail label="Gender">{client.gender ? GENDER_LABEL[client.gender] : null}</Detail>
                  <Detail label="Birthday">{client.birthday ? formatDate(client.birthday) : null}</Detail>
                  <Detail label="Email">{client.email}</Detail>
                  <Detail label="Nationality">{client.nationality}</Detail>
                  <Detail label="Source">{client.source}</Detail>
                </dl>
                {client.tags.length > 0 && (
                  <div className="mt-5 flex flex-wrap gap-1.5">
                    {client.tags.map((t) => (
                      <Badge key={t} tone="accent">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
                {client.notes && (
                  <p className="mt-5 whitespace-pre-wrap rounded-lg bg-subtle/60 px-3.5 py-3 text-sm">
                    {client.notes}
                  </p>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Preferences"
                action={
                  canManage ? (
                    <PreferencesSheet
                      slug={slug}
                      clientId={client.id}
                      team={team}
                      value={{
                        pressure: prefs.pressure ?? '',
                        oils: prefs.oils ?? '',
                        allergies: prefs.allergies ?? '',
                        focus: prefs.focus ?? '',
                        therapistGender: prefs.therapistGender ?? '',
                        preferredStaffId: prefs.preferredStaffId ?? '',
                      }}
                    />
                  ) : undefined
                }
              />
              <CardBody>
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm" data-testid="preferences">
                  {prefRows.map(([label, value]) => (
                    <Detail key={label} label={label} highlight={label === 'Allergies' && Boolean(value)}>
                      {value}
                    </Detail>
                  ))}
                </dl>
              </CardBody>
            </Card>

            {canManage && (
              <Card>
                <CardHeader
                  title="Blocklist"
                  description={
                    client.blocklisted
                      ? 'The team sees a warning whenever this client books.'
                      : 'Flag a client the team should not book.'
                  }
                />
                <CardBody>
                  <BlocklistSheet
                    slug={slug}
                    clientId={client.id}
                    blocklisted={client.blocklisted}
                    reason={client.blocklistReason ?? ''}
                  />
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      </PageBody>
    </>
  )
}

function Detail({
  label,
  children,
  highlight,
}: {
  label: string
  children: React.ReactNode
  highlight?: boolean
}) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className={`min-w-0 break-words text-end ${highlight ? 'font-medium text-danger' : ''}`}>
        {children || <span className="text-muted/70">—</span>}
      </dd>
    </>
  )
}
