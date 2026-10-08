// Packages (prepaid session bundles), gift cards and memberships. Sold for cash/card/transfer, tracked as liabilities.
import { addDays, businessDateOf, dubaiParts } from '@spa/core'
import {
  clientPackages,
  giftCards,
  giftCardTxns,
  packageDefinitions,
  packageRedemptions,
  type Tx,
} from '@spa/db'
import { and, eq, lt } from 'drizzle-orm'
import { DomainError } from './errors'
import { post, postRedemption } from './ledger'

const r2 = (n: number) => Math.round(n * 100) / 100

/** Creates the client's package after it was sold (the sale line already credited 2110). */
export async function issuePackage(
  tx: Tx,
  p: {
    tenantId: string
    clientId: string
    definitionId: string
    saleId?: string | null
    saleLineId?: string | null
    now?: Date
  },
) {
  const [def] = await tx.select().from(packageDefinitions).where(eq(packageDefinitions.id, p.definitionId))
  if (!def?.active) throw new DomainError('Package not available', 'not_found')
  const now = p.now ?? new Date()
  const [row] = await tx
    .insert(clientPackages)
    .values({
      tenantId: p.tenantId,
      clientId: p.clientId,
      definitionId: def.id,
      saleId: p.saleId ?? null,
      saleLineId: p.saleLineId ?? null,
      name: def.name.en,
      pricePaidAed: def.priceAed,
      balances: Object.fromEntries(def.items.map((i) => [i.serviceId, i.quantity])),
      remainingValueAed: def.priceAed,
      purchasedAt: now,
      expiresAt: new Date(now.getTime() + def.validityDays * 86_400_000),
    })
    .returning()
  return row!
}

/**
 * Uses one session of a service from a client's package. The session's share of the price moves from
 * the package liability to revenue (with output VAT). Returns the value recognised.
 */
export async function redeemPackageSession(
  tx: Tx,
  r: {
    clientPackageId: string
    serviceId: string
    bookingId?: string | null
    saleId?: string | null
    createdBy?: string | null
    branchId?: string | null
    now?: Date
  },
) {
  const [pkg] = await tx
    .select()
    .from(clientPackages)
    .where(eq(clientPackages.id, r.clientPackageId))
    .for('update')
  if (!pkg) throw new DomainError('Package not found', 'not_found')
  const now = r.now ?? new Date()
  if (pkg.status !== 'active' || pkg.expiresAt < now)
    throw new DomainError('This package is no longer active')
  const left = pkg.balances[r.serviceId] ?? 0
  if (left < 1) throw new DomainError('No sessions of this service left in the package')
  const totalSessionsLeft = Object.values(pkg.balances).reduce((s, n) => s + n, 0)
  const value = r2(Number(pkg.remainingValueAed) / totalSessionsLeft)
  const balances = { ...pkg.balances, [r.serviceId]: left - 1 }
  const remaining = r2(Number(pkg.remainingValueAed) - value)
  const usedUp = Object.values(balances).every((n) => n <= 0)
  await tx
    .update(clientPackages)
    .set({ balances, remainingValueAed: remaining.toFixed(2), status: usedUp ? 'used_up' : 'active' })
    .where(eq(clientPackages.id, pkg.id))
  await tx.insert(packageRedemptions).values({
    tenantId: pkg.tenantId,
    clientPackageId: pkg.id,
    serviceId: r.serviceId,
    bookingId: r.bookingId ?? null,
    saleId: r.saleId ?? null,
    valueAed: value.toFixed(2),
    createdBy: r.createdBy ?? null,
  })
  await postRedemption(tx, {
    tenantId: pkg.tenantId,
    branchId: r.branchId,
    sourceId: pkg.id,
    date: businessDateOf(now),
    valueAed: value,
    createdBy: r.createdBy,
  })
  return { valueAed: value, sessionsLeft: left - 1, usedUp }
}

/** Expired packages: the unused value is recognised as breakage income. */
export async function expirePackages(tx: Tx, tenantId: string, now = new Date()) {
  const expired = await tx
    .select()
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.tenantId, tenantId),
        eq(clientPackages.status, 'active'),
        lt(clientPackages.expiresAt, now),
      ),
    )
  for (const p of expired) {
    await tx.update(clientPackages).set({ status: 'expired' }).where(eq(clientPackages.id, p.id))
    const value = Number(p.remainingValueAed)
    if (value > 0) {
      await post(tx, {
        tenantId,
        date: businessDateOf(now),
        sourceType: 'package_expiry',
        sourceId: p.id,
        memo: `Package expired: ${p.name}`,
        lines: [
          { code: '2110', debit: value },
          { code: '4300', credit: value },
        ],
      })
    }
  }
  return expired.length
}

