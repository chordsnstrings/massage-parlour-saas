// Contact enquiries (PLAN §18.4, owner 2026-10-09): the marketing Contact form stores one row per message; the
// platform owner works them in the console (new → contacted → closed + an internal note). Platform role only
// (`platformDb()`; the table is invisible to spa roles); permission checks, audit and email stay in the caller.
import { toE164 } from '@spa/core'
import { contactEnquiries, type DbOrTx } from '@spa/db'
import { and, desc, eq, ilike, or, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'

export const ENQUIRY_STATUSES = ['new', 'contacted', 'closed'] as const
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number]
export type EnquiryFilter = EnquiryStatus | 'all'
export type ContactEnquiry = typeof contactEnquiries.$inferSelect

/** Per IP: 5 an hour, 20 a day (web: `withinIpLimit('enquiry', ENQUIRY_LIMITS)`). */
export const ENQUIRY_LIMITS = [
  [5, 3600],
  [20, 86_400],
] as const
export const ENQUIRY_MESSAGE_MAX = 2000

const text = (required: string, max: number, tooLong: string) =>
  z.string({ error: required }).trim().min(1, required).max(max, tooLong)

/** What the Contact form sends. Messages are English (the marketing site is English only). */
export const enquirySchema = z.object({
  name: text('Enter your name', 80, 'Keep your name under 80 characters'),
  phone: z
    .string({ error: 'Enter your phone number' })
    .trim()
    .min(1, 'Enter your phone number')
    .transform((v) => {
      const e164 = toE164(v)
      return e164 ? `+${e164}` : null
    })
    .refine(
      (v): v is string => v !== null,
      'Enter a UAE mobile (05…) or an international number with its country code (+44…)',
    ),
  email: z
    .string({ error: 'Enter your email address' })
    .trim()
    .toLowerCase()
    .max(254, 'Enter a valid email address')
    .pipe(z.email('Enter a valid email address')),
  spaName: text('Enter your spa’s name', 120, 'Keep the spa name under 120 characters'),
  message: text(
    'Tell us what you need',
    ENQUIRY_MESSAGE_MAX,
    `Keep your message under ${ENQUIRY_MESSAGE_MAX} characters`,
  ),
})
export type EnquiryInput = z.input<typeof enquirySchema>

/**
 * Stores one enquiry (status `new`). Validates again (`ZodError` when invalid; the web action shows field errors
 * first). Spam checks (honeypot, per-IP limit) run before this in the caller.
 */
export async function submitEnquiry(
  db: DbOrTx,
  input: EnquiryInput,
  meta: { ipHash?: string | null; userAgent?: string | null } = {},
) {
  const d = enquirySchema.parse(input)
  const [row] = await db
    .insert(contactEnquiries)
    .values({
      ...d,
      ipHash: meta.ipHash ?? null,
      userAgent: meta.userAgent?.slice(0, 300) || null,
    })
    .returning()
  return row!
}

/** `%q%` for ILIKE, with the wildcards in `q` taken literally. */
const contains = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** Newest first; `q` matches name, email or spa name (and the phone, when it has 4+ digits). */
export async function listEnquiries(
  db: DbOrTx,
  opts: { status?: EnquiryFilter; q?: string; limit?: number } = {},
) {
  const q = opts.q?.trim().slice(0, 100)
  const digits = q?.replace(/\D/g, '') ?? ''
  const conds: (SQL | undefined)[] = [
    opts.status && opts.status !== 'all' ? eq(contactEnquiries.status, opts.status) : undefined,
    q
      ? or(
          ilike(contactEnquiries.name, contains(q)),
          ilike(contactEnquiries.email, contains(q)),
          ilike(contactEnquiries.spaName, contains(q)),
          digits.length >= 4 ? ilike(contactEnquiries.phone, contains(digits)) : undefined,
        )
      : undefined,
  ]
  return db
    .select()
    .from(contactEnquiries)
    .where(and(...conds))
    .orderBy(desc(contactEnquiries.createdAt), desc(contactEnquiries.id))
    .limit(opts.limit ?? 300)
}

export async function enquiryCounts(db: DbOrTx) {
  const [row] = await db
    .select({
      new: sql<number>`count(*) filter (where ${contactEnquiries.status} = 'new')::int`,
      contacted: sql<number>`count(*) filter (where ${contactEnquiries.status} = 'contacted')::int`,
      closed: sql<number>`count(*) filter (where ${contactEnquiries.status} = 'closed')::int`,
      all: sql<number>`count(*)::int`,
    })
    .from(contactEnquiries)
  return row ?? { new: 0, contacted: 0, closed: 0, all: 0 }
}

/** Console nav badge. */
export async function newEnquiryCount(db: DbOrTx) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contactEnquiries)
    .where(eq(contactEnquiries.status, 'new'))
  return row?.n ?? 0
}

export async function getEnquiry(db: DbOrTx, id: string) {
  const [row] = await db.select().from(contactEnquiries).where(eq(contactEnquiries.id, id))
  return row ?? null
}

/**
 * Sets the status and the internal note (empty → none). Stamps `handled_by/at` when either changes. Returns
 * `null` when the enquiry doesn't exist; `changed` lists what changed (the caller audits it).
 */
export async function updateEnquiry(
  db: DbOrTx,
  input: { id: string; status: EnquiryStatus; note: string | null; actorId: string },
) {
  const note = input.note?.trim() || null
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(contactEnquiries)
      .where(eq(contactEnquiries.id, input.id))
      .for('update')
    if (!before) return null
    const changed = [
      ...(before.status !== input.status ? (['status'] as const) : []),
      ...(before.adminNote !== note ? (['note'] as const) : []),
    ]
    if (!changed.length) return { before, after: before, changed }
    const [after] = await tx
      .update(contactEnquiries)
      .set({
        status: input.status,
        adminNote: note,
        handledBy: input.actorId,
        handledAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(contactEnquiries.id, input.id))
      .returning()
    return { before, after: after!, changed }
  })
}
