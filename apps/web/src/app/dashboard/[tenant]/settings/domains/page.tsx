import type { Translator } from '@spa/core/i18n'
import { domainOrders, domains, withTenant } from '@spa/db'
import {
  cloudflareConfig,
  type DnsRecord,
  type DomainRow,
  dnsRecordsFor,
  domainPairNote,
} from '@spa/services'
import { asc, desc, eq } from 'drizzle-orm'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Card, Grid, Note, Pill, Stack, type Tone } from '@/components/crm'
import { CopyButton } from '@/components/ui/copy-button'
import { PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { cn } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { canonicalUrls } from '@/server/origin'
import { SettingsTabs } from '../settings-tabs'
import { BuyDomain, CancelOrderButton } from './buy-domain'
import { AddDomainForm, DomainActions, SubdomainPrimaryButton } from './domains-client'

type Fmt = Awaited<ReturnType<typeof getI18n>>['fmt']

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('settings.domains.title') }
}

const STATUS = {
  pending: { tone: 'warn', dot: 'bg-warning' },
  verifying: { tone: 'acc', dot: 'bg-accent' },
  active: { tone: 'ok', dot: 'bg-success' },
  failed: { tone: 'bad', dot: 'bg-danger' },
} as const satisfies Record<string, { tone: Tone; dot: string }>

