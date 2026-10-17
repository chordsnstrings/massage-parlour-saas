// R32 daily sales sheet + booking order helpers (pure; owner 2026-10-14, PLAN §14.8 R32).

export const PHONE_LINES = [1, 2, 3, 4] as const
export const BOOKING_CLIENT_TYPES = ['regular', 'new'] as const
export type PhoneLine = (typeof PHONE_LINES)[number]
export type BookingClientType = (typeof BOOKING_CLIENT_TYPES)[number]

export const isPhoneLine = (n: unknown): n is PhoneLine => PHONE_LINES.includes(n as PhoneLine)

/** Lines with a number typed in Settings: [{ line: 1, number: '04 …' }, …] (for the New booking picker). */
export function phoneLineOptions(s: { phoneLines?: string[] } | null | undefined): {
  line: PhoneLine
  number: string | null
}[] {
  const lines = s?.phoneLines ?? []
  return PHONE_LINES.flatMap((line) => {
    const number = (lines[line - 1] ?? '').trim()
    return number ? [{ line, number }] : []
  })
}

/** True when at least one phone line has a number (then a phone booking must pick its line). */
export const phoneLinesConfigured = (s: { phoneLines?: string[] } | null | undefined) =>
  phoneLineOptions(s).length > 0

/** Optional day-sheet columns (missing: tips on, commission off). */
export function daySheetColumns(
  s: { daySheet?: { tips?: boolean; commission?: boolean } } | null | undefined,
): {
  tips: boolean
  commission: boolean
} {
  return { tips: s?.daySheet?.tips ?? true, commission: s?.daySheet?.commission ?? false }
}

/** "P2/R", "P/N" (phone without a line), "W", "W/N", "B", "B/R". phone → P{line}, walk_in → W, every other → B. */
export function sheetCode(b: {
  source: string
  phoneLine: number | null
  clientType: string | null
}): string {
  const base =
    b.source === 'phone'
      ? `P${isPhoneLine(b.phoneLine) ? b.phoneLine : ''}`
      : b.source === 'walk_in'
        ? 'W'
        : 'B'
  const type = b.clientType === 'regular' ? '/R' : b.clientType === 'new' ? '/N' : ''
  return base + type
}

/**
 * Q per row key (D9): own leads 0; every other row 1, 2, 3 … per therapist, in the given order (rows must already be
 * sorted by start). Rows without a therapist → null.
 */
export function turnNumbers(
  rows: { key: string; staffId: string | null; ownLead: boolean }[],
): Map<string, number | null> {
  const seen = new Map<string, number>()
  const out = new Map<string, number | null>()
  for (const r of rows) {
    if (!r.staffId) out.set(r.key, null)
    else if (r.ownLead) out.set(r.key, 0)
    else {
      const n = (seen.get(r.staffId) ?? 0) + 1
      seen.set(r.staffId, n)
      out.set(r.key, n)
    }
  }
  return out
}

/** Paper rule (fils in, fils out): sale = cash + card + other − expenses; card; cash − expenses. */
export function sheetTotals(f: { cash: number; card: number; other: number; expenses: number }): {
  totalSale: number
  totalCard: number
  totalCash: number
} {
  return {
    totalSale: f.cash + f.card + f.other - f.expenses,
    totalCard: f.card,
    totalCash: f.cash - f.expenses,
  }
}
