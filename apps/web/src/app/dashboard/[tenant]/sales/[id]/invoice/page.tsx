import { branches, clients, payments, refunds, saleLines, sales, withTenant } from '@spa/db'
import { METHOD_LABEL, taxInvoiceLines } from '@spa/services'
import { asc, eq } from 'drizzle-orm'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, Note } from '@/components/crm'
import { PrintButton } from '@/components/pos/receipt-actions'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page'
import { getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { formatAed, formatDate } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { BillingForm } from './billing-form'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('sales.invoice.title') }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Prints only the invoice (hides the app shell), like the receipt. */
const PRINT_CSS = `@media print {
  @page { size: A4; margin: 12mm; }
  body * { visibility: hidden !important; }
  #invoice, #invoice * { visibility: visible !important; }
  #invoice { position: absolute; inset: 0 auto auto 0; width: 100%; border: 0 !important; box-shadow: none !important; }
  #invoice .inv-scroll { overflow: visible !important; }
}`

/**
 * The client's document stays English with Arabic labels (UAE practice), whatever the UI language — like the receipt.
 * Labels: [English, Arabic].
 */
const L = {
  title: ['Tax Invoice', 'فاتورة ضريبية'],
  supplier: ['Supplier', 'المورد'],
  customer: ['Customer', 'العميل'],
  trn: ['TRN', 'رقم التسجيل الضريبي'],
  number: ['Invoice no.', 'رقم الفاتورة'],
  issued: ['Date of issue', 'تاريخ الإصدار'],
  supplied: ['Date of supply', 'تاريخ التوريد'],
  description: ['Description', 'الوصف'],
  qty: ['Qty', 'الكمية'],
  unit: ['Unit price (incl. VAT)', 'سعر الوحدة شامل الضريبة'],
  discount: ['Discount', 'الخصم'],
  taxable: ['Taxable amount', 'المبلغ الخاضع للضريبة'],
  rate: ['VAT %', 'نسبة الضريبة'],
  vat: ['VAT (AED)', 'مبلغ الضريبة'],
  total: ['Total (AED)', 'الإجمالي'],
  totalTaxable: ['Total excl. VAT', 'الإجمالي قبل الضريبة'],
  totalDiscount: ['Total discount', 'إجمالي الخصم'],
  totalVat: ['Total VAT', 'إجمالي ضريبة القيمة المضافة'],
  payable: ['Amount payable (AED)', 'المبلغ المستحق بالدرهم'],
  paid: ['Paid', 'المدفوع'],
  balance: ['Balance due', 'الرصيد المستحق'],
  refunds: ['Refunds (credit notes)', 'المبالغ المستردة'],
  outOfScope: [
    'Prepaid value — VAT is charged when it is used.',
    'قيمة مدفوعة مسبقاً — تُحتسب الضريبة عند الاستخدام.',
  ],
} as const

function Bi({ k, className }: { k: keyof typeof L; className?: string }) {
  const [en, ar] = L[k]
  return (
    <span className={className}>
      {en}{' '}
      <span lang="ar" dir="rtl" className="font-normal opacity-80">
        {ar}
      </span>
    </span>
  )
}