export default async function DomainsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'settings.manage')) notFound()
  const slug = ctx.tenant.slug
  const { t, fmt } = await getI18n()
  const [rows, orders] = await withTenant(ctx.tenant.id, (tx) =>
    Promise.all([
      tx.select().from(domains).where(eq(domains.kind, 'custom')).orderBy(asc(domains.createdAt)),
      tx.select().from(domainOrders).orderBy(desc(domainOrders.createdAt)).limit(10),
    ]),
  )
  const custom = rows[0] ?? null
  const freeUrl = canonicalUrls().site(slug)
  const customPrimary = custom?.status === 'active' && custom.isPrimary
  const sslAuto = cloudflareConfig() !== null

  return (
    <>
      <PageHeader title={t('settings.domains.title')} description={t('settings.domains.description')} />
      <SettingsTabs ctx={ctx} value="domains" />
      <Grid cols="col-2">
        <Stack className="min-w-0">
          {custom ? (
            <DomainCard t={t} fmt={fmt} slug={slug} domain={custom} sslAuto={sslAuto} />
          ) : (
            <Card title={t('settings.domains.connect')} sub={t('settings.domains.connectSub')}>
              <AddDomainForm slug={slug} />
            </Card>
          )}
          {!custom && (
            <Card title={t('settings.domains.buy')} sub={t('settings.domains.buySub')}>
              <BuyDomain slug={slug} />
            </Card>
          )}
          {orders.length > 0 && <OrdersCard t={t} fmt={fmt} slug={slug} orders={orders} />}
        </Stack>
        <Stack className="min-w-0">
          <Card
            title={t('settings.domains.free')}
            sub={t('settings.domains.freeSub')}
            actions={
              customPrimary ? (
                <SubdomainPrimaryButton slug={slug} />
              ) : (
                <Pill tone="acc">{t('settings.domains.primary')}</Pill>
              )
            }
          >
            <div className="space-y-3">
              <a
                href={freeUrl}
                target="_blank"
                rel="noreferrer"
                dir="ltr"
                className="block break-all text-[15px] font-medium text-accent underline-offset-4 hover:underline"
              >
                {freeUrl.replace(/^https?:\/\//, '')}
              </a>
              <div className="[&_button]:h-11 sm:[&_button]:h-8">
                <CopyButton value={freeUrl} label={t('settings.domains.copyLink')} />
              </div>
            </div>
          </Card>
          <Card title={t('settings.domains.how')}>
            <ol className="space-y-4">
              {(
                [
                  ['pending', t('settings.domains.how1')],
                  ['verifying', t('settings.domains.how2')],
                  ['active', sslAuto ? t('settings.domains.how3Ssl') : t('settings.domains.how3')],
                ] as const
              ).map(([key, text]) => (
                <li key={key} className="flex items-start gap-3 text-sm">
                  <Pill tone={STATUS[key].tone} className="mt-px w-[5.5rem] shrink-0 justify-center">
                    {t(`settings.domains.status.${key}`)}
                  </Pill>
                  <span className="crm-muted">{text}</span>
                </li>
              ))}
            </ol>
          </Card>
        </Stack>
      </Grid>
    </>
  )
}

const DAY_MS = 86_400_000

/** When the worker looks at this domain next (see isDomainCheckDue): matches its schedule, or says nothing. */
function autoCheckNote(t: Translator, d: DomainRow, now: number): string | null {
  if (d.status === 'active') return t('settings.domains.autoDaily')
  if (d.status === 'failed') return null
  const age = now - d.createdAt.getTime()
  if (age < DAY_MS) return t('settings.domains.autoTenMin')
  if (d.verifiedAt || age < 7 * DAY_MS) return t('settings.domains.autoHourly')
  return null
}

function DomainCard({
  t,
  fmt,
  slug,
  domain,
  sslAuto,
}: {
  t: Translator
  fmt: Fmt
  slug: string
  domain: DomainRow
  sslAuto: boolean
}) {
  const s = STATUS[domain.status]
  const waiting = domain.status === 'pending' || domain.status === 'verifying'
  const records = dnsRecordsFor(domain)
  const text =
    domain.status === 'active' && sslAuto
      ? t('settings.domains.statusText.activeSsl')
      : t(`settings.domains.statusText.${domain.status}`)
  const auto = autoCheckNote(t, domain, Date.now())
  const added = [
    t('settings.domains.added', { date: fmt.date(domain.createdAt) }),
    domain.isPrimary && domain.status === 'active' ? t('settings.domains.primaryAddress') : null,
  ]
  return (
    <Card
      title={
        <span className="break-all" dir="ltr">
          {domain.hostname}
        </span>
      }
      sub={added.filter(Boolean).join(' · ')}
      actions={<Pill tone={s.tone}>{t(`settings.domains.status.${domain.status}`)}</Pill>}
    >
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <span className="relative mt-[7px] flex size-2.5 shrink-0" aria-hidden>
            {waiting && (
              <span
                className={cn(
                  'absolute inline-flex size-full rounded-full opacity-50 motion-safe:animate-ping',
                  s.dot,
                )}
              />
            )}
            <span className={cn('relative inline-flex size-2.5 rounded-full', s.dot)} />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-[15px]">{text}</p>
            <p className="crm-muted text-[13px]">
              {[
                domain.checkedAt
                  ? t('settings.domains.lastChecked', { time: fmt.dateTime(domain.checkedAt) })
                  : t('settings.domains.notChecked'),
                auto,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {sslAuto && domain.sslStatus && (
              <p className="crm-muted text-[13px]">
                {t('settings.domains.ssl', { status: domain.sslStatus.replaceAll('_', ' ') })}
              </p>
            )}
          </div>
        </div>
        {domain.lastError && (
          <div
            role="status"
            className={cn(
              'anim-fade-in rounded-lg border px-4 py-3 text-sm',
              domain.status === 'failed'
                ? 'border-danger/25 bg-danger-soft text-danger'
                : 'border-warning/25 bg-warning-soft text-fg',
            )}
          >
            {domain.lastError}
          </div>
        )}
        {domain.status === 'active' && !sslAuto && <SslNote t={t} />}
        <DomainActions
          slug={slug}
          id={domain.id}
          hostname={domain.hostname}
          status={domain.status}
          isPrimary={domain.isPrimary}
          secure={sslAuto}
        />
      </div>
      <div className="mt-5 border-t pt-4">
        {domain.status === 'active' ? (
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden">
              {t('settings.domains.dnsRecords')}
              <span className="crm-muted transition-transform duration-200 group-open:rotate-45">+</span>
            </summary>
            <RecordsTable t={t} records={records} />
          </details>
        ) : (
          <DnsInstructions t={t} hostname={domain.hostname} records={records} sslAuto={sslAuto} />
        )}
      </div>
    </Card>
  )
}

function DnsInstructions({
  t,
  hostname,
  records,
  sslAuto,
}: {
  t: Translator
  hostname: string
  records: DnsRecord[]
  sslAuto: boolean
}) {
  const pair = domainPairNote(hostname)
  const target = records[1]!.value
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-[15px] font-semibold tracking-tight">{t('settings.domains.setup')}</h3>
        <p className="crm-muted text-sm">{t('settings.domains.setupSub')}</p>
      </div>
      <ol className="space-y-6">
        <Step n={1} title={t('settings.domains.step1', { apex: pair.apex })}>
          {t('settings.domains.step1Body')}
        </Step>
        <Step n={2} title={t('settings.domains.step2')}>
          <RecordsTable t={t} records={records} />
          <p className="mt-3">{t('settings.domains.step2Body', { apex: pair.apex })}</p>
        </Step>
        <Step n={3} title={t('settings.domains.step3')}>
          {t('settings.domains.step3Body')}
        </Step>
      </ol>
      {pair.kind !== 'other' && (
        <InfoNote
          title={
            pair.kind === 'www'
              ? t('settings.domains.wwwTitle', { apex: pair.apex })
              : t('settings.domains.apexTitle')
          }
        >
          {pair.kind === 'www'
            ? t('settings.domains.wwwBody', { apex: pair.apex, host: hostname, target })
            : t('settings.domains.apexBody', { apex: pair.apex, target })}
        </InfoNote>
      )}
      {!sslAuto && <SslNote t={t} />}
    </div>
  )
}

function SslNote({ t }: { t: Translator }) {
  return <InfoNote title={t('settings.domains.sslTitle')}>{t('settings.domains.sslBody')}</InfoNote>
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="crm-muted grid size-8 shrink-0 place-items-center rounded-full border text-[13px] font-medium">
          {n}
        </span>
        <p className="text-sm font-medium">{title}</p>
      </div>
      <div className="crm-muted min-w-0 text-sm sm:ps-11">{children}</div>
    </li>
  )
}

function InfoNote({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Note>
      <p className="font-medium">{title}</p>
      <p className="crm-muted">{children}</p>
    </Note>
  )
}

function RecordsTable({ t, records }: { t: Translator; records: DnsRecord[] }) {
  return (
    <ul className="divide-y overflow-hidden rounded-lg border text-fg">
      {records.map((r) => (
        <li key={r.type} className="space-y-3 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Pill className="font-mono">{r.type}</Pill>
            <span className="crm-muted text-[13px]">{t(`settings.domains.purpose.${r.type}`)}</span>
          </div>
          <RecordLine t={t} label={t('settings.domains.recordName')} value={r.host} full={r.name} />
          <RecordLine t={t} label={t('settings.domains.recordValue')} value={r.value} />
        </li>
      ))}
    </ul>
  )
}

function RecordLine({
  t,
  label,
  value,
  full,
}: {
  t: Translator
  label: string
  value: string
  full?: string
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto] sm:items-start sm:gap-3">
      <span className="crm-muted text-xs font-medium uppercase tracking-[0.06em] sm:pt-2">{label}</span>
      <div className="min-w-0 space-y-1">
        <code dir="ltr" className="block break-all rounded-md bg-subtle px-2.5 py-1.5 font-mono text-[13px]">
          {value}
        </code>
        {full && full !== value && (
          <p className="crm-muted break-all text-xs">
            {t('settings.domains.fullName')}: <span dir="ltr">{full}</span>
          </p>
        )}
      </div>
      <div className="[&_button]:h-11 sm:pt-px sm:[&_button]:h-8">
        <CopyButton value={value} />
      </div>
    </div>
  )
}

