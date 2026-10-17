// F15: printable / shareable gift voucher (A6 or A5, HTML print view — no PNG/PDF). The QR (server-side SVG, qrcode
// lib) opens the public check page on the spa's site; redemption stays in POS (type the code or scan the QR).
import { voucherPath, whatsappLink } from '@spa/core'
import { enumLabel } from '@spa/core/i18n'
import { services, withTenant } from '@spa/db'
import { logoUrl, voucherDetails, voucherShareText, voucherStatus } from '@spa/services'
import { asc, eq } from 'drizzle-orm'
import { ArrowLeft, ExternalLink, Pencil } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import QRCode from 'qrcode'
import { Card, Note, Pill, SectionTabs, Stack, statusTone } from '@/components/crm'
import { PrintNow, WhatsAppShare } from '@/components/growth/print-share'
import { WA_MODES } from '@/components/messages/shared'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Input, Select, Textarea } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { formatAed, formatDate } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { publicSiteUrl } from '@/server/sites'
import { saveVoucherAction } from '../actions'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('growth.voucher.open') }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SIZES = { a6: { w: '105mm', h: '148mm' }, a5: { w: '148mm', h: '210mm' } } as const
type Size = keyof typeof SIZES

/** Client document: English with Arabic (UAE practice), whatever the dashboard language. [English, Arabic]. */
const L = {
  title: ['Gift voucher', 'قسيمة هدية'],
  for: ['For', 'إلى'],
  code: ['Code', 'الرمز'],
  valid: ['Valid until', 'صالحة حتى'],
  scan: ['Scan to check the balance', 'امسح الرمز للتحقق من الرصيد'],
} as const

/** A6 and A5 share the √2 ratio, so the card scales with container units and prints at the exact paper size. */
const css = (s: Size) => `
.vch { container-type: inline-size; width: 100%; max-width: ${SIZES[s].w}; aspect-ratio: 105 / 148;
  background: var(--crm-surface); color: var(--crm-text); border: 1px solid var(--crm-line2); border-radius: 14px;
  overflow: hidden; box-shadow: var(--crm-shadow-card); print-color-adjust: exact; -webkit-print-color-adjust: exact; }
.vch-in { height: 100%; display: flex; flex-direction: column; }
.vch-top { background: var(--crm-accent-grad); color: #fff; padding: 6cqi 7cqi 5cqi; display: flex; gap: 3.5cqi; align-items: center; }
.vch-logo { width: 12cqi; height: 12cqi; border-radius: 2.5cqi; background: #fff; object-fit: contain; padding: 1cqi; }
.vch-spa { font: 600 5.2cqi/1.15 var(--crm-head); }
.vch-kind { font-size: 3.4cqi; opacity: .85; margin-top: .6cqi; }
.vch-body { flex: 1; padding: 6cqi 7cqi 0; display: flex; flex-direction: column; gap: 3cqi; }
.vch-value { font: 600 11cqi/1.05 var(--crm-num); color: var(--crm-accent-ink); }
.vch-treat { font: 600 7cqi/1.15 var(--crm-head); color: var(--crm-accent-ink); }
.vch-treat-ar { font-size: 5cqi; font-weight: 500; margin-top: 1cqi; }
.vch-lab { font-size: 3cqi; color: var(--crm-muted); text-transform: uppercase; letter-spacing: .06em; }
.vch-for { font-size: 4.4cqi; font-weight: 600; }
.vch-msg { font-size: 3.8cqi; font-style: italic; color: var(--crm-muted); }
.vch-foot { display: flex; gap: 4cqi; align-items: flex-end; justify-content: space-between; padding: 4cqi 7cqi 6cqi; }
.vch-code { font: 600 6.4cqi/1 var(--crm-num); letter-spacing: .08em; background: var(--crm-lime-soft);
  color: var(--crm-lime-ink); border-radius: 2cqi; padding: 2cqi 3cqi; display: inline-block; margin-top: 1cqi; }
.vch-qr { width: 27cqi; text-align: center; font-size: 2.5cqi; color: var(--crm-muted); line-height: 1.25; }
.vch-qr svg { width: 27cqi; height: 27cqi; display: block; margin-bottom: 1.2cqi; }
.vch-ar { font-family: "Noto Naskh Arabic", "Segoe UI", sans-serif; }
@media print {
  @page { size: ${s.toUpperCase()} portrait; margin: 0; }
  body * { visibility: hidden !important; }
  #voucher, #voucher * { visibility: visible !important; }
  #voucher { position: absolute; inset: 0 auto auto 0; width: ${SIZES[s].w}; max-width: none; height: ${SIZES[s].h};
    border: 0; border-radius: 0; box-shadow: none; }
}`

