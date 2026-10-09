import { whatsappLink } from '@spa/core'
import {
  branches,
  clientMemberships,
  clients,
  dayCloses,
  payments,
  refunds,
  saleLines,
  sales,
  staff,
  tips,
  withTenant,
} from '@spa/db'
import { METHOD_LABEL, refundOptions } from '@spa/services'
import { and, asc, eq } from 'drizzle-orm'
import { ArrowLeft, MessageCircle, Plus } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { maskPhone } from '@/components/calendar/time'
import { Card, Note } from '@/components/crm'
import { PrintButton, RefundSheet, VoidSheet } from '@/components/pos/receipt-actions'
import { SaleStatusPill } from '@/components/pos/status'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { formatAed, formatDate, formatDateTime } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { refundSaleAction, voidSaleAction } from '../actions'
import { dayDate } from '../data'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('sales.receipt.title') }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const n = (v: string | number) => Number(v)

/** Prints only the receipt (hides the app shell). */
const PRINT_CSS = `@media print {
  @page { margin: 12mm; }
  body * { visibility: hidden !important; }
  #receipt, #receipt * { visibility: visible !important; }
  #receipt { position: absolute; inset: 0 auto auto 0; width: 100%; border: 0 !important; box-shadow: none !important; }
}`

export default async function ReceiptPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slugParam, id } = await params
  const ctx = await requireMember(slugParam)
  if (!can(ctx, 'pos.use') || !UUID.test(id)) notFound()
  const slug = ctx.tenant.slug
  const seePhone = can(ctx, 'clients.phone')
  const { t, fmt } = await getI18n()
  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const [row] = await tx
      .select({ sale: sales, branch: branches, client: clients })
      .from(sales)
      .innerJoin(branches, eq(branches.id, sales.branchId))
      .leftJoin(clients, eq(clients.id, sales.clientId))
      .where(eq(sales.id, id))
    if (!row) return null
    if (ctx.member && !ctx.member.allBranches && !ctx.member.branchIds.includes(row.sale.branchId))
      return null
    const [lines, payRows, tipRows, refundRows, closed] = await Promise.all([
      tx
        .select({ line: saleLines, therapist: staff.displayName })
        .from(saleLines)
        .leftJoin(staff, eq(staff.id, saleLines.staffId))
        .where(eq(saleLines.saleId, id)),
      tx.select().from(payments).where(eq(payments.saleId, id)).orderBy(asc(payments.createdAt)),
      tx
        .select({ id: tips.id, amount: tips.amountAed, method: tips.method, name: staff.displayName })
        .from(tips)
        .innerJoin(staff, eq(staff.id, tips.staffId))
        .where(eq(tips.saleId, id)),
      tx.select().from(refunds).where(eq(refunds.saleId, id)).orderBy(asc(refunds.createdAt)),
      tx
        .select({ id: dayCloses.id })
        .from(dayCloses)
        .where(
          and(eq(dayCloses.branchId, row.sale.branchId), eq(dayCloses.businessDate, row.sale.businessDate)),
        ),
    ])
    const refundable = await refundOptions(tx, id)
    const periods = lines.some((l) => l.line.kind === 'membership')
      ? await tx.select().from(clientMemberships).where(eq(clientMemberships.saleId, id))
      : []
    return {
      ...row,
      lines,
      payRows,
      tipRows,
      refundRows,
      refundable,
      periods,
      dayClosed: closed.length > 0,
    }
  })
  if (!data) notFound()

  const { sale, branch, client, lines, payRows, tipRows, refundRows, refundable, periods } = data
  const periodOf = new Map(periods.map((m) => [m.saleLineId, m]))
  const tenant = ctx.tenant
  const refunded = refundRows.reduce((s, r) => s + n(r.amountAed), 0)
  const refundedQty = new Map(refundable.lines.map((l) => [l.saleLineId, l.refundedQty]))
  const canRefundLines = refundable.remainingAed > 0 && refundable.lines.some((l) => l.unitsAed.length > 0)
  const lineGross = (l: (typeof lines)[number]['line']) => n(l.unitPriceAed) * l.qty - n(l.discountAed)
  const issued = formatDateTime(sale.createdAt)

  const shareText = [
    `${tenant.legalName ?? tenant.name} — receipt #${sale.number}`,
    formatDate(sale.createdAt),
    '',
    ...lines.map(
      ({ line }) =>
        `${line.qty > 1 ? `${line.qty} × ` : ''}${line.description}: ${formatAed(lineGross(line))}`,
    ),
    ...(n(sale.discountAed) > 0 ? [`Discount: −${formatAed(sale.discountAed)}`] : []),
    `Total: ${formatAed(sale.totalAed)} (incl. VAT ${formatAed(sale.vatAed)})`,
    ...payRows.map((p) => `Paid ${METHOD_LABEL[p.method]}: ${formatAed(p.amountAed)}`),
    ...(n(sale.tipsAed) > 0 ? [`Tips: ${formatAed(sale.tipsAed)}`] : []),
    ...(tenant.trn ? [`TRN ${tenant.trn}`] : []),
    '',
    'Thank you for visiting!',
  ].join('\n')
  const share =
    client?.phoneE164 && seePhone && sale.status !== 'void'
      ? whatsappLink(client.phoneE164, shareText, 'mobile')
      : null
  const canRefund = can(ctx, 'pos.refund')

  return (
    <>
      <style>{PRINT_CSS}</style>
      <PageHeader
        eyebrow={t('sales.businessDay', { date: fmt.date(`${sale.businessDate}T12:00:00Z`) })}
        title={t('sales.receipt.sale', { number: sale.number })}
        description={client ? client.name : t('sales.walkIn')}
        actions={
          <Button variant="ghost" asChild>
            <Link href={appPath(`/${slug}/sales`)}>
              <ArrowLeft /> {t('sales.back')}
            </Link>
          </Button>
        }
      />
      <div className="grid gap-[var(--crm-grid-gap)] lg:grid-cols-12">
        {/* The receipt is the client's document: it stays in the customer language (English), not the UI language. */}
        <Card id="receipt" lang="en" className="mx-auto w-full max-w-xl lg:col-span-7 lg:max-w-none">
          <div className="space-y-5 px-1 py-2 sm:px-6 sm:py-6">
            <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <p className="text-lg font-semibold tracking-tight">{tenant.legalName ?? tenant.name}</p>
                <p className="text-[13px] text-muted">
                  {[
                    branch.name !== tenant.name && branch.name !== tenant.legalName ? branch.name : null,
                    branch.address,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {tenant.trn ? (
                  <p className="text-[13px] text-muted tabular">TRN {tenant.trn}</p>
                ) : (
                  <p className="text-[13px] text-muted print:hidden" lang={t.locale}>
                    {t('sales.receipt.addTrn')}
                  </p>
                )}
              </div>
              <div className="space-y-1 sm:text-end">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
                  Simplified tax invoice
                </p>
                <p className="text-sm font-medium tabular">No. {sale.number}</p>
                <p className="text-[13px] text-muted tabular">{issued}</p>
                <div className="pt-1 print:hidden" lang={t.locale}>
                  <SaleStatusPill t={t} status={sale.status} partRefunded={refunded > 0} />
                </div>
              </div>
            </header>

            {client && (
              <p className="text-sm">
                <span className="text-muted">Client </span>
                <span className="font-medium">{client.name}</span>
                {client.phoneE164 && (
                  <span className="text-muted tabular">
                    {' '}
                    · {seePhone ? `+${client.phoneE164}` : maskPhone(client.phoneE164)}
                  </span>
                )}
              </p>
            )}

            <ul className="divide-y">
              {lines.map(({ line, therapist }) => (
                <li key={line.id} className="flex items-start justify-between gap-4 py-3 first:pt-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{line.description}</p>
                    <p className="text-[13px] text-muted tabular">
                      {line.qty} × {formatAed(line.unitPriceAed)}
                      {n(line.discountAed) > 0 && ` · −${formatAed(line.discountAed)}`}
                      {therapist && ` · ${therapist}`}
                    </p>
                    {periodOf.get(line.id) && (
                      <p className="text-[13px] text-muted tabular">
                        Membership {formatDate(dayDate(periodOf.get(line.id)!.currentPeriodStart))} –{' '}
                        {formatDate(dayDate(periodOf.get(line.id)!.currentPeriodEnd))}
                      </p>
                    )}
                    {(refundedQty.get(line.id) ?? 0) > 0 && (
                      <p className="text-[13px] text-danger tabular">
                        {refundedQty.get(line.id) === line.qty
                          ? 'Refunded'
                          : `${refundedQty.get(line.id)} of ${line.qty} refunded`}
                      </p>
                    )}
                  </div>
                  <p className="shrink-0 text-sm tabular">{formatAed(lineGross(line))}</p>
                </li>
              ))}
            </ul>

            <dl className="space-y-2 border-t pt-4 text-sm">
              {n(sale.discountAed) > 0 && (
                <>
                  <Row label="Subtotal" value={formatAed(sale.subtotalAed)} />
                  <Row label="Discount" value={`−${formatAed(sale.discountAed)}`} />
                </>
              )}
              <div className="flex items-baseline justify-between gap-4 pt-1">
                <dt className="font-medium">Total (AED, VAT included)</dt>
                <dd className="text-xl font-semibold tracking-tight tabular">{formatAed(sale.totalAed)}</dd>
              </div>
              <Row label="VAT 5% included" value={formatAed(sale.vatAed)} muted />
              <Row label="Amount excl. VAT" value={formatAed(n(sale.totalAed) - n(sale.vatAed))} muted />
            </dl>

            <dl className="space-y-2 border-t pt-4 text-sm">
              <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted">Paid</p>
              {payRows.length === 0 && <p className="text-muted">Nothing to pay</p>}
              {payRows.map((p) => (
                <Row
                  key={p.id}
                  label={`${METHOD_LABEL[p.method]}${p.reference ? ` · ${p.reference}` : ''}`}
                  value={formatAed(p.amountAed)}
                />
              ))}
            </dl>

            {tipRows.length > 0 && (
              <dl className="space-y-2 border-t pt-4 text-sm">
                <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted">Tips</p>
                {tipRows.map((t) => (
                  <Row
                    key={t.id}
                    label={`${t.name} · ${METHOD_LABEL[t.method]}`}
                    value={formatAed(t.amount)}
                  />
                ))}
              </dl>
            )}

            {(refundRows.length > 0 || sale.status === 'void') && (
              <dl className="space-y-2 rounded-xl bg-danger-soft/60 px-4 py-3 text-sm text-danger">
                {sale.status === 'void' && <p className="font-medium">Voided — {sale.voidReason}</p>}
                {refundRows.map((r) => (
                  <Row
                    key={r.id}
                    label={`Refund ${formatDate(r.createdAt)} · ${METHOD_LABEL[r.method]} · ${r.reason}`}
                    value={`−${formatAed(r.amountAed)}`}
                  />
                ))}
              </dl>
            )}

            <p className="border-t pt-5 text-center text-[13px] text-muted">Thank you for visiting.</p>
          </div>
        </Card>

        <div className="crm-stack h-fit lg:col-span-5 print:hidden">
          <Card title={t('sales.receipt.share')} sub={t('sales.receipt.shareHint')}>
            <div className="space-y-2">
              {share ? (
                <Button className="w-full" asChild>
                  <a href={share} target="_blank" rel="noreferrer">
                    <MessageCircle /> {t('sales.receipt.whatsapp')}
                  </a>
                </Button>
              ) : (
                <Note>
                  {client?.phoneE164 ? t('sales.receipt.phoneHidden') : t('sales.receipt.noMobile')}
                </Note>
              )}
              <PrintButton />
              <Button variant="ghost" className="w-full" asChild>
                <Link href={appPath(`/${slug}/sales/new`)}>
                  <Plus /> {t('sales.newSale')}
                </Link>
              </Button>
            </div>
          </Card>
          {canRefund && sale.status === 'paid' && (canRefundLines || (refunded === 0 && !data.dayClosed)) && (
            <Card title={t('sales.receipt.corrections')} sub={t('sales.receipt.correctionsHint')}>
              <div className="space-y-1">
                {canRefundLines && (
                  <RefundSheet
                    action={refundSaleAction.bind(null, slug, sale.id)}
                    lines={refundable.lines}
                    maxAed={refundable.remainingAed}
                    defaultMethod={payRows[0]?.method === 'card_terminal' ? 'card_terminal' : 'cash'}
                  />
                )}
                {sale.status === 'paid' && refunded === 0 && !data.dayClosed && (
                  <VoidSheet action={voidSaleAction.bind(null, slug, sale.id)} number={sale.number} />
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={muted ? 'flex justify-between gap-4 text-muted' : 'flex justify-between gap-4'}>
      <dt className="min-w-0">{label}</dt>
      <dd className="shrink-0 tabular">{value}</dd>
    </div>
  )
}
