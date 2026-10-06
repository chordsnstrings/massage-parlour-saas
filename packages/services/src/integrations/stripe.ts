// Stripe Checkout for platform invoices (spas paying their subscription by card). REST via fetch, no SDK.
// Only Checkout Sessions are used: card details never touch our servers, and a session is verified by
// retrieving it from Stripe before anything is recorded.
import { type Db, platformInvoices, platformPayments } from '@spa/db'
import { and, eq, sum } from 'drizzle-orm'

export type StripeConfig = { secretKey: string; test: boolean }

export function stripeConfig(env: Record<string, string | undefined> = process.env): StripeConfig | null {
  const key = env.STRIPE_SECRET_KEY?.trim()
  if (!key) return null
  return { secretKey: key, test: /_test_/.test(key) }
}

export class StripeError extends Error {}

async function stripe<T>(
  cfg: StripeConfig,
  path: string,
  init: { method?: 'GET' | 'POST'; form?: Record<string, string> } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${cfg.secretKey}`,
      ...(init.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: init.form ? new URLSearchParams(init.form) : undefined,
    signal: AbortSignal.timeout(20_000),
  })
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } }
  if (!res.ok) throw new StripeError(body.error?.message ?? `Stripe HTTP ${res.status}`)
  return body
}

export type CheckoutSession = {
  id: string
  url: string | null
  status: 'open' | 'complete' | 'expired'
  payment_status: 'paid' | 'unpaid' | 'no_payment_required'
  amount_total: number | null
  currency: string | null
  payment_intent: string | null
  metadata: Record<string, string>
}

/** AED amounts are sent in fils (2 decimals). */
export const toFils = (aed: string | number) => Math.round(Number(aed) * 100)

export function createInvoiceCheckout(
  cfg: StripeConfig,
  r: {
    invoice: { id: string; tenantId: string; number: string; description: string; totalAed: string }
    email?: string | null
    successUrl: string
    cancelUrl: string
  },
  fetchImpl?: typeof fetch,
) {
  return stripe<CheckoutSession>(
    cfg,
    'checkout/sessions',
    {
      method: 'POST',
      form: {
        mode: 'payment',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'aed',
        'line_items[0][price_data][unit_amount]': String(toFils(r.invoice.totalAed)),
        'line_items[0][price_data][product_data][name]': `Invoice ${r.invoice.number}`,
        'line_items[0][price_data][product_data][description]': r.invoice.description.slice(0, 250),
        client_reference_id: r.invoice.id,
        'metadata[invoice_id]': r.invoice.id,
        'metadata[tenant_id]': r.invoice.tenantId,
        'payment_intent_data[metadata][invoice_id]': r.invoice.id,
        ...(r.email ? { customer_email: r.email } : {}),
        success_url: r.successUrl,
        cancel_url: r.cancelUrl,
      },
    },
    fetchImpl,
  )
}

export const getCheckoutSession = (cfg: StripeConfig, id: string, fetchImpl?: typeof fetch) =>
  stripe<CheckoutSession>(cfg, `checkout/sessions/${encodeURIComponent(id)}`, {}, fetchImpl)

/**
 * Records a paid Checkout Session against its invoice (platform DB). Idempotent: the payment intent is the
 * payment's reference, so a refresh or a second check never records it twice. Returns true when the invoice
 * is (now) paid.
 */
export async function settleCheckoutSession(
  db: Db,
  invoice: { id: string; tenantId: string; totalAed: string },
  session: CheckoutSession,
) {
  if (session.payment_status !== 'paid') return false
  if (session.metadata?.invoice_id !== invoice.id || session.metadata?.tenant_id !== invoice.tenantId)
    throw new StripeError('This payment belongs to a different invoice')
  if (session.currency !== 'aed' || session.amount_total !== toFils(invoice.totalAed))
    throw new StripeError('The paid amount does not match the invoice')
  const reference = `stripe:${session.payment_intent ?? session.id}`
  return db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(platformInvoices)
      .where(eq(platformInvoices.id, invoice.id))
      .for('update')
    if (!inv) return false
    const [seen] = await tx
      .select({ id: platformPayments.id })
      .from(platformPayments)
      .where(and(eq(platformPayments.invoiceId, inv.id), eq(platformPayments.reference, reference)))
    if (!seen)
      await tx.insert(platformPayments).values({
        tenantId: inv.tenantId,
        invoiceId: inv.id,
        amountAed: (session.amount_total! / 100).toFixed(2),
        method: 'card',
        reference,
        receivedAt: new Date().toISOString().slice(0, 10),
        notes: 'Paid by card (Stripe Checkout)',
      })
    const [paid] = await tx
      .select({ total: sum(platformPayments.amountAed) })
      .from(platformPayments)
      .where(eq(platformPayments.invoiceId, inv.id))
    if (Number(paid?.total ?? 0) >= Number(inv.totalAed) && inv.status !== 'paid') {
      await tx
        .update(platformInvoices)
        .set({ status: 'paid', paidAt: new Date() })
        .where(eq(platformInvoices.id, inv.id))
    }
    return true
  })
}