const ORDER_TONE = {
  requested: 'warn',
  purchasing: 'acc',
  purchased: 'ok',
  failed: 'bad',
  rejected: 'neutral',
  cancelled: 'neutral',
} as const satisfies Record<string, Tone>

function OrdersCard({
  t,
  fmt,
  slug,
  orders,
}: {
  t: Translator
  fmt: Fmt
  slug: string
  orders: (typeof domainOrders.$inferSelect)[]
}) {
  return (
    <Card title={t('settings.domains.orders.title')} sub={t('settings.domains.orders.sub')} flush>
      <ul className="divide-y divide-border">
        {orders.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
            <div className="min-w-0 space-y-0.5">
              <p dir="ltr" className="break-all font-medium">
                {o.domain}
              </p>
              <p className="crm-muted text-[13px]">
                {t('settings.domains.orders.price', {
                  price: fmt.aed(o.priceAed),
                  count: o.years,
                  date: fmt.date(o.createdAt),
                })}
              </p>
              {o.status === 'rejected' && o.note && <p className="crm-muted text-[13px]">“{o.note}”</p>}
              {o.status === 'purchased' && (
                <p className="crm-muted text-[13px]">
                  {t('settings.domains.orders.registered')}
                  {o.error ? ` ${o.error}` : ''}
                </p>
              )}
              {o.status === 'failed' && (
                <p className="text-[13px] text-danger">{t('settings.domains.orders.failed')}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Pill tone={ORDER_TONE[o.status]}>{t(`settings.domains.orders.status.${o.status}`)}</Pill>
              {o.status === 'requested' && <CancelOrderButton slug={slug} id={o.id} domain={o.domain} />}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
