// F16: printable booking-QR posters (A4 / A5) for reception and partners (hotel concierges). The QR opens the
// online booking page with `?src=qr` (F13 attribution) and, for a partner, `&partner={code}` (bookings.partner_id).
import { posterBookingUrl } from '@spa/core'
import { withTenant } from '@spa/db'
import { logoUrl, partnerBookingStats } from '@spa/services'
import { Plus, QrCode } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import QRCode from 'qrcode'
import { Card, Pill, SectionTabs, Stack } from '@/components/crm'
import { PrintNow } from '@/components/growth/print-share'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Input } from '@/components/ui/input'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { publicSiteUrl } from '@/server/sites'
import { createPartnerAction } from './actions'
import { PartnerToggle } from './partner-toggle'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('growth.poster.title') }
}

const SIZES = { a4: { w: '210mm', h: '297mm' }, a5: { w: '148mm', h: '210mm' } } as const
type Size = keyof typeof SIZES

/** Client copy on the poster: English + Arabic. */
const L = {
  headline: ['Book your treatment', 'احجز جلستك'],
  scan: ['Scan to see free times and book online', 'امسح الرمز لمعرفة المواعيد المتاحة والحجز عبر الإنترنت'],
  guests: ['For guests of {name}', 'لضيوف {name}'],
  confirm: ['We confirm your booking on WhatsApp', 'نؤكد حجزك عبر واتساب'],
} as const

const css = (s: Size) => `
.qrp { container-type: inline-size; width: 100%; max-width: ${s === 'a4' ? '150mm' : SIZES[s].w}; aspect-ratio: 210 / 297;
  background: var(--crm-surface); color: var(--crm-text); border: 1px solid var(--crm-line2); border-radius: 14px; overflow: hidden;
  box-shadow: var(--crm-shadow-card); print-color-adjust: exact; -webkit-print-color-adjust: exact; }
.qrp-in { height: 100%; display: flex; flex-direction: column; align-items: center; text-align: center; padding: 8cqi 8cqi 6cqi; gap: 3cqi; }
.qrp-logo { width: 16cqi; height: 16cqi; object-fit: contain; border-radius: 3cqi; }
.qrp-spa { font: 600 6cqi/1.15 var(--crm-head); color: var(--crm-accent-ink); }
.qrp-head { font: 600 9cqi/1.08 var(--crm-head); margin-top: 2cqi; }
.qrp-ar { font-family: "Noto Naskh Arabic", "Segoe UI", sans-serif; }
.qrp-head-ar { font-size: 7cqi; font-weight: 600; }
.qrp-guests { background: var(--crm-lime-soft); color: var(--crm-lime-ink); border-radius: 99px; padding: 1.6cqi 4.5cqi; font-size: 3.8cqi; font-weight: 600; }
.qrp-qr { width: 52cqi; height: 52cqi; padding: 3cqi; border: 0.6cqi solid var(--crm-accent); border-radius: 5cqi; margin: 2cqi 0; background: #fff; }
.qrp-qr svg { width: 100%; height: 100%; display: block; }
.qrp-scan { font-size: 3.8cqi; color: var(--crm-muted); line-height: 1.35; }
.qrp-url { font: 500 3.2cqi/1.2 var(--crm-num); color: var(--crm-accent-ink); word-break: break-all; }
.qrp-foot { margin-top: auto; font-size: 3.2cqi; color: var(--crm-muted); }
@media print {
  @page { size: ${s.toUpperCase()} portrait; margin: 0; }
  body * { visibility: hidden !important; }
  #poster, #poster * { visibility: visible !important; }
  #poster { position: absolute; inset: 0 auto auto 0; width: ${SIZES[s].w}; max-width: none; height: ${SIZES[s].h};
    border: 0; border-radius: 0; box-shadow: none; }
}`

