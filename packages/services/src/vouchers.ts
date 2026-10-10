// F15 printable gift-card vouchers (QR → public check page) and F16 partner booking links (posters).
// Gift cards themselves (sale, redemption, ledger 2100) live in loyalty.ts / sales.ts; nothing here moves money.
import { newPartnerCode, PARTNER_CODE, VOUCHER_TOKEN } from '@spa/core'
import { bookingPartners, bookings, clients, giftCards, services, type Tx } from '@spa/db'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { DomainError, pgCode } from './errors'

export type VoucherStatus = 'valid' | 'used' | 'expired' | 'void'

/** What a voucher shows publicly: validity + balance, never who bought it or who it is for. */
export const voucherStatus = (
  card: { status: string; balanceAed: string; expiresAt: Date | null },
  now = new Date(),
): VoucherStatus =>
  card.status === 'void'
    ? 'void'
    : card.status === 'redeemed' || Number(card.balanceAed) <= 0
      ? 'used'
      : card.status === 'expired' || (card.expiresAt && card.expiresAt < now)
        ? 'expired'
        : 'valid'

/**
 * Public voucher check (`/voucher/{token}` on the spa's site, run inside the spa's `withTenant`). Returns only what
 * the holder may see: status, value, balance, expiry, the treatment and the code's last 4 characters. Null when
 * the token is malformed or unknown.
 */
export async function voucherCheck(tx: Tx, token: string, now = new Date()) {
  if (!VOUCHER_TOKEN.test(token)) return null
  const [row] = await tx
    .select({
      status: giftCards.status,
      initialAed: giftCards.initialAed,
      balanceAed: giftCards.balanceAed,
      expiresAt: giftCards.expiresAt,
      code: giftCards.code,
      treatment: services.name,
    })
    .from(giftCards)
    .leftJoin(services, eq(services.id, giftCards.voucherServiceId))
    .where(eq(giftCards.checkToken, token))
  if (!row) return null
  return {
    status: voucherStatus(row, now),
    initialAed: row.initialAed,
    balanceAed: row.balanceAed,
    expiresAt: row.expiresAt,
    codeHint: row.code.slice(-4),
    treatment: row.treatment ?? null,
  }
}

/** A gift card with what its voucher shows (dashboard; run inside `withTenant`). */
export async function voucherDetails(tx: Tx, id: string) {
  const [row] = await tx
    .select({
      card: giftCards,
      treatment: services.name,
      purchaser: { id: clients.id, name: clients.name, phone: clients.phoneE164, language: clients.language },
    })
    .from(giftCards)
    .leftJoin(services, eq(services.id, giftCards.voucherServiceId))
    .leftJoin(clients, eq(clients.id, giftCards.purchaserClientId))
    .where(eq(giftCards.id, id))
  if (!row) return null
  return { ...row, purchaser: row.purchaser?.id ? row.purchaser : null }
}

/** Edits what the voucher shows (recipient, message, treatment). Value, balance and expiry never change here. */
export async function updateVoucher(
  tx: Tx,
  id: string,
  v: {
    recipientName: string | null
    recipientPhone: string | null
    message: string | null
    voucherServiceId: string | null
  },
) {
  if (v.voucherServiceId) {
    const [svc] = await tx.select({ id: services.id }).from(services).where(eq(services.id, v.voucherServiceId))
    if (!svc) throw new DomainError('Treatment not found', 'not_found')
  }
  const [card] = await tx.update(giftCards).set(v).where(eq(giftCards.id, id)).returning()
  if (!card) throw new DomainError('Gift card not found', 'not_found')
  return card
}

