// R32 daily sales sheet, web side: the closer's name (platform data) and the stored PDF kept with a close.
// Rendering never blocks a close or a correction: a failure is logged and the close page offers "Create PDF".
import { reportError } from '@spa/core'
import { dayCloses, platformDb, user, withTenant } from '@spa/db'
import { generateDaySheetPdf } from '@spa/services/day-sheet-pdf'
import { and, eq } from 'drizzle-orm'
import { getLocale } from '@/i18n/server'

/** Display name of the member who closed a day (user names live on the platform side). */
export async function closerName(userId: string | null | undefined) {
  if (!userId) return null
  const [u] = await platformDb().select({ name: user.name }).from(user).where(eq(user.id, userId))
  return u?.name ?? null
}

/** The viewer's dashboard language as a PDF language (the spa dashboard is EN + TH). */
export const pdfLang = async (): Promise<'en' | 'th'> => ((await getLocale()) === 'th' ? 'th' : 'en')

/**
 * Renders and stores the day-sheet PDF of a close (replacing the previous file) in its own transaction.
 * Returns the file id, or null when rendering failed (logged as `[day-sheet]`; the caller does not fail).
 */
export async function storeDaySheetPdf(
  tenantId: string,
  dayCloseId: string,
  o: { createdBy?: string | null; lang?: 'en' | 'th' },
): Promise<string | null> {
  try {
    const [close] = await withTenant(tenantId, (tx) =>
      tx.select({ closedBy: dayCloses.closedBy }).from(dayCloses).where(eq(dayCloses.id, dayCloseId)),
    )
    if (!close) return null
    const closedByName = await closerName(close.closedBy)
    const lang = o.lang ?? (await pdfLang())
    const r = await withTenant(tenantId, (tx) =>
      generateDaySheetPdf(tx, dayCloseId, { lang, closedByName, createdBy: o.createdBy ?? null }),
    )
    return r.fileId
  } catch (err) {
    console.error('[day-sheet] pdf failed', err)
    await reportError(process.env.SENTRY_DSN, err, { source: 'web', tags: { action: 'day_sheet_pdf' } })
    return null
  }
}

/** The close row of a branch business day, if the day is closed. */
export async function dayCloseId(tenantId: string, branchId: string, date: string) {
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: dayCloses.id })
      .from(dayCloses)
      .where(and(eq(dayCloses.branchId, branchId), eq(dayCloses.businessDate, date))),
  )
  return row?.id ?? null
}
