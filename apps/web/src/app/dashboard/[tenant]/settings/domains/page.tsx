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
function autoCheckNote(d: DomainRow, now: number): string {
  if (d.status === 'active') return ' · re-checked daily'
  if (d.status === 'failed') return ''
  const age = now - d.createdAt.getTime()
  if (age < DAY_MS) return ' · we also check automatically every 10 minutes'
  if (d.verifiedAt || age < 7 * DAY_MS) return ' · we also check automatically every hour'
  return ''
}

function DomainCard({ slug, domain, sslAuto }: { slug: string; domain: DomainRow; sslAuto: boolean }) {
  const s = STATUS[domain.status]
  const waiting = domain.status === 'pending' || domain.status === 'verifying'
  const records = dnsRecordsFor(domain)
  const text =
    domain.status === 'active' && sslAuto
      ? 'Connected — your website and online booking answer on this address with free SSL.'
      : s.text
  return (
    <Card>
      <CardHeader
        title={
          <span className="break-all" dir="ltr">
            {domain.hostname}
          </span>
        }
        description={`Added ${formatDate(domain.createdAt)}${domain.isPrimary && domain.status === 'active' ? ' · Primary address' : ''}`}
        action={<Badge tone={s.tone}>{s.label}</Badge>}
      />
      <CardBody className="space-y-5">
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
            <p className="text-[13px] text-muted">
              {domain.checkedAt ? `Last checked ${formatDateTime(domain.checkedAt)}` : 'Not checked yet'}
              {autoCheckNote(domain, Date.now())}
            </p>
            {sslAuto && domain.sslStatus && (
              <p className="text-[13px] text-muted">
                SSL certificate: {domain.sslStatus.replaceAll('_', ' ')}
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
        {domain.status === 'active' && !sslAuto && <SslNote />}
        <DomainActions
          slug={slug}
          id={domain.id}
          hostname={domain.hostname}
          status={domain.status}
          isPrimary={domain.isPrimary}
          secure={sslAuto}
        />
      </CardBody>
      <div className="border-t">
        {domain.status === 'active' ? (
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-5 py-3 text-sm font-medium sm:px-6 [&::-webkit-details-marker]:hidden">
              DNS records
              <span className="text-muted transition-transform duration-200 group-open:rotate-45">+</span>
            </summary>
            <CardBody className="pt-0">
              <RecordsTable records={records} />
            </CardBody>
          </details>
        ) : (
          <DnsInstructions hostname={domain.hostname} records={records} sslAuto={sslAuto} />
        )}
      </div>
    </Card>
  )
}

function DnsInstructions({
  hostname,
  records,
  sslAuto,
}: {
  hostname: string
  records: DnsRecord[]
  sslAuto: boolean
}) {
  const pair = domainPairNote(hostname)
  const target = records[1]!.value
  return (
    <CardBody className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-[15px] font-semibold tracking-tight">Set up DNS</h3>
        <p className="text-sm text-muted">Three steps, about five minutes.</p>
      </div>
      <ol className="space-y-6">
        <Step n={1} title={`Open the DNS settings for ${pair.apex}`}>
          Sign in where you bought the domain (your registrar) or wherever its DNS is managed, and look for
          “DNS”, “Zone editor” or “Manage records”.
        </Step>
        <Step n={2} title="Add these two records">
          <RecordsTable records={records} />
          <p className="mt-3">
            Most providers add <span dir="ltr">{pair.apex}</span> for you, so enter the short name shown.
            Leave TTL on its default. DNS on Cloudflare? Set the CNAME to “DNS only” (grey cloud).
          </p>
        </Step>
        <Step n={3} title="Press Check now">
          DNS changes usually show up within minutes but can take up to 48 hours. Keep both records in place
          after your domain connects.
        </Step>
      </ol>
      {pair.kind !== 'other' && (
        <Note title={pair.kind === 'www' ? `Also want ${pair.apex} to work?` : 'Connecting a bare domain'}>
          {pair.kind === 'www' ? (
            <>
              Set up domain forwarding (a redirect) from <b dir="ltr">{pair.apex}</b> to{' '}
              <b dir="ltr">https://{hostname}</b> at your registrar — most .ae registrars offer it for free.
              If your DNS host supports CNAME flattening or ALIAS records (Cloudflare does), you can instead
              point {pair.apex} at <span dir="ltr">{target}</span>.
            </>
          ) : (
            <>
              Many DNS hosts can’t put a CNAME on the bare domain. Use CNAME flattening or an ALIAS/ANAME
              record pointing at <span dir="ltr">{target}</span> (Cloudflare supports it). If yours can’t,
              remove this domain, connect <b dir="ltr">www.{pair.apex}</b> instead and forward {pair.apex} to
              it.
            </>
          )}
        </Note>
      )}
      {!sslAuto && <SslNote />}
    </CardBody>
  )
}

function SslNote() {
  return (
    <Note title="Automatic SSL is not switched on yet">
      We can verify and connect your domain now; HTTPS certificates for custom domains start as soon as our
      team enables them for your account.
    </Note>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full border text-[13px] font-medium text-muted">
          {n}
        </span>
        <p className="text-sm font-medium">{title}</p>
      </div>
      <div className="min-w-0 text-sm text-muted sm:ps-11">{children}</div>
    </li>
  )
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg bg-subtle/70 px-4 py-3.5 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={1.5} />
      <div className="min-w-0 space-y-1">
        <p className="font-medium">{title}</p>
        <p className="text-muted">{children}</p>
      </div>
    </div>
  )
}

const PURPOSE = { TXT: 'Proves you own the domain', CNAME: 'Points the domain at your site' } as const

function RecordsTable({ records }: { records: DnsRecord[] }) {
  return (
    <ul className="divide-y overflow-hidden rounded-lg border text-fg">
      {records.map((r) => (
        <li key={r.type} className="space-y-3 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="font-mono">{r.type}</Badge>
            <span className="text-[13px] text-muted">{PURPOSE[r.type]}</span>
          </div>
          <RecordLine label="Name" value={r.host} full={r.name} />
          <RecordLine label="Value" value={r.value} />
        </li>
      ))}
    </ul>
  )
}

function RecordLine({ label, value, full }: { label: string; value: string; full?: string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto] sm:items-start sm:gap-3">
      <span className="text-xs font-medium uppercase tracking-[0.06em] text-muted sm:pt-2">{label}</span>
      <div className="min-w-0 space-y-1">
        <code dir="ltr" className="block break-all rounded-md bg-subtle px-2.5 py-1.5 font-mono text-[13px]">
          {value}
        </code>
        {full && full !== value && (
          <p className="break-all text-xs text-muted">
            Full name: <span dir="ltr">{full}</span>
          </p>
        )}
      </div>
      <div className="[&_button]:h-11 sm:pt-px sm:[&_button]:h-8">
        <CopyButton value={value} />
      </div>
    </div>
  )
}

