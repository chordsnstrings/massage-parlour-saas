// Signed intake / waiver records (F27). The PDF itself is rendered by the server-only subpath
// `@spa/services/intake-pdf` (pdfkit); this module holds what the main entry needs: the record hash, file lookups
// for erase / export, and the export list.
import { createHash } from 'node:crypto'
import { clients, type IntakeField, intakeSubmissions, type Tx } from '@spa/db'
import { and, asc, eq, isNotNull } from 'drizzle-orm'
import { deleteFile } from './storage'

/** `stored_files.purpose` of a signed intake PDF (private; /files serves it to members with clients.view). */
export const INTAKE_PDF_PURPOSE = 'intake_pdf'

export type IntakeRecord = {
  id: string
  tenantId: string
  clientId: string
  templateId: string | null
  templateVersion: number
  answers: Record<string, string>
  waiverText: string
  signature: string
  signedAt: Date
  ip: string | null
}

const sortKeys = (o: Record<string, string>) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

/**
 * SHA-256 (hex) of a signed intake: ids, template version, answers (sorted keys), waiver text, signature, signing
 * time and IP as canonical JSON. Stored at signing and printed on the PDF, so a changed row no longer matches.
 */
export function intakeContentHash(r: IntakeRecord) {
  const canonical = JSON.stringify([
    'intake.v1',
    r.id,
    r.tenantId,
    r.clientId,
    r.templateId,
    r.templateVersion,
    sortKeys(r.answers),
    r.waiverText,
    r.signature,
    r.signedAt.toISOString(),
    r.ip,
  ])
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

export const sha256Hex = (bytes: Buffer | Uint8Array) => createHash('sha256').update(bytes).digest('hex')

const humanize = (key: string) => key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
const ANSWER_AR: Record<string, string> = { yes: 'نعم', no: 'لا' }

/**
 * Question + answer rows of a submission in the form's language: the (versioned) template's questions in order,
 * then answers whose question is no longer on the template. yes/no → Yes/No (نعم/لا); empty → '—'.
 */
export function intakeAnswerRows(
  fields: IntakeField[] | null,
  answers: Record<string, string>,
  lang: 'en' | 'ar',
) {
  const show = (v: string | undefined) => (v ? (lang === 'ar' ? (ANSWER_AR[v] ?? v) : humanize(v)) : '—')
  const rows = (fields ?? []).map((f) => ({
    key: f.key,
    label: (lang === 'ar' && f.label.ar) || f.label.en,
    value: show(answers[f.key]),
  }))
  const known = new Set(rows.map((r) => r.key))
  for (const [key, value] of Object.entries(answers))
    if (!key.startsWith('_') && !known.has(key)) rows.push({ key, label: humanize(key), value: show(value) })
  return rows
}

/** Deletes the PDFs of one client's intake submissions (G12 erase, before the submission rows go). */
export async function deleteClientIntakePdfs(tx: Tx, clientId: string) {
  const rows = await tx
    .select({ fileId: intakeSubmissions.pdfFileId })
    .from(intakeSubmissions)
    .where(and(eq(intakeSubmissions.clientId, clientId), isNotNull(intakeSubmissions.pdfFileId)))
  let n = 0
  for (const r of rows) if (r.fileId && (await deleteFile(tx, r.fileId))) n++
  return n
}

/** Every intake submission that has a PDF, oldest first (data export zip). */
export async function intakePdfExportList(tx: Tx) {
  return tx
    .select({
      id: intakeSubmissions.id,
      fileId: intakeSubmissions.pdfFileId,
      signedAt: intakeSubmissions.signedAt,
      clientName: clients.name,
    })
    .from(intakeSubmissions)
    .innerJoin(clients, eq(clients.id, intakeSubmissions.clientId))
    .where(isNotNull(intakeSubmissions.pdfFileId))
    .orderBy(asc(intakeSubmissions.signedAt), asc(intakeSubmissions.id))
}

/** Download name of a signed intake PDF: `intake-<client>-<YYYY-MM-DD>-<ref>.pdf` (ASCII-safe). */
export function intakePdfFilename(clientName: string, signedAt: Date, id: string) {
  const day = new Date(signedAt.getTime() + 4 * 3600_000).toISOString().slice(0, 10)
  const who =
    clientName
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 40) || 'client'
  return `intake-${who}-${day}-${id.slice(0, 8)}.pdf`
}
