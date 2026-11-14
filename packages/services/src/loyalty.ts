// Packages (prepaid session bundles), gift cards and memberships. Sold for cash/card/transfer, tracked as liabilities.
import { addDays, businessDateOf, dubaiParts, giftCardInput } from '@spa/core'
import {
  branches,
  clientMemberships,
  clientPackages,
  clients,
  giftCards,
  giftCardTxns,
  membershipPlans,
  membershipRedemptions,
  outbox,
  packageDefinitions,
  packageRedemptions,
  type Tx,
  tenants,
} from '@spa/db'
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm'
import { DomainError } from './errors'
import { post, postRedemption } from './ledger'
import { fmtDay, renderTemplate, templateFor } from './outbox'

const r2 = (n: number) => Math.round(n * 100) / 100

/** Business date "now" by the branch's cutoff (or the tenant's default branch when none is given). */
async function businessDateFor(tx: Tx, now: Date, branchId?: string | null) {
  const [b] = await tx
    .select({ cutoff: branches.businessDayCutoff })
    .from(branches)
    .where(branchId ? eq(branches.id, branchId) : eq(branches.isDefault, true))
    .orderBy(desc(branches.isDefault))
    .limit(1)
  return businessDateOf(now, b?.cutoff.slice(0, 5))
}

/**
 * Creates the client's package after it was sold (the sale line already credited 2110). `pricePaidAed` is what
 * was actually taken for this package (the line's net share after discounts); it defaults to the list price.
 */
