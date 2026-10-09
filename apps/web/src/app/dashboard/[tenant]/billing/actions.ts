'use server'
import { platformDb, platformInvoices } from '@spa/db'
import { cardPayableInvoice, createInvoiceCheckout, StripeError, stripeConfig } from '@spa/services'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { can, requireMember } from '@/server/access'
import { audit } from '@/server/audit'
import { appUrl } from '@/server/origin'

/** Errors are i18n keys (or Stripe's own text); the button renders them via `t.maybe`. Starts a Stripe Checkout for one of the spa's open invoices and returns the hosted payment page URL. */
export async function payInvoiceByCardAction(
  slug: string,
  invoiceId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  // Not `guard`: a paused (read-only) spa must still be able to pay its invoices.
  const ctx = await requireMember(slug)
  if (!can(ctx, 'billing.view')) return { ok: false, error: 'errors.forbidden' }
  if (ctx.tenant.deletedAt) return { ok: false, error: 'errors.readOnly' }
  const cfg = stripeConfig()
  if (!cfg) return { ok: false, error: 'billing.error.cardsOff' }
  if (!z.uuid().safeParse(invoiceId).success) return { ok: false, error: 'billing.error.notFound' }
  const db = platformDb()
  // Re-checked here, not only in the page: a partly paid invoice (setup deposit) must not be charged in full.
  const payable = await cardPayableInvoice(db, ctx.tenant.id, invoiceId)
  if (!payable.invoice) return { ok: false, error: `billing.error.${payable.error}` }
  const { invoice } = payable
  const back = await appUrl(`/${slug}/billing`)
  try {
    const session = await createInvoiceCheckout(cfg, {
      invoice,
      email: ctx.user.email,
      successUrl: `${back}?paid=${invoice.id}`,
      cancelUrl: back,
    })
    if (!session.url) return { ok: false, error: 'billing.error.noPage' }
    await db
      .update(platformInvoices)
      .set({ stripeSessionId: session.id })
      .where(eq(platformInvoices.id, invoice.id))
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'billing.card_checkout_started',
      entity: 'platform_invoice',
      entityId: invoice.id,
      data: { number: invoice.number, test: cfg.test },
    })
    return { ok: true, url: session.url }
  } catch (e) {
    if (e instanceof StripeError) return { ok: false, error: e.message }
    throw e
  }
}