export default async function TaxInvoicePage({
  params,
}: {
  params: Promise<{ tenant: string; id: string }>
}) {
  const { tenant: slugParam, id } = await params
  const ctx = await requireMember(slugParam)
  if (!can(ctx, 'pos.use') || !UUID.test(id)) notFound()
  const slug = ctx.tenant.slug
  const t = await getT()
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
    const [lines, payRows, refundRows] = await Promise.all([
      tx.select().from(saleLines).where(eq(saleLines.saleId, id)),
      tx.select().from(payments).where(eq(payments.saleId, id)).orderBy(asc(payments.createdAt)),
      tx.select().from(refunds).where(eq(refunds.saleId, id)).orderBy(asc(refunds.createdAt)),
    ])
    return { ...row, lines, payRows, refundRows }
  })
  if (!data) notFound()

  const { sale, branch, client, lines, payRows, refundRows } = data
  const tenant = ctx.tenant
  const billing = sale.billing ?? client?.billing ?? null
  const tax = taxInvoiceLines(lines)
  const paid = payRows.reduce((s, p) => s + Number(p.amountAed), 0)
  const balance = Math.max(0, Math.round((Number(sale.totalAed) - paid) * 100) / 100)
  const hasPrepaid = tax.lines.some((l) => l.vatRatePct === 0)
  const voided = sale.status === 'void'

  return (
    <>
      <style>{PRINT_CSS}</style>
      <PageHeader
        title={t('sales.invoice.title')}
        description={t('sales.receipt.sale', { number: sale.number })}
        actions={
          <Button variant="ghost" asChild>
            <Link href={appPath(`/${slug}/sales/${sale.id}`)}>
              <ArrowLeft /> {t('sales.invoice.back')}
            </Link>
          </Button>
        }
      />
      <div className="grid gap-[var(--crm-grid-gap)] lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-8">
          {!tenant.trn && <Note tone="warn">{t('sales.invoice.noTrn')}</Note>}
          {voided && <Note tone="warn">{t('sales.invoice.voided')}</Note>}
          {!billing && !voided && <Note>{t('sales.invoice.missing')}</Note>}
          {!voided && (
            <Card id="invoice" lang="en" className="w-full">
              <div className="space-y-6 px-1 py-2 text-sm sm:px-6 sm:py-6">
                <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
                  <h2 className="text-xl font-semibold tracking-tight">
                    <Bi k="title" />
                  </h2>
                  <dl className="space-y-1 text-[13px] sm:text-end">
                    <div>
                      <dt className="inline text-muted">
                        <Bi k="number" />:{' '}
                      </dt>
                      <dd className="inline font-medium tabular" data-testid="invoice-number">
                        {sale.number}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline text-muted">
                        <Bi k="issued" />:{' '}
                      </dt>
                      <dd className="inline tabular">{formatDate(sale.createdAt)}</dd>
                    </div>
                    <div>
                      <dt className="inline text-muted">
                        <Bi k="supplied" />:{' '}
                      </dt>
                      <dd className="inline tabular">{formatDate(`${sale.businessDate}T12:00:00Z`)}</dd>
                    </div>
                  </dl>
                </header>

                <div className="grid gap-5 sm:grid-cols-2">
                  <section className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted">
                      <Bi k="supplier" />
                    </p>
                    <p className="font-semibold">{tenant.legalName ?? tenant.name}</p>
                    {branch.name !== tenant.name && branch.name !== tenant.legalName && (
                      <p className="text-muted">{branch.name}</p>
                    )}
                    {branch.address && <p className="text-muted">{branch.address}</p>}
                    {tenant.trn && (
                      <p className="tabular">
                        <Bi k="trn" />: {tenant.trn}
                      </p>
                    )}
                  </section>
                  <section className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted">
                      <Bi k="customer" />
                    </p>
                    <p className="font-semibold" data-testid="invoice-customer">
                      {billing?.name ?? client?.name ?? '—'}
                    </p>
                    {billing?.address && <p className="whitespace-pre-line text-muted">{billing.address}</p>}
                    {billing?.trn && (
                      <p className="tabular" data-testid="invoice-customer-trn">
                        <Bi k="trn" />: {billing.trn}
                      </p>
                    )}
                  </section>
                </div>

                <div className="inv-scroll -mx-1 overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b text-start align-bottom text-[11px] text-muted">
                        <th className="py-2 pe-2 text-start font-medium">
                          <Bi k="description" />
                        </th>
                        <th className="px-2 py-2 text-end font-medium">
                          <Bi k="qty" />
                        </th>
                        <th className="px-2 py-2 text-end font-medium">
                          <Bi k="unit" />
                        </th>
                        <th className="px-2 py-2 text-end font-medium">
                          <Bi k="discount" />
                        </th>
                        <th className="px-2 py-2 text-end font-medium">
                          <Bi k="taxable" />
                        </th>
                        <th className="px-2 py-2 text-end font-medium">
                          <Bi k="rate" />
                        </th>
                        <th className="px-2 py-2 text-end font-medium">
                          <Bi k="vat" />
                        </th>
                        <th className="py-2 ps-2 text-end font-medium">
                          <Bi k="total" />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="tabular">
                      {lines.map((line, i) => {
                        const x = tax.lines[i]!
                        return (
                          <tr key={line.id} className="border-b align-top">
                            <td className="py-2 pe-2">{line.description}</td>
                            <td className="px-2 py-2 text-end">{x.qty}</td>
                            <td className="px-2 py-2 text-end">{formatAed(x.unitPriceAed)}</td>
                            <td className="px-2 py-2 text-end">
                              {x.discountAed > 0 ? `−${formatAed(x.discountAed)}` : '—'}
                            </td>
                            <td className="px-2 py-2 text-end">{formatAed(x.taxableAed)}</td>
                            <td className="px-2 py-2 text-end">{x.vatRatePct ? `${x.vatRatePct}%` : '—'}</td>
                            <td className="px-2 py-2 text-end">{formatAed(x.vatAed)}</td>
                            <td className="py-2 ps-2 text-end">{formatAed(x.totalAed)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {hasPrepaid && (
                  <p className="text-[12px] text-muted">
                    — <Bi k="outOfScope" />
                  </p>
                )}

                <dl className="ms-auto max-w-sm space-y-2 border-t pt-4">
                  <Row k="totalTaxable" value={formatAed(tax.totals.taxableAed)} />
                  {tax.totals.discountAed > 0 && (
                    <Row k="totalDiscount" value={`−${formatAed(tax.totals.discountAed)}`} muted />
                  )}
                  <Row k="totalVat" value={formatAed(sale.vatAed)} />
                  <div className="flex items-baseline justify-between gap-4 border-t pt-2">
                    <dt className="font-medium">
                      <Bi k="payable" />
                    </dt>
                    <dd className="text-lg font-semibold tabular" data-testid="invoice-total">
                      {formatAed(sale.totalAed)}
                    </dd>
                  </div>
                  {payRows.map((p) => (
                    <div key={p.id} className="flex justify-between gap-4 text-muted">
                      <dt>
                        <Bi k="paid" /> · {METHOD_LABEL[p.method]}
                      </dt>
                      <dd className="tabular">{formatAed(p.amountAed)}</dd>
                    </div>
                  ))}
                  <Row k="balance" value={formatAed(balance)} muted />
                </dl>

                {refundRows.length > 0 && (
                  <dl className="space-y-1 rounded-xl bg-danger-soft/60 px-4 py-3 text-danger">
                    <p className="font-medium">
                      <Bi k="refunds" />
                    </p>
                    {refundRows.map((r) => (
                      <div key={r.id} className="flex justify-between gap-4">
                        <dt>
                          {formatDate(r.createdAt)} · {r.reason}
                        </dt>
                        <dd className="tabular">−{formatAed(r.amountAed)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </Card>
          )}
        </div>

        <div className="crm-stack h-fit lg:col-span-4 print:hidden">
          {!voided && (
            <Card title={t('sales.invoice.billing')} sub={t('sales.invoice.billingSub')}>
              <BillingForm
                slug={slug}
                saleId={sale.id}
                initial={{
                  name: billing?.name ?? client?.name ?? '',
                  address: billing?.address ?? '',
                  trn: billing?.trn ?? '',
                }}
                canSaveToClient={Boolean(client) && can(ctx, 'clients.manage')}
              />
            </Card>
          )}
          {!voided && billing && (
            <Card>
              <PrintButton />
            </Card>
          )}
        </div>
      </div>
    </>
  )
}

function Row({ k, value, muted }: { k: keyof typeof L; value: string; muted?: boolean }) {
  return (
    <div className={muted ? 'flex justify-between gap-4 text-muted' : 'flex justify-between gap-4'}>
      <dt className="min-w-0">
        <Bi k={k} />
      </dt>
      <dd className="shrink-0 tabular">{value}</dd>
    </div>
  )
}
