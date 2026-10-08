'use server'
import { platformDb, platformInvoices } from '@spa/db'
import { createInvoiceCheckout, StripeError, stripeConfig } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'
import { appUrl } from '@/server/origin'

/** Errors are i18n keys (or Stripe's own text); the button renders them via `t.maybe`. Starts a Stripe Checkout for one of the spa's open invoices and returns the hosted payment page URL. */
export async function payInvoiceByCardAction(
  slug: string,
  invoiceId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { ctx, error } = await guard(slug, 'billing.view')
  if (error) return { ok: false, error }
  const cfg = stripeConfig()
  if (!cfg)
    return { ok: false, error: 'billing.error.cardsOff' }
  if (!z.uuid().safeParse(invoiceId).success) return { ok: false, error: 'billing.error.notFound' }
  const db = platformDb()
  const [invoice] = await db
    .select()
    .from(platformInvoices)
    .where(and(eq(platformInvoices.id, invoiceId), eq(platformInvoices.tenantId, ctx.tenant.id)))
  if (invoice?.status !== 'issued') return { ok: false, error: 'billing.error.notOpen' }
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
