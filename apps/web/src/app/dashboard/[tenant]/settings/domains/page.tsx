import { domains, withTenant } from '@spa/db'
import {
  cloudflareConfig,
  type DnsRecord,
  type DomainRow,
  dnsRecordsFor,
  domainPairNote,
} from '@spa/services'
import { asc, eq } from 'drizzle-orm'
import { ArrowLeft, Info } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { CopyButton } from '@/components/ui/copy-button'
import { PageBody, PageHeader } from '@/components/ui/page'
import { appPath, tenantSiteUrl } from '@/lib/paths'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { AddDomainForm, DomainActions, SubdomainPrimaryButton } from './domains-client'

export const metadata: Metadata = { title: 'Domains' }

const STATUS = {
  pending: {
    label: 'Pending',
    tone: 'warning',
    dot: 'bg-warning',
    text: 'Waiting for the DNS records. Add them below, then press Check now.',
  },
  verifying: {
    label: 'Verifying',
    tone: 'accent',
    dot: 'bg-accent',
    text: 'Ownership confirmed. Waiting for the domain to point at us and for its SSL certificate.',
  },
  active: {
    label: 'Active',
    tone: 'success',
    dot: 'bg-success',
    text: 'Connected — your website and online booking answer on this address with free SSL.',
  },
  failed: {
    label: 'Failed',
    tone: 'danger',
    dot: 'bg-danger',
    text: 'Not connected. Fix the issue below, then press Check now.',
  },
} as const

export default async function DomainsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'settings.manage')) notFound()
  const slug = ctx.tenant.slug
  const rows = await withTenant(ctx.tenant.id, (tx) =>
    tx.select().from(domains).where(eq(domains.kind, 'custom')).orderBy(asc(domains.createdAt)),
  )
  const custom = rows[0] ?? null
  const freeUrl = tenantSiteUrl(slug)
  const customPrimary = custom?.status === 'active' && custom.isPrimary
  const sslAuto = cloudflareConfig() !== null

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={appPath(`/${slug}/settings`)}
            className="inline-flex items-center gap-1 transition-colors hover:text-fg"
          >
            <ArrowLeft className="size-3.5" /> Settings
          </Link>
        }
        title="Domains"
        description="Where clients find your website. Your free address always works — connect a domain you own to use it instead."
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
          <div className="min-w-0 space-y-6 lg:col-span-8">
            {custom ? (
              <DomainCard slug={slug} domain={custom} sslAuto={sslAuto} />
            ) : (
              <Card>
                <CardHeader
                  title="Connect your own domain"
                  description="Use an address like www.yourspa.ae for your website and online booking."
                />
                <CardBody>
                  <AddDomainForm slug={slug} />
                </CardBody>
              </Card>
            )}
          </div>
          <aside className="min-w-0 space-y-6 lg:col-span-4">
            <Card>
              <CardHeader
                title="Free address"
                description="Always works, even with your own domain connected."
                action={
                  customPrimary ? (
                    <SubdomainPrimaryButton slug={slug} />
                  ) : (
                    <Badge tone="accent">Primary</Badge>
                  )
                }
              />
              <CardBody className="space-y-3">
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
                  <CopyButton value={freeUrl} label="Copy link" />
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="How it works" />
              <CardBody>
                <ol className="space-y-4">
                  {(
                    [
                      ['pending', 'You add your domain and two DNS records.'],
                      ['verifying', 'We confirm you own it and that it points to us.'],
                      ['active', 'Your site goes live on it with free SSL and becomes your primary address.'],
                    ] as const
                  ).map(([key, text]) => (
                    <li key={key} className="flex items-start gap-3 text-sm">
                      <Badge tone={STATUS[key].tone} className="mt-px w-[4.75rem] justify-center">
                        {STATUS[key].label}
                      </Badge>
                      <span className="text-muted">{text}</span>
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          </aside>
        </div>
      </PageBody>
    </>
  )
}

function DomainCard({ slug, domain, sslAuto }: { slug: string; domain: DomainRow; sslAuto: boolean }) {
  const s = STATUS[domain.status]
  const waiting = domain.status === 'pending' || domain.status === 'verifying'
  const records = dnsRecordsFor(domain)
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
            <p className="text-[15px]">{s.text}</p>
            <p className="text-[13px] text-muted">
              {domain.checkedAt ? `Last checked ${formatDateTime(domain.checkedAt)}` : 'Not checked yet'}
              {waiting ? ' · we also check automatically every 10 minutes' : ''}
              {domain.status === 'active' ? ' · re-checked daily' : ''}
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
        <DomainActions
          slug={slug}
          id={domain.id}
          hostname={domain.hostname}
          status={domain.status}
          isPrimary={domain.isPrimary}
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
            Leave TTL on its default.
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
      {!sslAuto && (
        <Note title="Automatic SSL is not switched on yet">
          We can verify your domain now; HTTPS certificates for custom domains start as soon as our team
          enables them for your account.
        </Note>
      )}
    </CardBody>
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