function Bi({ k, className }: { k: keyof typeof L; className?: string }) {
  const [en, ar] = L[k]
  return (
    <span className={className}>
      {en} ·{' '}
      <span lang="ar" dir="rtl" className="vch-ar">
        {ar}
      </span>
    </span>
  )
}

export default async function VoucherPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; id: string }>
  searchParams: Promise<{ size?: string }>
}) {
  const { tenant: slug, id } = await params
  const ctx = await requireMember(slug)
  if (!(can(ctx, 'pos.use') || can(ctx, 'services.manage')) || !UUID.test(id)) notFound()
  const { t, fmt } = await getI18n()
  const size: Size = (await searchParams).size === 'a5' ? 'a5' : 'a6'
  const { v, options } = await withTenant(ctx.tenant.id, async (tx) => ({
    v: await voucherDetails(tx, id),
    options: await tx
      .select({ id: services.id, name: services.name })
      .from(services)
      .where(eq(services.active, true))
      .orderBy(asc(services.sort), asc(services.createdAt)),
  }))
  if (!v) notFound()
  const card = v.card
  const status = voucherStatus(card)
  const site = await publicSiteUrl(ctx.tenant)
  const checkUrl = `${site}${voucherPath(card.checkToken)}`
  const qr = await QRCode.toString(checkUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 0 })
  const logo = logoUrl(ctx.tenant.logoFileId)
  const value = formatAed(card.initialAed)
  const expires = card.expiresAt ? formatDate(card.expiresAt) : null

  // Share on WhatsApp (click-to-send): to the recipient's mobile, else the buyer's; numbers only for phone roles.
  const phoneOk = can(ctx, 'clients.phone')
  const phone = phoneOk ? (card.recipientPhone ?? v.purchaser?.phone ?? '') : ''
  const lang = v.purchaser?.language === 'ar' && !card.recipientPhone ? 'ar' : 'en'
  const text = voucherShareText(lang, {
    spa: ctx.tenant.name,
    code: card.code,
    value,
    treatment: v.treatment ? (lang === 'ar' && v.treatment.ar) || v.treatment.en : null,
    expires,
    recipient: card.recipientName,
    checkUrl,
  })
  const links = Object.fromEntries(WA_MODES.map((m) => [m, whatsappLink(phone, text, m)])) as Record<
    (typeof WA_MODES)[number],
    string
  >
  const base = appPath(`/${slug}/vouchers/${id}`)

  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static print stylesheet (no user input) */}
      <style dangerouslySetInnerHTML={{ __html: css(size) }} />
      <PageHeader
        eyebrow={t('growth.voucher.eyebrow')}
        title={t('growth.voucher.title', { code: card.code })}
        description={t('growth.voucher.description')}
        actions={
          <Button variant="secondary" asChild>
            <Link href={appPath(`/${slug}/packages?tab=gift-cards`)}>
              <ArrowLeft className="rtl:rotate-180" /> {t('growth.voucher.back')}
            </Link>
          </Button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div id="voucher" className="vch" data-testid="voucher-print">
            <div className="vch-in">
              <div className="vch-top">
                {logo && (
                  <>
                    {/* biome-ignore lint/performance/noImgElement: the spa's own logo on a print document */}
                    <img src={logo} alt="" className="vch-logo" />
                  </>
                )}
                <div className="min-w-0">
                  <div className="vch-spa">{ctx.tenant.name}</div>
                  <div className="vch-kind">
                    <Bi k="title" />
                  </div>
                </div>
              </div>
              <div className="vch-body">
                {v.treatment ? (
                  <div className="vch-treat">
                    {v.treatment.en}
                    {v.treatment.ar && (
                      <div lang="ar" dir="rtl" className="vch-treat-ar vch-ar">
                        {v.treatment.ar}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="vch-value">{value}</div>
                )}
                {card.recipientName && (
                  <div>
                    <div className="vch-lab">
                      <Bi k="for" />
                    </div>
                    <div className="vch-for">{card.recipientName}</div>
                  </div>
                )}
                {card.message && <div className="vch-msg">“{card.message}”</div>}
              </div>
              <div className="vch-foot">
                <div>
                  <div className="vch-lab">
                    <Bi k="code" />
                  </div>
                  <div className="vch-code" data-testid="voucher-code">
                    {card.code}
                  </div>
                  {expires && (
                    <div className="vch-lab" style={{ marginTop: '3cqi' }}>
                      <Bi k="valid" />: <span style={{ color: 'var(--crm-text)' }}>{expires}</span>
                    </div>
                  )}
                </div>
                <div className="vch-qr">
                  {/* biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generated server-side by the qrcode library */}
                  <div dangerouslySetInnerHTML={{ __html: qr }} />
                  {L.scan[0]}
                  <br />
                  <span lang="ar" dir="rtl" className="vch-ar">
                    {L.scan[1]}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <Stack>
          <Card>
            <div className="flex items-center justify-between gap-2">
              <span className="crm-muted text-sm">{t('packages.card.status')}</span>
              <Pill tone={statusTone(card.status)} dot>
                {fmt.aed(card.balanceAed)} · {enumLabel(t, 'giftCardStatus', card.status)}
              </Pill>
            </div>
            <div className="mt-4 space-y-2">
              <SectionTabs
                label={t('growth.voucher.size')}
                value={size}
                items={[
                  { value: 'a6', label: 'A6', href: `${base}?size=a6` },
                  { value: 'a5', label: 'A5', href: `${base}?size=a5` },
                ]}
              />
              <div className="flex flex-wrap gap-2 pt-2">
                <PrintNow label={t('growth.voucher.print')} />
                {status !== 'void' && <WhatsAppShare links={links} label={t('growth.voucher.share')} />}
              </div>
              {!phone && <p className="crm-muted text-xs">{t('growth.voucher.shareNoPhone')}</p>}
              <a
                href={checkUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-[var(--crm-accent)] underline-offset-4 hover:underline"
              >
                <ExternalLink className="size-3.5" /> {t('growth.voucher.checkPage')}
              </a>
            </div>
          </Card>
          <Card>
            <FormSheet
              title={t('growth.voucher.edit')}
              description={t('growth.voucher.editDescription')}
              action={saveVoucherAction.bind(null, slug, id)}
              submitLabel={t('growth.voucher.save')}
              trigger={
                <Button variant="secondary" className="w-full">
                  <Pencil /> {t('growth.voucher.edit')}
                </Button>
              }
            >
              <Field label={t('growth.voucher.recipientName')} name="recipientName">
                <Input id="recipientName" name="recipientName" defaultValue={card.recipientName ?? ''} />
              </Field>
              {phoneOk && (
                <Field label={t('growth.voucher.recipientPhone')} name="recipientPhone">
                  <Input
                    id="recipientPhone"
                    name="recipientPhone"
                    inputMode="tel"
                    defaultValue={card.recipientPhone ?? ''}
                  />
                </Field>
              )}
              <Field label={t('growth.voucher.message')} name="message">
                <Textarea id="message" name="message" rows={2} defaultValue={card.message ?? ''} />
              </Field>
              <Field
                label={t('growth.voucher.treatment')}
                name="voucherServiceId"
                hint={t('growth.voucher.treatmentHint')}
              >
                <Select
                  id="voucherServiceId"
                  name="voucherServiceId"
                  defaultValue={card.voucherServiceId ?? ''}
                >
                  <option value="">{t('growth.voucher.treatmentNone')}</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name.en}
                    </option>
                  ))}
                </Select>
              </Field>
            </FormSheet>
            <div className="mt-3">
              <Note>{t('growth.voucher.redeemHint')}</Note>
            </div>
          </Card>
        </Stack>
      </div>
    </>
  )
}
