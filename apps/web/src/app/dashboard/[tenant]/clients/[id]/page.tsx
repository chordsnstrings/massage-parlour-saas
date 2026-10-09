import { whatsappLink } from '@spa/core'
import { enumLabel } from '@spa/core/i18n'
import {
  bookingItems,
  bookings,
  clientMemberships,
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
import { formatPhone } from '@/components/calendar/time'
import { maskClientPhone } from '@/components/clients/shared'
import { Avatar, Card, Grid, Note, Pill, Stack, Stat, statusTone } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { BlocklistSheet, EditDetailsSheet, PreferencesSheet, TreatmentNoteForm } from './profile-client'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT()
  return { title: t('clients.profile.metaTitle') }
}

export default async function ClientPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  const ctx = await requireMember(tenant)
  if (!can(ctx, 'clients.view')) notFound()
  if (!z.uuid().safeParse(id).success) notFound()
  const slug = ctx.tenant.slug
  const seePhone = can(ctx, 'clients.phone')
  const canManage = can(ctx, 'clients.manage')
  const canNote = can(ctx, 'calendar.view')
  const { t, fmt } = await getI18n()

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
    const memberships = await tx
      .select()
      .from(clientMemberships)
      .where(eq(clientMemberships.clientId, id))
      .orderBy(desc(clientMemberships.currentPeriodEnd))
      .limit(12)
    return { client, team, visits, items, totals: totals!, notes, intakes, template, memberships }
  })
  if (!data) notFound()
  const { client, team, visits, items, totals, notes, intakes, template, memberships } = data

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
  const langLabel =
    client.language === 'en' || client.language === 'ar'
      ? t(`clients.lang.${client.language}`)
      : client.language
  const pressure = prefs.pressure
    ? (t.maybe(`clients.prefs.pressureOption.${prefs.pressure}`) ?? prefs.pressure)
    : undefined

  const prefRows: { key: string; label: string; value: string | undefined; highlight?: boolean }[] = [
    { key: 'pressure', label: t('clients.prefs.pressure'), value: pressure },
    { key: 'oils', label: t('clients.prefs.oils'), value: prefs.oils },
    {
      key: 'allergies',
      label: t('clients.prefs.allergies'),
      value: prefs.allergies,
      highlight: Boolean(prefs.allergies),
    },
    { key: 'focus', label: t('clients.prefs.focus'), value: prefs.focus },
    {
      key: 'gender',
      label: t('clients.prefs.therapistGender'),
      value: prefs.therapistGender ? enumLabel(t, 'staffGender', prefs.therapistGender) : undefined,
    },
    {
      key: 'staff',
      label: t('clients.prefs.preferredTherapist'),
      value: prefs.preferredStaffId ? staffName.get(prefs.preferredStaffId) : undefined,
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={appPath(`/${slug}/clients`)}
            className="inline-flex min-h-6 items-center gap-1 hover:text-fg"
          >
            <ArrowLeft className="size-3.5 rtl:rotate-180" /> {t('clients.title')}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Avatar name={client.name} size="lg" />
            <span className="min-w-0 break-words">{client.name}</span>
            {client.blocklisted && <Pill tone="bad">{t('clients.blocklisted')}</Pill>}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {phoneLabel && <span className="tabular-nums">{phoneLabel}</span>}
            <span>{langLabel}</span>
            <span>{t('clients.profile.since', { date: fmt.date(client.createdAt) })}</span>
          </span>
        }
        actions={
          <>
            {seePhone && phone && (
              <Button variant="secondary" asChild>
                <a href={whatsappLink(phone, `Hi ${firstName}, `)} target="_blank" rel="noreferrer">
                  <MessageCircle /> {t('clients.profile.whatsapp')}
                </a>
              </Button>
            )}
            {canManage && template && (
              <Button variant={latestIntake && !intakeStale ? 'secondary' : 'primary'} asChild>
                <Link href={`${base}/intake`}>
                  <FileSignature /> {t('clients.profile.signIntake')}
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
      <Stack>
        {client.blocklisted && (
          <div role="status">
            <Note tone="warn" icon={<ShieldAlert aria-hidden strokeWidth={1.8} />}>
              <span className="font-semibold">{t('clients.profile.blocklistedBanner')}</span>{' '}
              {client.blocklistReason}
            </Note>
          </div>
        )}
        <Grid cols="g4">
          <Stat label={t('clients.profile.visits')} value={fmt.number(totals.visits)} />
          <Stat label={t('clients.profile.spend')} value={fmt.aed(totals.spend)} />
          <Stat label={t('clients.profile.noShows')} value={fmt.number(client.noShowCount)} />
          <Stat
            label={t('clients.profile.lastVisit')}
            value={client.lastVisitAt ? fmt.date(client.lastVisitAt) : '—'}
          />
        </Grid>
        <Grid cols="col-2">
          <Stack>
            <Card
              flush
              title={t('clients.visits.title')}
              sub={t('clients.visits.count', { count: visits.length })}
            >
              {visits.length === 0 ? (
                <EmptyState icon={<CalendarX2 className="size-5" />} title={t('clients.visits.empty')} />
              ) : (
                <ol className="divide-y divide-[var(--crm-line)]" data-testid="visit-history">
                  {visits.map((v) => {
                    const lines = itemsBy.get(v.id) ?? []
                    const total = lines.reduce((s, l) => s + Number(l.price), 0)
                    const people = [...new Set(lines.flatMap((l) => l.staffIds))]
                      .map((s) => staffName.get(s))
                      .filter(Boolean)
                    return (
                      <li
                        key={v.id}
                        className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1.5 px-[var(--crm-pad-card)] py-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="flex flex-wrap items-center gap-2 font-medium">
                            <span className="tabular-nums">{fmt.dateTime(v.startsAt)}</span>
                            <Pill tone={statusTone(v.status)} dot>
                              {enumLabel(t, 'bookingStatus', v.status)}
                            </Pill>
                          </p>
                          <p className="crm-muted">
                            {lines
                              .map((l) => t('clients.visits.line', { name: l.name, min: l.duration }))
                              .join(', ') || t('clients.visits.noServices')}
                            {people.length > 0 &&
                              ` · ${t('clients.visits.with', { names: people.join(', ') })}`}
                          </p>
                        </div>
                        <div className="text-end">
                          <p className="font-semibold tabular-nums">{fmt.aed(total)}</p>
                          <p className="crm-muted font-mono text-[length:var(--crm-fs-sub)]">{v.ref}</p>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </Card>

            <Card title={t('clients.notes.title')} sub={t('clients.notes.sub')}>
              <div className="space-y-4">
                {canNote && (
                  <TreatmentNoteForm
                    slug={slug}
                    clientId={client.id}
                    visits={visits.slice(0, 10).map((v) => ({
                      id: v.id,
                      label: `${fmt.dateTime(v.startsAt)} · ${v.ref}`,
                    }))}
                  />
                )}
                {notes.length === 0 ? (
                  <EmptyState icon={<NotebookPen className="size-5" />} title={t('clients.notes.empty')} />
                ) : (
                  <ol className="space-y-2.5" data-testid="treatment-notes">
                    {notes.map((n) => (
                      <li
                        key={n.id}
                        className="rounded-[var(--crm-radius-sm,10px)] bg-[var(--crm-bg)] px-3.5 py-3"
                      >
                        <p className="whitespace-pre-wrap leading-relaxed">{n.text}</p>
                        <p className="crm-muted mt-1.5 text-[length:var(--crm-fs-sub)]">
                          {(n.staffId && staffName.get(n.staffId)) ||
                            (n.createdBy && authors.get(n.createdBy)) ||
                            t('clients.notes.team')}
                          {' · '}
                          {fmt.dateTime(n.createdAt)}
                          {n.bookingRef && ` · ${n.bookingRef}`}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </Card>

            <Card
              flush
              title={t('clients.intake.title')}
              sub={
                template
                  ? intakeStale
                    ? t('clients.intake.stale')
                    : t('clients.intake.sub')
                  : t('clients.intake.setupHint')
              }
              actions={intakeStale ? <Pill tone="warn">{t('clients.intake.resign')}</Pill> : undefined}
            >
              {intakes.length === 0 ? (
                <EmptyState icon={<FileSignature className="size-5" />} title={t('clients.intake.empty')} />
              ) : (
                <ul className="divide-y divide-[var(--crm-line)]" data-testid="intake-list">
                  {intakes.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`${base}/intake/${s.id}`}
                        className="flex min-h-12 items-center justify-between gap-4 px-[var(--crm-pad-card)] py-2.5 transition-colors hover:bg-[var(--crm-bg)]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {s.templateName ?? t('clients.intake.fallbackName')}
                          </span>
                          <span className="crm-muted block text-[length:var(--crm-fs-sub)]">
                            {t('clients.intake.signed', { date: fmt.dateTime(s.signedAt) })}
                          </span>
                        </span>
                        <Pill tone={template && s.version < template.version ? 'warn' : 'acc'}>
                          {t('clients.intake.version', { n: s.version })}
                        </Pill>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </Stack>

          <Stack>
            {memberships.length > 0 && (
              <Card title={t('clients.memberships.title')} sub={t('clients.memberships.sub')}>
                <ul className="divide-y divide-[var(--crm-line)]" data-testid="client-memberships">
                  {memberships.map((m) => {
                    const sessions = Object.values(m.balances).reduce((s, n) => s + Math.max(0, n), 0)
                    return (
                      <li key={m.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{m.name}</span>
                          <span className="crm-muted block text-[length:var(--crm-fs-sub)]">
                            {t('clients.memberships.period', {
                              from: fmt.date(m.currentPeriodStart),
                              to: fmt.date(m.currentPeriodEnd),
                            })}
                            {Number(m.discountPct) > 0 &&
                              ` · ${t('clients.memberships.discount', { pct: Number(m.discountPct) })}`}
                            {sessions > 0 && ` · ${t('clients.memberships.sessions', { count: sessions })}`}
                          </span>
                        </span>
                        <Pill tone={m.status === 'due' ? 'warn' : statusTone(m.status)}>
                          {enumLabel(t, 'membershipStatus', m.status)}
                        </Pill>
                      </li>
                    )
                  })}
                </ul>
              </Card>
            )}
            <Card title={t('clients.profile.details')}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5">
                <Detail label={t('clients.field.gender')}>
                  {client.gender ? enumLabel(t, 'staffGender', client.gender) : null}
                </Detail>
                <Detail label={t('clients.field.birthday')}>
                  {client.birthday ? fmt.date(client.birthday) : null}
                </Detail>
                <Detail label={t('clients.field.email')}>{client.email}</Detail>
                <Detail label={t('clients.field.nationality')}>{client.nationality}</Detail>
                <Detail label={t('clients.field.source')}>
                  {client.source ? enumLabel(t, 'bookingSource', client.source) : null}
                </Detail>
              </dl>
              {client.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {client.tags.map((x) => (
                    <Pill key={x} tone="acc">
                      {x}
                    </Pill>
                  ))}
                </div>
              )}
              {client.notes && (
                <p className="mt-4 whitespace-pre-wrap rounded-[var(--crm-radius-sm,10px)] bg-[var(--crm-bg)] px-3.5 py-3">
                  {client.notes}
                </p>
              )}
            </Card>

            <Card
              title={t('clients.prefs.title')}
              actions={
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
            >
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5" data-testid="preferences">
                {prefRows.map((r) => (
                  <Detail key={r.key} label={r.label} highlight={r.highlight}>
                    {r.value}
                  </Detail>
                ))}
              </dl>
            </Card>

            {canManage && (
              <Card
                title={t('clients.blocklist.title')}
                sub={client.blocklisted ? t('clients.blocklist.onSub') : t('clients.blocklist.offSub')}
              >
                <BlocklistSheet
                  slug={slug}
                  clientId={client.id}
                  blocklisted={client.blocklisted}
                  reason={client.blocklistReason ?? ''}
                />
              </Card>
            )}
          </Stack>
        </Grid>
      </Stack>
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
      <dt className="crm-muted">{label}</dt>
      <dd className={`min-w-0 break-words text-end ${highlight ? 'font-medium text-[var(--crm-bad)]' : ''}`}>
        {children || <span className="crm-muted">—</span>}
      </dd>
    </>
  )
}