export async function issuePackage(
  tx: Tx,
  p: {
    tenantId: string
    clientId: string
    definitionId: string
    saleId?: string | null
    saleLineId?: string | null
    pricePaidAed?: number
    now?: Date
  },
) {
  const [def] = await tx.select().from(packageDefinitions).where(eq(packageDefinitions.id, p.definitionId))
  if (!def?.active) throw new DomainError('Package not available', 'not_found')
  const now = p.now ?? new Date()
  const paid = p.pricePaidAed === undefined ? def.priceAed : r2(p.pricePaidAed).toFixed(2)
  const [row] = await tx
    .insert(clientPackages)
    .values({
      tenantId: p.tenantId,
      clientId: p.clientId,
      definitionId: def.id,
      saleId: p.saleId ?? null,
      saleLineId: p.saleLineId ?? null,
      name: def.name.en,
      pricePaidAed: paid,
      balances: Object.fromEntries(def.items.map((i) => [i.serviceId, i.quantity])),
      remainingValueAed: paid,
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
    /** The sale's business date; otherwise derived from the branch cutoff. */
    businessDate?: string
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
    date: r.businessDate ?? (await businessDateFor(tx, now, r.branchId)),
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
  const date = expired.length ? await businessDateFor(tx, now) : ''
  for (const p of expired) {
    await tx.update(clientPackages).set({ status: 'expired' }).where(eq(clientPackages.id, p.id))
    const value = Number(p.remainingValueAed)
    if (value > 0) {
      await post(tx, {
        tenantId,
        date,
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

/** Where a typed gift card code or a scanned voucher QR (its check-page URL, F15) points. */
const giftCardWhere = (tenantId: string, input: string) => {
  const key = giftCardInput(input)
  return and(
    eq(giftCards.tenantId, tenantId),
    'token' in key ? eq(giftCards.checkToken, key.token) : eq(giftCards.code, key.code),
  )
}

/** The card's code for a typed code or a scanned voucher QR; unknown input comes back normalised (upper case). */
export async function giftCardCode(tx: Tx, tenantId: string, input: string) {
  const key = giftCardInput(input)
  if ('code' in key) return key.code
  const [card] = await tx
    .select({ code: giftCards.code })
    .from(giftCards)
    .where(giftCardWhere(tenantId, input))
  return card?.code ?? input.trim()
}

/** Checks a gift card can pay `amountAed` (used before recording a gift_card payment). */
export async function giftCardForPayment(
  tx: Tx,
  tenantId: string,
  code: string,
  amountAed: number,
  now = new Date(),
) {
  const [card] = await tx.select().from(giftCards).where(giftCardWhere(tenantId, code)).for('update')
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

// ---------------------------------------------------------------------------
// Memberships (PLAN §18 G15): sold per one-month period through POS, like packages. The price sits in 2110
// until it is earned: included sessions move their share to revenue when used (as package sessions do);
// whatever is left when the period ends is recognised then (2110 → 4000 + output VAT). Benefits (discount % on
// services, included sessions per period) are snapshotted from the plan at sale.
// ---------------------------------------------------------------------------

/** Memberships whose benefits can be used: active or due for renewal. */
export const LIVE_MEMBERSHIP = ['active', 'due'] as const
/** A renewal reminder is queued this many days before the period ends. */
export const RENEWAL_NOTICE_DAYS = 7

/** Last day of a one-month period starting `start` (YYYY-MM-DD): same day next month − 1 (clamped to month end). */
export function membershipPeriodEnd(start: string) {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number]
  const lastOfNext = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const next = new Date(Date.UTC(y, m, Math.min(d, lastOfNext)))
  return addDays(next.toISOString().slice(0, 10), -1)
}

/**
 * Creates the client's membership period after it was sold (the sale line already credited 2110). When the
 * client still has a live period of the same plan, this one is the renewal: it starts the day after that one
 * ends, the old one is no longer "due" and its queued renewal reminder is skipped.
 */
export async function issueMembership(
  tx: Tx,
  p: {
    tenantId: string
    clientId: string
    planId: string
    businessDate: string
    saleId?: string | null
    saleLineId?: string | null
    pricePaidAed?: number
    now?: Date
  },
) {
  const [plan] = await tx.select().from(membershipPlans).where(eq(membershipPlans.id, p.planId))
  if (!plan?.active) throw new DomainError('Membership not available', 'not_found')
  const [current] = await tx
    .select()
    .from(clientMemberships)
    .where(
      and(
        eq(clientMemberships.clientId, p.clientId),
        eq(clientMemberships.planId, plan.id),
        inArray(clientMemberships.status, [...LIVE_MEMBERSHIP]),
        gte(clientMemberships.currentPeriodEnd, p.businessDate),
      ),
    )
    .orderBy(desc(clientMemberships.currentPeriodEnd))
    .limit(1)
    .for('update')
  const start = current ? addDays(current.currentPeriodEnd, 1) : p.businessDate
  if (current) {
    if (current.status === 'due')
      await tx.update(clientMemberships).set({ status: 'active' }).where(eq(clientMemberships.id, current.id))
    await tx
      .update(outbox)
      .set({ status: 'skipped' })
      .where(
        and(
          eq(outbox.clientId, p.clientId),
          eq(outbox.kind, 'membership_renewal'),
          eq(outbox.status, 'queued'),
        ),
      )
  }
  const paid = p.pricePaidAed === undefined ? plan.monthlyAed : r2(p.pricePaidAed).toFixed(2)
  const [row] = await tx
    .insert(clientMemberships)
    .values({
      tenantId: p.tenantId,
      clientId: p.clientId,
      planId: plan.id,
      name: plan.name.en,
      discountPct: String(plan.benefits.discountPct ?? 0),
      status: 'active',
      currentPeriodStart: start,
      currentPeriodEnd: membershipPeriodEnd(start),
      balances: Object.fromEntries(
        (plan.benefits.includedSessions ?? []).map((i) => [i.serviceId, i.quantity]),
      ),
      pricePaidAed: paid,
      remainingValueAed: paid,
      saleId: p.saleId ?? null,
      saleLineId: p.saleLineId ?? null,
      lastPaidAt: p.now ?? new Date(),
    })
    .returning()
  return { membership: row!, renewed: Boolean(current) }
}

/** A client's memberships whose benefits apply on `date` (period covers it; active or due). */
export async function liveMemberships(tx: Tx, clientId: string, date: string) {
  return tx
    .select()
    .from(clientMemberships)
    .where(
      and(
        eq(clientMemberships.clientId, clientId),
        inArray(clientMemberships.status, [...LIVE_MEMBERSHIP]),
        lte(clientMemberships.currentPeriodStart, date),
        gte(clientMemberships.currentPeriodEnd, date),
      ),
    )
    .orderBy(asc(clientMemberships.currentPeriodEnd))
}

/** Checks a membership can give its benefits to `clientId` on `date` (row-locked for the sale). */
export async function membershipForUse(tx: Tx, id: string, clientId: string | null, date: string) {
  const [m] = await tx.select().from(clientMemberships).where(eq(clientMemberships.id, id)).for('update')
  if (!m || m.clientId !== clientId) throw new DomainError('That membership belongs to another client')
  if (
    !(LIVE_MEMBERSHIP as readonly string[]).includes(m.status) ||
    m.currentPeriodStart > date ||
    m.currentPeriodEnd < date
  )
    throw new DomainError('This membership is not active today')
  return m
}

/**
 * Uses one included session of a service from a membership period: its share of what is left moves from
 * 2110 to revenue (with output VAT), as a package session does. Returns the value recognised.
 */
export async function redeemMembershipSession(
  tx: Tx,
  r: {
    clientMembershipId: string
    clientId: string | null
    serviceId: string
    businessDate: string
    saleId?: string | null
    branchId?: string | null
    createdBy?: string | null
  },
) {
  const m = await membershipForUse(tx, r.clientMembershipId, r.clientId, r.businessDate)
  const left = m.balances[r.serviceId] ?? 0
  if (left < 1) throw new DomainError('No sessions of this service left in the membership')
  const totalLeft = Object.values(m.balances).reduce((s, n) => s + Math.max(0, n), 0)
  const value = r2(Number(m.remainingValueAed) / totalLeft)
  await tx
    .update(clientMemberships)
    .set({
      balances: { ...m.balances, [r.serviceId]: left - 1 },
      remainingValueAed: r2(Number(m.remainingValueAed) - value).toFixed(2),
    })
    .where(eq(clientMemberships.id, m.id))
  await tx.insert(membershipRedemptions).values({
    tenantId: m.tenantId,
    clientMembershipId: m.id,
    serviceId: r.serviceId,
    saleId: r.saleId ?? null,
    valueAed: value.toFixed(2),
    createdBy: r.createdBy ?? null,
  })
  if (value > 0)
    await postRedemption(tx, {
      tenantId: m.tenantId,
      branchId: r.branchId,
      sourceId: m.id,
      date: r.businessDate,
      valueAed: value,
      createdBy: r.createdBy,
    })
  return { valueAed: value, sessionsLeft: left - 1 }
}

/**
 * Daily renewal pass for one spa (worker job `memberships-renew`):
 * - periods that ended → `expired`; what was not used is recognised as earned (2110 → 4000 + VAT);
 * - periods ending within RENEWAL_NOTICE_DAYS and not renewed yet → `due`, and a WhatsApp renewal reminder is
 *   queued in the outbox for staff to click-to-send (nothing is sent automatically; opted-out clients skipped).
 */
export async function runMembershipRenewals(tx: Tx, tenantId: string, now = new Date()) {
  const today = await businessDateFor(tx, now)
  const ended = await tx
    .select()
    .from(clientMemberships)
    .where(
      and(
        eq(clientMemberships.tenantId, tenantId),
        inArray(clientMemberships.status, [...LIVE_MEMBERSHIP]),
        lt(clientMemberships.currentPeriodEnd, today),
      ),
    )
  for (const m of ended) {
    await tx
      .update(clientMemberships)
      .set({ status: 'expired', remainingValueAed: '0.00' })
      .where(eq(clientMemberships.id, m.id))
    const value = Number(m.remainingValueAed)
    if (value > 0)
      await postRedemption(tx, {
        tenantId,
        sourceId: m.id,
        date: today,
        valueAed: value,
        sourceType: 'membership_expiry',
        memo: `Membership period ended: ${m.name}`,
      })
  }

  // Not renewed yet = no later period of the same plan for the client.
  const renewed = sql`exists (select 1 from client_memberships n where n.client_id = ${clientMemberships.clientId}
    and n.plan_id = ${clientMemberships.planId} and n.current_period_start > ${clientMemberships.currentPeriodEnd}
    and n.status in ('active', 'due'))`
  const due = await tx
    .select({ m: clientMemberships, client: clients })
    .from(clientMemberships)
    .innerJoin(clients, eq(clients.id, clientMemberships.clientId))
    .where(
      and(
        eq(clientMemberships.tenantId, tenantId),
        eq(clientMemberships.status, 'active'),
        gte(clientMemberships.currentPeriodEnd, today),
        lte(clientMemberships.currentPeriodEnd, addDays(today, RENEWAL_NOTICE_DAYS)),
        sql`not ${renewed}`,
      ),
    )
  let queued = 0
  if (due.length) {
    const [spa] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId))
    const [branch] = await tx
      .select({ id: branches.id })
      .from(branches)
      .orderBy(desc(branches.isDefault))
      .limit(1)
    for (const { m, client } of due) {
      await tx.update(clientMemberships).set({ status: 'due' }).where(eq(clientMemberships.id, m.id))
      if (!client.phoneE164 || client.marketingOptOutAt || client.blocklisted) continue
      const lang = client.language === 'ar' ? 'ar' : 'en'
      await tx.insert(outbox).values({
        tenantId,
        branchId: branch?.id ?? null,
        clientId: client.id,
        kind: 'membership_renewal',
        phoneE164: client.phoneE164,
        text: renderTemplate(await templateFor(tx, 'membership_renewal', lang), {
          first_name: client.name.split(' ')[0] ?? client.name,
          name: client.name,
          spa: spa?.name ?? '',
          service: m.name,
          day: fmtDay(new Date(`${m.currentPeriodEnd}T08:00:00Z`), lang),
        }),
      })
      queued++
    }
  }
  return { expired: ended.length, due: due.length, queued }
}
