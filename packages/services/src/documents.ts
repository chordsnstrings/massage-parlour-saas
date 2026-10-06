// Staff and business document expiry tracker: visas, Emirates IDs, health cards, licences (PLAN §1.18).
// Dates are Dubai calendar dates ("YYYY-MM-DD"); a document is valid through its expiry date.
import { businessDateOf } from '@spa/core'
import { businessDocuments, staff, staffDocuments, type Tx } from '@spa/db'
import { asc, eq } from 'drizzle-orm'
import { IMAGE_TYPES } from './storage'

export const STAFF_DOCUMENT_TYPES = [
  { key: 'passport', label: 'Passport' },
  { key: 'visa', label: 'Visa / residence permit' },
  { key: 'emirates_id', label: 'Emirates ID' },
  { key: 'labour_card', label: 'Labour card / work permit' },
  { key: 'medical_fitness', label: 'Medical fitness certificate' },
  { key: 'health_card', label: 'Occupational / massage health card' },
  { key: 'training_certificate', label: 'Training certificate' },
] as const

export const BUSINESS_DOCUMENT_TYPES = [
  { key: 'trade_licence', label: 'Trade licence' },
  { key: 'municipality_permit', label: 'Municipality / DED permit' },
  { key: 'ejari', label: 'Ejari / tenancy contract' },
  { key: 'civil_defence', label: 'Civil defence certificate' },
  { key: 'insurance', label: 'Insurance policy' },
] as const

/** Scans and photos accepted for documents and receipts (stored privately, max 8 MB). */
export const SCAN_FILE_TYPES = [...IMAGE_TYPES, 'application/pdf'] as const
export const isScanType = (type: string) => (SCAN_FILE_TYPES as readonly string[]).includes(type)

/** Private file link served by the /files route (members of the file's tenant only). */
export const fileLink = (id: string) => `/files/${id}`
/** The stored-file id inside a `/files/{id}` link, if it is one. */
export const fileIdOf = (url: string | null | undefined) =>
  url?.match(/^\/files\/([0-9a-f-]{36})(?:[/?]|$)/i)?.[1] ?? null

const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  [...STAFF_DOCUMENT_TYPES, ...BUSINESS_DOCUMENT_TYPES].map((t) => [t.key, t.label]),
)
/** Known types map to their label; free-text types (older rows) show as typed. */
export const documentTypeLabel = (type: string) => TYPE_LABELS[type] ?? type

export type DocumentStatus = 'expired' | 'due30' | 'due60' | 'ok' | 'none'
export const DOCUMENT_STATUSES: DocumentStatus[] = ['expired', 'due30', 'due60', 'ok', 'none']

/** Days remaining (negative once expired). */
export function daysUntil(expiresOn: string, today: string) {
  return Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}

export function documentStatus(
  expiresOn: string | null | undefined,
  today: string,
): { status: DocumentStatus; days: number | null } {
  if (!expiresOn) return { status: 'none', days: null }
  const days = daysUntil(expiresOn, today)
  const status: DocumentStatus = days < 0 ? 'expired' : days <= 30 ? 'due30' : days <= 60 ? 'due60' : 'ok'
  return { status, days }
}

/** "Expired 3 days ago" / "Expires today" / "in 12 days". */
export function expiryPhrase(days: number | null) {
  if (days === null) return 'No expiry date'
  if (days < 0) return `Expired ${-days} day${days === -1 ? '' : 's'} ago`
  if (days === 0) return 'Expires today'
  if (days === 1) return 'Expires tomorrow'
  return `Expires in ${days} days`
}

/** Push reminders go out when this many days are left. */
export const REMINDER_DAYS = [60, 30, 7, 0] as const

/** Today's Dubai calendar date. */
export const dubaiToday = (now = new Date()) => businessDateOf(now, '00:00')

export type TrackedDocument = {
  id: string
  scope: 'staff' | 'business'
  type: string
  typeLabel: string
  number: string | null
  issuedOn: string | null
  expiresOn: string | null
  fileUrl: string | null
  notes: string | null
  staffId: string | null
  owner: string
  status: DocumentStatus
  days: number | null
}