export default async function PostersPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ size?: string; partner?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'marketing.campaigns')) notFound()
  const { t, fmt } = await getI18n()
  const slug = ctx.tenant.slug
  const sp = await searchParams
  const size: Size = sp.size === 'a5' ? 'a5' : 'a4'
  const stats = await withTenant(ctx.tenant.id, (tx) => partnerBookingStats(tx))
  const partner = stats.partners.find((p) => p.id === sp.partner) ?? null
  const site = await publicSiteUrl(ctx.tenant)
  const url = posterBookingUrl(site, partner?.code)
  const qr = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 0 })
  const logo = logoUrl(ctx.tenant.logoFileId)
  const base = appPath(`/${slug}/posters`)
  const href = (q: { size?: Size; partner?: string | null }) => {
    const u = new URLSearchParams()
    const s = q.size ?? size
    if (s !== 'a4') u.set('size', s)
    const p = q.partner === undefined ? partner?.id : q.partner
    if (p) u.set('partner', p)
    const qs = u.toString()
    return qs ? `${base}?${qs}` : base
  }
  const shortUrl = url.replace(/^https?:\/\//, '')
  const date = (d: Date | null) => (d ? fmt.date(d) : '—')

  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static print stylesheet (no user input) */}
      <style dangerouslySetInnerHTML={{ __html: css(size) }} />
      <PageHeader title={t('growth.poster.title')} description={t('growth.poster.description')} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Stack>
          <Card
            title={
              partner
                ? t('growth.poster.partnerPoster', { name: partner.name })
                : t('growth.poster.reception')
            }
            sub={partner ? undefined : t('growth.poster.receptionSub')}
          >
            <div className="space-y-3">
              <SectionTabs
                label={t('growth.poster.size')}
                value={size}
                items={[
                  { value: 'a4', label: 'A4', href: href({ size: 'a4' }) },
                  { value: 'a5', label: 'A5', href: href({ size: 'a5' }) },
                ]}
              />
              <div className="flex flex-wrap items-center gap-2">
                <PrintNow label={t('growth.poster.print')} />
                <CopyButton value={url} label={t('growth.poster.link')} />
              </div>
              <p className="crm-muted break-all text-xs" data-testid="poster-url">
                {url}
              </p>
            </div>
          </Card>
          <div id="poster" className="qrp" data-testid="poster-print">
            <div className="qrp-in">
              {logo && (
                <>
                  {/* biome-ignore lint/performance/noImgElement: the spa's own logo on a print document */}
                  <img src={logo} alt="" className="qrp-logo" />
                </>
              )}
              <div className="qrp-spa">{ctx.tenant.name}</div>
              <div>
                <div className="qrp-head">{L.headline[0]}</div>
                <div lang="ar" dir="rtl" className="qrp-head-ar qrp-ar">
                  {L.headline[1]}
                </div>
              </div>
              {partner && (
                <div className="qrp-guests">
                  {L.guests[0].replace('{name}', partner.name)} ·{' '}
                  <span lang="ar" dir="rtl" className="qrp-ar">
                    {L.guests[1].replace('{name}', partner.name)}
                  </span>
                </div>
              )}
              {/* biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generated server-side by the qrcode library */}
              <div className="qrp-qr" dangerouslySetInnerHTML={{ __html: qr }} />
              <div className="qrp-scan">
                {L.scan[0]}
                <br />
                <span lang="ar" dir="rtl" className="qrp-ar">
                  {L.scan[1]}
                </span>
              </div>
              <div className="qrp-url">{shortUrl}</div>
              <div className="qrp-foot">
                {L.confirm[0]} ·{' '}
                <span lang="ar" dir="rtl" className="qrp-ar">
                  {L.confirm[1]}
                </span>
              </div>
            </div>
          </div>
        </Stack>

        <Card
          title={t('growth.poster.partners')}
          sub={t('growth.poster.partnersSub')}
          actions={
            <FormSheet
              title={t('growth.poster.add')}
              description={t('growth.poster.addDescription')}
              action={createPartnerAction.bind(null, slug)}
              submitLabel={t('growth.poster.create')}
              trigger={
                <Button size="sm">
                  <Plus /> {t('growth.poster.add')}
                </Button>
              }
            >
              <Field label={t('growth.poster.name')} name="name">
                <Input id="name" name="name" maxLength={80} />
              </Field>
            </FormSheet>
          }
        >
          <div className="crm-tbl-wrap">
            <table className="crm-tbl" data-stack="true" data-testid="partner-table">
              <thead>
                <tr>
                  <th>{t('growth.poster.partner')}</th>
                  <th className="crm-num-c">{t('growth.poster.bookings')}</th>
                  <th className="crm-num-c">{t('growth.poster.last30')}</th>
                  <th className="crm-num-c">{t('growth.poster.completed')}</th>
                  <th>{t('growth.poster.latest')}</th>
                  <th>
                    <span className="sr-only">{t('growth.poster.status')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td data-label={t('growth.poster.partner')}>
                    <Link href={href({ partner: null })} className="font-medium hover:underline">
                      {t('growth.poster.reception')}
                    </Link>
                  </td>
                  <td data-label={t('growth.poster.bookings')} className="crm-num-c">
                    {stats.reception.total}
                  </td>
                  <td data-label={t('growth.poster.last30')} className="crm-num-c">
                    {stats.reception.last30}
                  </td>
                  <td data-label={t('growth.poster.completed')} className="crm-num-c">
                    {stats.reception.completed}
                  </td>
                  <td data-label={t('growth.poster.latest')} className="crm-muted">
                    {date(stats.reception.latest)}
                  </td>
                  <td />
                </tr>
                {stats.partners.map((p) => (
                  <tr key={p.id} data-testid={`partner-${p.code}`}>
                    <td data-label={t('growth.poster.partner')}>
                      <Link href={href({ partner: p.id })} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      <div className="crm-muted font-mono text-xs">?partner={p.code}</div>
                    </td>
                    <td data-label={t('growth.poster.bookings')} className="crm-num-c">
                      {p.total}
                    </td>
                    <td data-label={t('growth.poster.last30')} className="crm-num-c">
                      {p.last30}
                    </td>
                    <td data-label={t('growth.poster.completed')} className="crm-num-c">
                      {p.completed}
                    </td>
                    <td data-label={t('growth.poster.latest')} className="crm-muted">
                      {date(p.latest)}
                    </td>
                    <td data-label={t('growth.poster.status')}>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <Pill tone={p.active ? 'ok' : 'neutral'} dot>
                          {p.active ? t('growth.poster.active') : t('growth.poster.paused')}
                        </Pill>
                        <Button size="sm" variant="ghost" asChild>
                          <Link href={href({ partner: p.id })}>
                            <QrCode /> {t('growth.poster.show')}
                          </Link>
                        </Button>
                        <PartnerToggle slug={slug} id={p.id} active={p.active} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {stats.partners.length === 0 && (
            <EmptyState
              icon={<QrCode className="size-5" strokeWidth={1.5} />}
              title={t('growth.poster.emptyTitle')}
              description={t('growth.poster.emptyBody')}
            />
          )}
        </Card>
      </div>
    </>
  )
}