/** The WhatsApp text that shares a voucher (client language: EN or AR). */
export function voucherShareText(
  lang: 'en' | 'ar',
  v: {
    spa: string
    code: string
    value: string
    treatment?: string | null
    expires?: string | null
    recipient?: string | null
    checkUrl: string
  },
) {
  const what = v.treatment || v.value
  if (lang === 'ar')
    return [
      v.recipient ? `مرحباً ${v.recipient}،` : 'مرحباً،',
      `إليك قسيمة هدية من ${v.spa}: ${what}.`,
      `الرمز: ${v.code}${v.expires ? ` · صالحة حتى ${v.expires}` : ''}`,
      `تحقق من الرصيد: ${v.checkUrl}`,
    ].join('\n')
  return [
    v.recipient ? `Hi ${v.recipient},` : 'Hi,',
    `here is your gift voucher from ${v.spa}: ${what}.`,
    `Code: ${v.code}${v.expires ? ` · valid until ${v.expires}` : ''}`,
    `Check the balance: ${v.checkUrl}`,
  ].join('\n')
}

// --------------------------------------------------------------------------- F16 partners

/** Adds a partner with a fresh link code (retried on the rare clash). */
export async function createPartner(tx: Tx, tenantId: string, name: string, createdBy?: string | null) {
  const clean = name.trim()
  if (clean.length < 2) throw new DomainError('Enter the partner name')
  for (let i = 0; i < 5; i++) {
    try {
      const [row] = await tx.transaction((sp) =>
        sp
          .insert(bookingPartners)
          .values({ tenantId, name: clean, code: newPartnerCode(), createdBy: createdBy ?? null })
          .returning(),
      )
      return row!
    } catch (e) {
      if (pgCode(e) !== '23505') throw e
    }
  }
  throw new DomainError('Could not create a link code, please try again')
}

export async function setPartnerActive(tx: Tx, id: string, active: boolean) {
  const [row] = await tx.update(bookingPartners).set({ active }).where(eq(bookingPartners.id, id)).returning()
  if (!row) throw new DomainError('Partner not found', 'not_found')
  return row
}

/** The active partner behind a booking link's `?partner=` code (null for unknown / paused / malformed codes). */
export async function partnerByCode(tx: Tx, code: string | null | undefined) {
  const c = code?.trim().toLowerCase()
  if (!c || !PARTNER_CODE.test(c)) return null
  const [row] = await tx
    .select({ id: bookingPartners.id, name: bookingPartners.name })
    .from(bookingPartners)
    .where(and(eq(bookingPartners.code, c), eq(bookingPartners.active, true)))
  return row ?? null
}

/**
 * Partners with their online bookings (all time, last 30 days, completed, latest), plus the spa's own reception
 * poster (QR bookings without a partner) as `reception`.
 */
export async function partnerBookingStats(tx: Tx, now = new Date()) {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString()
  const counts = {
    total: sql<number>`count(${bookings.id})::int`,
    last30: sql<number>`count(${bookings.id}) filter (where ${bookings.createdAt} >= ${since}::timestamptz)::int`,
    completed: sql<number>`count(${bookings.id}) filter (where ${bookings.status} = 'completed')::int`,
    latest: sql<Date | null>`max(${bookings.createdAt})`,
  }
  const partners = await tx
    .select({
      id: bookingPartners.id,
      name: bookingPartners.name,
      code: bookingPartners.code,
      active: bookingPartners.active,
      createdAt: bookingPartners.createdAt,
      ...counts,
    })
    .from(bookingPartners)
    .leftJoin(bookings, and(eq(bookings.partnerId, bookingPartners.id), sql`${bookings.status} <> 'cancelled'`))
    .groupBy(bookingPartners.id)
    .orderBy(desc(bookingPartners.active), asc(bookingPartners.createdAt))
  const [reception] = await tx
    .select(counts)
    .from(bookings)
    .where(
      and(
        eq(bookings.attribution, 'qr'),
        isNull(bookings.partnerId),
        sql`${bookings.status} <> 'cancelled'`,
      ),
    )
  return {
    partners: partners.map((p) => ({ ...p, latest: p.latest ? new Date(p.latest) : null })),
    reception: {
      total: reception?.total ?? 0,
      last30: reception?.last30 ?? 0,
      completed: reception?.completed ?? 0,
      latest: reception?.latest ? new Date(reception.latest) : null,
    },
  }
}