/** Every document of the tenant (staff + business) with its status, soonest expiry first. */
export async function trackedDocuments(tx: Tx, today: string): Promise<TrackedDocument[]> {
  const staffRows = await tx
    .select({
      id: staffDocuments.id,
      type: staffDocuments.type,
      number: staffDocuments.number,
      issuedOn: staffDocuments.issuedOn,
      expiresOn: staffDocuments.expiresOn,
      fileUrl: staffDocuments.fileUrl,
      notes: staffDocuments.notes,
      staffId: staffDocuments.staffId,
      owner: staff.displayName,
    })
    .from(staffDocuments)
    .innerJoin(staff, eq(staff.id, staffDocuments.staffId))
    .orderBy(asc(staffDocuments.expiresOn))
  const bizRows = await tx.select().from(businessDocuments).orderBy(asc(businessDocuments.expiresOn))
  const docs: TrackedDocument[] = [
    ...staffRows.map((d) => ({ ...d, scope: 'staff' as const })),
    ...bizRows.map((d) => ({
      id: d.id,
      type: d.type,
      number: d.number,
      issuedOn: d.issuedOn,
      expiresOn: d.expiresOn,
      fileUrl: d.fileUrl,
      notes: d.notes,
      staffId: null,
      owner: 'Business',
      scope: 'business' as const,
    })),
  ].map((d) => ({ ...d, typeLabel: documentTypeLabel(d.type), ...documentStatus(d.expiresOn, today) }))
  // Undated documents last; otherwise by expiry (expired first).
  return docs.sort(
    (a, b) =>
      (a.expiresOn ? 0 : 1) - (b.expiresOn ? 0 : 1) ||
      String(a.expiresOn).localeCompare(String(b.expiresOn)) ||
      a.owner.localeCompare(b.owner),
  )
}

export type DocumentFilter = { staffId?: string | 'business'; status?: DocumentStatus }

export function filterDocuments(docs: TrackedDocument[], f: DocumentFilter) {
  return docs.filter(
    (d) =>
      (!f.status || d.status === f.status) &&
      (!f.staffId || (f.staffId === 'business' ? d.scope === 'business' : d.staffId === f.staffId)),
  )
}

export type DocumentSummary = Record<DocumentStatus, number> & {
  total: number
  /** Expired and due within 60 days, soonest first (max 5) — for dashboard widgets. */
  attention: TrackedDocument[]
}

export function summarizeDocuments(docs: TrackedDocument[]): DocumentSummary {
  const counts = { expired: 0, due30: 0, due60: 0, ok: 0, none: 0 }
  for (const d of docs) counts[d.status]++
  return {
    ...counts,
    total: docs.length,
    attention: docs.filter((d) => d.status !== 'ok' && d.status !== 'none').slice(0, 5),
  }
}

/** Dashboard-ready summary of the tenant's documents. */
export async function documentSummary(tx: Tx, now = new Date()) {
  return summarizeDocuments(await trackedDocuments(tx, dubaiToday(now)))
}

/** Documents with exactly 60, 30, 7 or 0 days left today (one reminder per milestone). */
export async function documentsDueForReminder(tx: Tx, now = new Date()) {
  const today = dubaiToday(now)
  const docs = await trackedDocuments(tx, today)
  const milestones = new Set<number>(REMINDER_DAYS)
  return docs.filter((d) => d.days !== null && milestones.has(d.days))
}

/** One push per tenant per day: a single document is named, several are summarised. */
export function reminderMessage(docs: TrackedDocument[]) {
  if (docs.length === 0) return null
  const line = (d: TrackedDocument) =>
    `${d.typeLabel}${d.scope === 'staff' ? ` — ${d.owner}` : ''}: ${expiryPhrase(d.days).toLowerCase()}`
  if (docs.length === 1) {
    const d = docs[0]!
    return {
      title: d.days === 0 ? 'A document expires today' : 'Document expiring soon',
      body: line(d),
    }
  }
  return {
    title: `${docs.length} documents need renewing`,
    body: docs
      .slice(0, 4)
      .map(line)
      .join('\n')
      .concat(docs.length > 4 ? `\n+${docs.length - 4} more` : ''),
  }
}
