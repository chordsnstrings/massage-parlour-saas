// Receipt OCR post-processing (P3): the vision model's loose JSON → validated expense-form fields.
// Never trust the model's formatting: amounts arrive as "AED 1,234.50", dates as "06/10/2026", TRNs with spaces.
import { EXPENSE_CODES } from './ledger'

export type ReceiptFields = {
  vendor: string | null
  /** YYYY-MM-DD */
  date: string | null
  totalAed: number | null
  vatAed: number | null
  /** UAE Tax Registration Number, 15 digits. */
  trn: string | null
  currency: string | null
  /** Expense account code (EXPENSE_CODES), e.g. '6200'. */
  category: string | null
}

export function parseReceiptAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null
  if (typeof v !== 'string') return null
  let s = v.replace(/[^\d.,-]/g, '')
  if (!/\d/.test(s)) return null
  // "1.234,50" (comma decimals) vs "1,234.50" / "1,234" (comma thousands).
  if (/,\d{2}$/.test(s) && !/\.\d{2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const iso = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return date.toISOString().slice(0, 10)
}

/** YYYY-MM-DD, DD/MM/YYYY (UAE order), DD-MM-YY, "6 Oct 2026", "Oct 6, 2026". Rejects dates after `today`. */
export function parseReceiptDate(v: unknown, today: string): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  const month = (name: string) => MONTHS.indexOf(name) + 1
  const year = (y: string) => (+y < 100 ? 2000 + +y : +y)
  const patterns: [RegExp, (m: string[]) => string | null][] = [
    [/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/, (m) => iso(+m[1]!, +m[2]!, +m[3]!)],
    [/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/, (m) => iso(year(m[3]!), +m[2]!, +m[1]!)],
    [/^(\d{1,2})\s*([a-z]{3})[a-z]*\.?,?\s*(\d{4})/, (m) => iso(+m[3]!, month(m[2]!), +m[1]!)],
    [/^([a-z]{3})[a-z]*\.?\s*(\d{1,2}),?\s*(\d{4})/, (m) => iso(+m[3]!, month(m[1]!), +m[2]!)],
  ]
  for (const [re, build] of patterns) {
    const m = s.match(re)
    if (!m) continue
    const out = build(m)
    return out && out >= '2000-01-01' && out <= today ? out : null
  }
  return null
}

export function normalizeTrn(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const digits = String(v).replace(/\D/g, '')
  return digits.length === 15 ? digits : null
}

const KEYWORDS: [RegExp, string][] = [
  [/\b(dewa|sewa|fewa|addc|aadc|etisalat|e&|\bdu\b|internet|electric|water|utilit)/i, '6200'],
  [/\b(rent|ejari|tenancy|landlord|properties|real estate)/i, '6100'],
  [
    /\b(visa|immigration|amer|tasheel|tawjeeh|mohre|gdrfa|labou?r|licen[cs]e|ded|municipality|permit)/i,
    '6500',
  ],
  [/\b(instagram|facebook|meta|google ads|marketing|advert|print)/i, '6300'],
  [/\b(taxi|careem|uber|rta|salik|transport|accommodation|fuel|adnoc|enoc|eppco)/i, '6400'],
  [/\b(repair|maintenance|plumb|electrician|ac service|cleaning)/i, '6600'],
  [/\b(bank|card fee|charges|network international|merchant)/i, '6700'],
  [/\b(software|subscription|saas|app store|microsoft|adobe)/i, '6800'],
]

/** A model-suggested category (code, name or free text) or the vendor's name → an expense code. */
export function matchCategory(category: unknown, vendor?: string | null): string | null {
  const text = typeof category === 'string' ? category.trim() : ''
  if (text) {
    const byCode = EXPENSE_CODES.find((a) => a.code === text.match(/\d{4}/)?.[0])
    if (byCode) return byCode.code
    const byName = EXPENSE_CODES.find((a) => a.name.toLowerCase() === text.toLowerCase())
    if (byName) return byName.code
  }
  for (const source of [text, vendor ?? '']) {
    const hit = KEYWORDS.find(([re]) => re.test(source))
    if (hit) return hit[1]
  }
  return null
}

const clean = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null

/** Validates and normalises the model's receipt JSON. Returns null when it isn't an object at all. */
export function normalizeReceipt(raw: unknown, today: string): ReceiptFields | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const vendor = clean(r.vendor, 120)
  const totalAed = parseReceiptAmount(r.total)
  let vatAed = parseReceiptAmount(r.vat)
  // VAT can't exceed the VAT-inclusive total (5% of it is 1/21); drop impossible readings.
  if (vatAed !== null && totalAed !== null && vatAed > totalAed / 2) vatAed = null
  const currency = clean(r.currency, 8)?.toUpperCase() ?? null
  return {
    vendor,
    date: parseReceiptDate(r.date, today),
    totalAed: totalAed === 0 ? null : totalAed,
    vatAed,
    trn: normalizeTrn(r.trn),
    currency,
    category: matchCategory(r.category, vendor),
  }
}