const ORDER = {
  requested: { label: 'Awaiting approval', tone: 'warning' },
  purchasing: { label: 'Buying', tone: 'accent' },
  purchased: { label: 'Bought', tone: 'success' },
  failed: { label: 'Needs attention', tone: 'danger' },
  rejected: { label: 'Declined', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
} as const

function OrdersCard({ slug, orders }: { slug: string; orders: (typeof domainOrders.$inferSelect)[] }) {
  return (
    <Card>
      <CardHeader title="Domain requests" description="Domains you asked us to buy." />
      <ul className="divide-y divide-border">
        {orders.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
            <div className="min-w-0 space-y-0.5">
              <p dir="ltr" className="break-all font-medium">
                {o.domain}
              </p>
              <p className="text-[13px] text-muted">
                AED {Number(o.priceAed).toLocaleString('en-AE')} for {o.years} year{o.years > 1 ? 's' : ''} ·
                requested {formatDate(o.createdAt)}
              </p>
              {o.status === 'rejected' && o.note && <p className="text-[13px] text-muted">“{o.note}”</p>}
              {o.status === 'purchased' && (
                <p className="text-[13px] text-muted">
                  Registered — it connects automatically within an hour{o.error ? `. ${o.error}` : '.'}
                </p>
              )}
              {o.status === 'failed' && (
                <p className="text-[13px] text-danger">We couldn’t buy it yet — we’re on it.</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={ORDER[o.status].tone}>{ORDER[o.status].label}</Badge>
              {o.status === 'requested' && <CancelOrderButton slug={slug} id={o.id} domain={o.domain} />}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
