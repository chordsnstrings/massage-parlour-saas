// F15 enquiry form: leads from a spa's website (EnquiryForm block) → the spa's dashboard (Inbox → Enquiries), answered
// by WhatsApp click-to-send (never emailed). Callers run these inside withTenant(); bot check, rate limit,
// permission and audit stay in the caller.
import { toE164 } from '@spa/core'
import { siteEnquiries, type Tx } from '@spa/db'
import { and, desc, eq, ilike, or, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'

export const SITE_ENQUIRY_STATUSES = ['new', 'replied', 'closed'] as const
export type SiteEnquiryStatus = (typeof SITE_ENQUIRY_STATUSES)[number]
export type SiteEnquiryFilter = SiteEnquiryStatus | 'all'
export type SiteEnquiry = typeof siteEnquiries.$inferSelect

/** Per visitor IP across all spa sites: 5 an hour, 20 a day (web: `withinIpLimit('site-enquiry', …)`). */
export const SITE_ENQUIRY_LIMITS = [
  [5, 3600],
  [20, 86_400],
] as const
export const SITE_ENQUIRY_MESSAGE_MAX = 1500
export const SITE_ENQUIRY_PAGE_SIZE = 50

const BIDI = /[\u202A-\u202E\u2066-\u2069]/gu
const oneLine = (v: string) =>
  v
    .replace(BIDI, '')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/\s{2,}/g, ' ')
const multiLine = (v: string) =>
  v
    .replace(BIDI, '')
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    .replace(/(?![\n\t])\p{Cc}/gu, '')
    .replace(/\n{3,}/g, '\n\n')

/**
 * What the website form sends. Messages are error codes (`required:name`, `long:name`, `phone`, …); the site turns
 * them into the visitor's language (EN/AR).
 */
export const siteEnquirySchema = z.object({
  name: z
    .string({ error: 'required:name' })
    .overwrite(oneLine)
    .trim()
    .min(1, 'required:name')
    .max(80, 'long:name'),
  phone: z
    .string({ error: 'required:phone' })
    .trim()
    .min(1, 'required:phone')
    .max(40, 'phone')
    .transform((v) => {
      const e164 = toE164(v)
      return e164 ? `+${e164}` : null
    })
    .refine((v): v is string => v !== null, 'phone'),
  message: z
    .string({ error: 'required:message' })
    .overwrite(multiLine)
    .trim()
    .min(1, 'required:message')
    .max(SITE_ENQUIRY_MESSAGE_MAX, 'long:message'),
  locale: z.enum(['en', 'ar']).catch('en'),
  page: z
    .string()
    .max(80)
    .regex(/^$|^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/)
    .catch(''),
})
export type SiteEnquiryInput = z.output<typeof siteEnquirySchema>

export async function submitSiteEnquiry(
  tx: Tx,
  tenantId: string,
  input: SiteEnquiryInput,
  meta: { ipHash: string | null },
): Promise<SiteEnquiry> {
  const [row] = await tx
    .insert(siteEnquiries)
    .values({ tenantId, ...input, ipHash: meta.ipHash })
    .returning()
  return row!
}

export type SiteEnquiryList = {
  rows: SiteEnquiry[]
  total: number
  counts: Record<SiteEnquiryStatus, number>
}

/** Newest first; `q` matches name, phone digits or message. */
export async function listSiteEnquiries(
  tx: Tx,
  opts: { status?: SiteEnquiryFilter; q?: string; limit?: number; offset?: number } = {},
): Promise<SiteEnquiryList> {
  const where: SQL[] = []
  if (opts.status && opts.status !== 'all') where.push(eq(siteEnquiries.status, opts.status))
  const q = opts.q?.trim().slice(0, 80)
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const digits = q.replace(/\D/g, '')
    const match = or(
      ilike(siteEnquiries.name, like),
      ilike(siteEnquiries.message, like),
      digits.length >= 3 ? ilike(siteEnquiries.phone, `%${digits}%`) : undefined,
    )
    if (match) where.push(match)
  }
  const cond = where.length ? and(...where) : undefined
  const rows = await tx
    .select()
    .from(siteEnquiries)
    .where(cond)
    .orderBy(desc(siteEnquiries.createdAt))
    .limit(Math.min(opts.limit ?? SITE_ENQUIRY_PAGE_SIZE, 200))
    .offset(opts.offset ?? 0)
  const [total] = await tx.select({ n: sql<number>`count(*)::int` }).from(siteEnquiries).where(cond)
  const byStatus = await tx
    .select({ status: siteEnquiries.status, n: sql<number>`count(*)::int` })
    .from(siteEnquiries)
    .groupBy(siteEnquiries.status)
  const counts = { new: 0, replied: 0, closed: 0 }
  for (const r of byStatus) counts[r.status] = r.n
  return { rows, total: total?.n ?? 0, counts }
}

export async function getSiteEnquiry(tx: Tx, id: string): Promise<SiteEnquiry | null> {
  const [row] = await tx.select().from(siteEnquiries).where(eq(siteEnquiries.id, id)).limit(1)
  return row ?? null
}

/** Moves an enquiry (new → replied → closed, or back to new); returns the previous status, null when not found. */
export async function setSiteEnquiryStatus(
  tx: Tx,
  id: string,
  status: SiteEnquiryStatus,
  userId: string | null,
): Promise<{ from: SiteEnquiryStatus; row: SiteEnquiry } | null> {
  const before = await getSiteEnquiry(tx, id)
  if (!before) return null
  const [row] = await tx
    .update(siteEnquiries)
    .set({ status, handledBy: userId, handledAt: new Date(), updatedAt: new Date() })
    .where(eq(siteEnquiries.id, id))
    .returning()
  return { from: before.status, row: row! }
}

/** First words of the spa's WhatsApp reply, in the language the visitor wrote in (the staff member adds the rest). */
export function siteEnquiryReplyText(e: { name: string; locale: string }, spaName: string) {
  const first = e.name.trim().split(/\s+/)[0] ?? ''
  return e.locale === 'ar'
    ? `مرحبًا ${first}، شكرًا لرسالتك إلى ${spaName}. `
    : `Hi ${first}, thank you for your message to ${spaName}. `
}