/** Gift card codes like 7KQ2-M9XA (no ambiguous characters). */
export function newGiftCode(random: () => number = Math.random) {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const part = () => Array.from({ length: 4 }, () => a[Math.floor(random() * a.length)]).join('')
  return `${part()}-${part()}`
}

/** Issues a gift card after it was sold (the sale line already credited 2100). */
export async function issueGiftCard(
  tx: Tx,
  g: {
    tenantId: string
    amountAed: number
    saleId?: string | null
    saleLineId?: string | null
    purchaserClientId?: string | null
    recipientName?: string
    recipientPhone?: string
    message?: string
    validMonths?: number
    createdBy?: string | null
    now?: Date
  },
) {
  if (g.amountAed <= 0) throw new DomainError('Enter an amount')
  const now = g.now ?? new Date()
  let code = newGiftCode()
  for (let i = 0; i < 5; i++) {
    const [exists] = await tx
      .select({ id: giftCards.id })
      .from(giftCards)
      .where(and(eq(giftCards.tenantId, g.tenantId), eq(giftCards.code, code)))
    if (!exists) break
    code = newGiftCode()
  }
  const expiresDate = addDays(dubaiParts(now).date, Math.round((g.validMonths ?? 12) * 30.44))
  const [card] = await tx
    .insert(giftCards)
    .values({
      tenantId: g.tenantId,
      code,
      initialAed: g.amountAed.toFixed(2),
      balanceAed: g.amountAed.toFixed(2),
      purchaserClientId: g.purchaserClientId ?? null,
      recipientName: g.recipientName ?? null,
      recipientPhone: g.recipientPhone ?? null,
      message: g.message ?? null,
      saleId: g.saleId ?? null,
      saleLineId: g.saleLineId ?? null,
      expiresAt: new Date(`${expiresDate}T20:00:00Z`),
    })
    .returning()
  await tx.insert(giftCardTxns).values({
    tenantId: g.tenantId,
    giftCardId: card!.id,
    kind: 'issue',
    amountAed: g.amountAed.toFixed(2),
    saleId: g.saleId ?? null,
    createdBy: g.createdBy ?? null,
  })
  return card!
}

/** Checks a gift card can pay `amountAed` (used before recording a gift_card payment). */
export async function giftCardForPayment(
  tx: Tx,
  tenantId: string,
  code: string,
  amountAed: number,
  now = new Date(),
) {
  const [card] = await tx
    .select()
    .from(giftCards)
    .where(and(eq(giftCards.tenantId, tenantId), eq(giftCards.code, code.trim().toUpperCase())))
    .for('update')
  if (!card) throw new DomainError('Gift card not found', 'not_found')
  if (card.status !== 'active' || (card.expiresAt && card.expiresAt < now))
    throw new DomainError('This gift card is no longer valid')
  if (Number(card.balanceAed) < amountAed)
    throw new DomainError(`Only AED ${card.balanceAed} left on this gift card`)
  return card
}

/** Spends from a gift card as part of a sale. The sale's gift_card payment debits the 2100 liability. */
export async function redeemGiftCard(
  tx: Tx,
  g: { tenantId: string; code: string; amountAed: number; saleId: string; createdBy?: string | null },
) {
  const card = await giftCardForPayment(tx, g.tenantId, g.code, g.amountAed)
  const balance = r2(Number(card.balanceAed) - g.amountAed)
  await tx
    .update(giftCards)
    .set({ balanceAed: balance.toFixed(2), status: balance <= 0 ? 'redeemed' : 'active' })
    .where(eq(giftCards.id, card.id))
  await tx.insert(giftCardTxns).values({
    tenantId: g.tenantId,
    giftCardId: card.id,
    kind: 'redeem',
    amountAed: (-g.amountAed).toFixed(2),
    saleId: g.saleId,
    createdBy: g.createdBy ?? null,
  })
  return { card: { ...card, balanceAed: balance.toFixed(2) } }
}
