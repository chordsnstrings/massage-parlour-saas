// CSV import/export helpers (pure): decoding, delimiter + date detection, column auto-mapping,
// row validation/normalisation and formula-safe CSV output. Parsing itself (papaparse) and zipping
// (fflate) happen in the web app; the database side lives in data-import.ts / data-export.ts.
import { toUaeE164 } from '@spa/core'

export const IMPORT_KINDS = ['clients', 'menu', 'products'] as const
export type ImportKind = (typeof IMPORT_KINDS)[number]
export const isImportKind = (v: string): v is ImportKind => (IMPORT_KINDS as readonly string[]).includes(v)

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
export const MAX_IMPORT_ROWS = 50_000
export const IMPORT_CHUNK = 500

export type ImportField = {
  key: string
  label: string
  required?: boolean
  /** Recognised so the column isn't mistaken for something else, but never stored. */
  ignored?: boolean
  hint?: string
  aliases: string[]
}

export const IMPORT_FIELDS: Record<ImportKind, ImportField[]> = {
  clients: [
    {
      key: 'name',
      label: 'Name',
      required: true,
      hint: 'Or map first + last name',
      aliases: [
        'name',
        'full name',
        'client',
        'client name',
        'customer',
        'customer name',
        'الاسم',
        'اسم العميل',
      ],
    },
    { key: 'firstName', label: 'First name', aliases: ['first name', 'firstname', 'given name', 'first'] },
    {
      key: 'lastName',
      label: 'Last name',
      aliases: ['last name', 'lastname', 'surname', 'family name', 'last'],
    },
    {
      key: 'phone',
      label: 'Mobile',
      hint: 'UAE mobile; used to find existing clients',
      aliases: [
        'mobile',
        'phone',
        'mobile number',
        'mobile phone',
        'phone number',
        'cell',
        'cell phone',
        'whatsapp',
        'whatsapp number',
        'telephone',
        'tel',
        'contact',
        'contact number',
        'الجوال',
        'الهاتف',
        'رقم الهاتف',
        'رقم الجوال',
      ],
    },
    {
      key: 'email',
      label: 'Email (not imported)',
      ignored: true,
      hint: 'Client messages go by WhatsApp only',
      aliases: ['email', 'e-mail', 'email address', 'البريد الإلكتروني'],
    },
    { key: 'gender', label: 'Gender', aliases: ['gender', 'sex', 'الجنس'] },
    {
      key: 'birthday',
      label: 'Birthday',
      aliases: ['birthday', 'date of birth', 'dob', 'birth date', 'birthdate', 'تاريخ الميلاد'],
    },
    { key: 'tags', label: 'Tags', aliases: ['tags', 'tag', 'labels', 'groups', 'segments', 'الوسوم'] },
    {
      key: 'notes',
      label: 'Notes',
      aliases: ['notes', 'note', 'comments', 'comment', 'client notes', 'ملاحظات'],
    },
    {
      key: 'language',
      label: 'Language',
      aliases: ['language', 'preferred language', 'lang', 'اللغة'],
    },
    {
      key: 'source',
      label: 'Source',
      aliases: ['source', 'referral source', 'how did you hear', 'lead source', 'المصدر'],
    },
  ],
  menu: [
    {
      key: 'category',
      label: 'Category',
      aliases: ['category', 'service category', 'menu group', 'group', 'الفئة', 'التصنيف'],
    },
    {
      key: 'nameEn',
      label: 'Service name (English)',
      required: true,
      aliases: [
        'service name (english)',
        'service name',
        'service',
        'treatment',
        'treatment name',
        'name',
        'name en',
        'name (en)',
        'english name',
      ],
    },
    {
      key: 'nameAr',
      label: 'Service name (Arabic)',
      aliases: [
        'service name (arabic)',
        'name ar',
        'name (ar)',
        'arabic name',
        'service name ar',
        'اسم الخدمة',
        'الاسم بالعربية',
      ],
    },
    {
      key: 'duration',
      label: 'Duration (min)',
      required: true,
      hint: '60, 90 min, 1h 30min or 1:30',
      aliases: ['duration (min)', 'duration', 'duration min', 'minutes', 'mins', 'length', 'time', 'المدة'],
    },
    {
      key: 'price',
      label: 'Price (AED)',
      required: true,
      hint: 'VAT-inclusive',
      aliases: ['price (aed)', 'price', 'price aed', 'retail price', 'amount', 'السعر'],
    },
    { key: 'description', label: 'Description', aliases: ['description', 'details', 'الوصف'] },
  ],
  products: [
    {
      key: 'name',
      label: 'Name',
      required: true,
      aliases: ['name', 'product', 'product name', 'item', 'item name', 'name en', 'اسم المنتج'],
    },
    { key: 'nameAr', label: 'Name (Arabic)', aliases: ['name ar', 'name (ar)', 'arabic name'] },
    {
      key: 'sku',
      label: 'SKU',
      hint: 'Used to find existing products',
      aliases: ['sku', 'code', 'product code', 'item code', 'barcode', 'ref', 'reference'],
    },
    {
      key: 'kind',
      label: 'Type',
      hint: 'retail or consumable',
      aliases: ['type', 'kind', 'product type', 'usage'],
    },
    { key: 'unit', label: 'Unit', aliases: ['unit', 'uom', 'unit of measure', 'measure'] },
    {
      key: 'cost',
      label: 'Cost (AED)',
      aliases: ['cost (aed)', 'cost', 'cost price', 'supply price', 'purchase price', 'unit cost'],
    },
    {
      key: 'price',
      label: 'Price (AED)',
      aliases: ['price (aed)', 'price', 'retail price', 'sale price', 'selling price'],
    },
    {
      key: 'stock',
      label: 'Stock',
      hint: 'Count on hand at your main branch',
      aliases: [
        'stock',
        'qty',
        'quantity',
        'stock on hand',
        'on hand',
        'current stock',
        'in stock',
        'stock qty',
      ],
    },
  ],
}

/** Example files offered as downloadable templates. */
export const IMPORT_TEMPLATES: Record<ImportKind, string[][]> = {
  clients: [
    ['Name', 'Mobile', 'Gender', 'Birthday', 'Tags', 'Notes', 'Language'],
    [
      'Fatima Al Mansoori',
      '050 123 4567',
      'female',
      '14/03/1990',
      'vip; regular',
      'Prefers medium pressure',
      'ar',
    ],
    ['Sara Khan', '+971 55 765 4321', 'female', '1988-11-02', '', '', 'en'],
  ],
  menu: [
    ['Category', 'Service name (English)', 'Service name (Arabic)', 'Duration (min)', 'Price (AED)'],
    ['Massage', 'Swedish massage', 'مساج سويدي', '60', '350'],
    ['Massage', 'Swedish massage', 'مساج سويدي', '90', '480'],
    ['Feet', 'Foot reflexology', 'ريفلكسولوجي القدم', '45', '220'],
  ],
  products: [
    ['Name', 'SKU', 'Type', 'Unit', 'Cost (AED)', 'Price (AED)', 'Stock'],
    ['Lavender massage oil 500 ml', 'OIL-LAV-500', 'consumable', 'ml', '45', '', '12'],
    ['Argan body lotion', 'LOT-ARG-250', 'retail', 'pcs', '38', '120', '20'],
  ],
}

// ---------------------------------------------------------------------------
// Decoding and delimiter detection
// ---------------------------------------------------------------------------

const hasUtf16Bom = (b: Uint8Array) => (b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)

/** Workbooks (.xlsx zip, legacy .xls) and other binary files that are not CSV text. */
export function isBinaryFile(bytes: Uint8Array): boolean {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b)
  if (starts(0x50, 0x4b, 0x03, 0x04) || starts(0xd0, 0xcf, 0x11, 0xe0)) return true
  return !hasUtf16Bom(bytes) && bytes.subarray(0, 8192).includes(0)
}

/**
 * Legacy (non-UTF-8) bytes: Arabic Windows-1256 when most high bytes sit next to another high byte
 * (Arabic words), otherwise Windows-1252, whose accented letters stand alone inside Latin words.
 */
const legacyEncoding = (bytes: Uint8Array) => {
  let high = 0
  let paired = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i]! < 0xc0) continue
    high++
    if ((bytes[i - 1] ?? 0) >= 0xc0 || (bytes[i + 1] ?? 0) >= 0xc0) paired++
  }
  return high >= 4 && paired / high > 0.6 ? 'windows-1256' : 'windows-1252'
}

/** File bytes → text: UTF-8 (BOM stripped), UTF-16 with BOM, or Windows-1256/1252 for legacy Excel exports. */
export function decodeCsvBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    text = new TextDecoder(legacyEncoding(bytes)).decode(bytes)
  }
  return text.replace(/^﻿/, '')
}

const countOutsideQuotes = (line: string, ch: string) => {
  let n = 0
  let quoted = false
  for (const c of line) {
    if (c === '"') quoted = !quoted
    else if (c === ch && !quoted) n++
  }
  return n
}

/** Excel's optional first line `sep=;` names the delimiter explicitly. */
export const SEP_LINE = /^sep=(.)\s*$/i

/** Picks the delimiter (comma, semicolon, tab or pipe) that splits the first lines most consistently. */
export function detectDelimiter(text: string): string {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim())
    .slice(0, 20)
  if (!lines.length) return ','
  const sep = SEP_LINE.exec(lines[0]!)
  if (sep) return sep[1]!
  let best = ','
  let bestScore = 0
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => countOutsideQuotes(l, d))
    const first = counts[0]!
    if (first === 0) continue
    const consistency = counts.filter((c) => c === first).length / counts.length
    const score = consistency * 1000 + first
    if (score > bestScore) {
      best = d
      bestScore = score
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

/** Arabic-Indic and Persian digits → ASCII. */
export const asciiDigits = (s: string) =>
  s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))

/** Trims and removes invisible characters (BOM, zero-width, direction marks, NBSP). */
export const cleanCell = (s: string | undefined | null) =>
  (s ?? '').replace(/[​-‏‪-‮﻿]/g, '').replace(/ /g, ' ').trim()

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

export type DateOrder = 'dmy' | 'mdy'

const NUMERIC_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[\st].*)?$/i

/** Day-first (UAE) unless the column only makes sense month-first (e.g. 03/14/1990). */
export function detectDateOrder(values: string[]): DateOrder {
  let dayFirst = 0
  let monthFirst = 0
  for (const v of values) {
    const m = NUMERIC_DATE.exec(asciiDigits(cleanCell(v)))
    if (!m) continue
    const a = Number(m[1])
    const b = Number(m[2])
    if (a > 12 && b <= 12) dayFirst++
    if (b > 12 && a <= 12) monthFirst++
  }
  return monthFirst > 0 && dayFirst === 0 ? 'mdy' : 'dmy'
}

const fullYear = (y: string, now = new Date()) => {
  if (y.length === 4) return Number(y)
  const yy = Number(y)
  return 2000 + yy > now.getUTCFullYear() ? 1900 + yy : 2000 + yy
}

const ymd = (y: number, m: number, d: number) => {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return dt.toISOString().slice(0, 10)
}

/**
 * Parses DD/MM/YYYY (or MM/DD with order 'mdy'), D-M-YY, DD.MM.YYYY, YYYY-MM-DD, D-Mon-YYYY,
 * "5 March 1990", "Mar 5, 1990" and Excel serial numbers. Returns YYYY-MM-DD or null.
 */
export function parseDate(input: string, order: DateOrder = 'dmy'): string | null {
  const s = asciiDigits(cleanCell(input)).toLowerCase()
  if (!s) return null
  let m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?:[\st].*)?$/.exec(s)
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]))
  m = NUMERIC_DATE.exec(s)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    const y = fullYear(m[3]!)
    return order === 'mdy' ? ymd(y, a, b) : ymd(y, b, a)
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s/.,-]+([a-z]+)\.?[\s/.,-]+(\d{2}|\d{4})$/.exec(s)
  if (m) {
    const month = MONTHS[m[2]!]
    return month ? ymd(fullYear(m[3]!), month, Number(m[1])) : null
  }
  m = /^([a-z]+)\.?[\s/-]+(\d{1,2})(?:st|nd|rd|th)?,?[\s/-]+(\d{4})$/.exec(s)
  if (m) {
    const month = MONTHS[m[1]!]
    return month ? ymd(Number(m[3]), month, Number(m[2])) : null
  }
  if (/^\d{5}$/.test(s)) {
    // Excel serial date (days since 1899-12-30; five digits = 1927–2173, so a bare year is an error).
    const n = Number(s)
    if (n < 1 || n > 73_000) return null
    return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10)
  }
  return null
}

/** Money / quantities: "AED 1,200.50", "1.200,50", "12,5", "٣٥٠". Returns null when not a number. */
export function parseAmount(input: string): number | null {
  let s = asciiDigits(cleanCell(input))
    .replace(/aed|dhs?|د\.?\s?إ|درهم/gi, '')
    .replace(/[\s']/g, '')
  if (!s) return null
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '')
  else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  return Number(s)
}

/** Minutes from "60", "60 min", "1h", "1h 30min", "1.5 hours", "1:30" or "01:30:00". */
export function parseDuration(input: string): number | null {
  const s = asciiDigits(cleanCell(input)).toLowerCase()
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s) || null
  let m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s)
  if (m) return Number(m[1]) * 60 + Number(m[2]) || null
  m =
    /^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours|ساعة|ساعات)\.?)?\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes|دقيقة|دقائق)\.?)?$/.exec(
      s,
    )
  if (m && (m[1] || m[2])) {
    const total = Math.round(Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0))
    return total > 0 ? total : null
  }
  return null
}

/** UAE mobile → E.164 digits (971…) with Arabic digits accepted. */
export const normalisePhone = (input: string) => toUaeE164(asciiDigits(cleanCell(input)))

/** +971 50 123 4567 */
export const formatUaePhone = (e164: string) =>
  /^9715\d{8}$/.test(e164) ? `+971 ${e164.slice(3, 5)} ${e164.slice(5, 8)} ${e164.slice(8)}` : `+${e164}`

/** 050 123 4567 — spreadsheet-safe (stays text, keeps the leading zero) and re-imports cleanly. */
export const formatLocalPhone = (e164: string) =>
  /^9715\d{8}$/.test(e164) ? `0${e164.slice(3, 5)} ${e164.slice(5, 8)} ${e164.slice(8)}` : e164

const GENDERS: Record<string, 'female' | 'male' | 'other' | null> = {
  f: 'female',
  female: 'female',
  woman: 'female',
  w: 'female',
  lady: 'female',
  أنثى: 'female',
  انثى: 'female',
  سيدة: 'female',
  m: 'male',
  male: 'male',
  man: 'male',
  ذكر: 'male',
  رجل: 'male',
  other: 'other',
  'non binary': 'other',
  nonbinary: 'other',
  x: 'other',
  unknown: null,
  'prefer not to say': null,
  'not specified': null,
  na: null,
  'n/a': null,
  '-': null,
}

const LANGUAGES: Record<string, 'en' | 'ar'> = {
  en: 'en',
  eng: 'en',
  english: 'en',
  إنجليزي: 'en',
  الإنجليزية: 'en',
  ar: 'ar',
  ara: 'ar',
  arabic: 'ar',
  عربي: 'ar',
  العربية: 'ar',
}

const PRODUCT_KINDS: Record<string, 'retail' | 'consumable'> = {
  retail: 'retail',
  'retail product': 'retail',
  resale: 'retail',
  'for sale': 'retail',
  sell: 'retail',
  consumable: 'consumable',
  consumables: 'consumable',
  professional: 'consumable',
  backbar: 'consumable',
  'back bar': 'consumable',
  internal: 'consumable',
  'salon use': 'consumable',
  'spa use': 'consumable',
}

const UNITS: Record<string, string> = {
  each: 'pcs',
  ea: 'pcs',
  piece: 'pcs',
  pieces: 'pcs',
  pc: 'pcs',
  pcs: 'pcs',
  unit: 'pcs',
  units: 'pcs',
  ml: 'ml',
  millilitre: 'ml',
  milliliter: 'ml',
  l: 'l',
  litre: 'l',
  liter: 'l',
  g: 'g',
  gram: 'g',
  grams: 'g',
  kg: 'kg',
}

const lowerKey = (s: string) => s.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()

export const splitTags = (input: string) => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of cleanCell(input).split(/[,;|]/)) {
    const t = raw.trim().slice(0, 40)
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase())
      out.push(t)
    }
  }
  return out.slice(0, 20)
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

const normHeader = (h: string) =>
  cleanCell(h)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[_.]+/g, ' ')
    .replace(/(^|\s)-|-(\s|$)/g, ' ')
    .replace(/[*:#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Suggests a field for each column ('' = don't import). Exact names first, then stripped units, then containment. */
export function autoMap(kind: ImportKind, headers: string[]): string[] {
  const fields = IMPORT_FIELDS[kind]
  const mapping = headers.map(() => '')
  const used = new Set<string>()
  const full = headers.map(normHeader)
  const bare = full.map((h) =>
    h
      .replace(/\(.*?\)/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )
  const assign = (col: number, key: string) => {
    mapping[col] = key
    used.add(key)
  }
  for (const names of [full, bare]) {
    names.forEach((h, col) => {
      if (mapping[col] || !h) return
      const f = fields.find((f) => !used.has(f.key) && f.aliases.includes(h))
      if (f) assign(col, f.key)
    })
  }
  bare.forEach((h, col) => {
    if (mapping[col] || !h) return
    let best: { key: string; len: number } | null = null
    for (const f of fields) {
      if (used.has(f.key)) continue
      for (const a of f.aliases) {
        if (a.length >= 4 && ` ${h} `.includes(` ${a} `) && (!best || a.length > best.len))
          best = { key: f.key, len: a.length }
      }
    }
    if (best) assign(col, best.key)
  })
  return mapping
}

/** Labels of required fields that no column is mapped to. */
export function missingRequired(kind: ImportKind, mapping: string[]): string[] {
  const has = (k: string) => mapping.includes(k)
  return IMPORT_FIELDS[kind]
    .filter((f) => f.required && !has(f.key))
    .filter((f) => !(kind === 'clients' && f.key === 'name' && has('firstName')))
    .map((f) => f.label)
}

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

export type ClientRecord = {
  name: string
  phone: string | null
  gender: 'female' | 'male' | 'other' | null
  birthday: string | null
  tags: string[]
  notes: string | null
  language: 'en' | 'ar' | null
  source: string | null
}
export type MenuRecord = {
  category: string | null
  nameEn: string
  nameAr: string | null
  durationMin: number
  priceAed: number
  description: string | null
}
export type ProductRecord = {
  name: string
  nameAr: string | null
  sku: string | null
  kind: 'retail' | 'consumable' | null
  unit: string | null
  costAed: number | null
  priceAed: number | null
  stock: number | null
}
export type ImportRecord = ClientRecord | MenuRecord | ProductRecord

export type ValidatedRow<T extends ImportRecord = ImportRecord> = {
  /** Spreadsheet row number (header is row 1). */
  row: number
  record: T | null
  errors: string[]
  /** Duplicate-detection key (normalised phone, name + duration, SKU or name). */
  key: string | null
  /** Earlier row in the same file with the same key. */
  dupOfRow: number | null
  /** Normalised values for the preview (raw text where invalid). */
  display: Record<string, string>
}

const text = (v: string, max: number) => (v ? v.slice(0, max) : null)

function validateClient(get: (k: string) => string, order: DateOrder) {
  const errors: string[] = []
  const display: Record<string, string> = {}
  const name = (get('name') || [get('firstName'), get('lastName')].filter(Boolean).join(' ')).slice(0, 120)
  display.name = name
  if (!name) errors.push('Name is missing')
  let phone: string | null = null
  const rawPhone = get('phone')
  if (rawPhone) {
    phone = normalisePhone(rawPhone)
    display.phone = phone ? formatUaePhone(phone) : rawPhone
    if (!phone) errors.push(`“${rawPhone}” is not a UAE mobile number (e.g. 050 123 4567)`)
  }
  let gender: ClientRecord['gender'] = null
  const rawGender = get('gender')
  if (rawGender) {
    const g = GENDERS[lowerKey(rawGender)]
    if (g === undefined) errors.push(`Gender “${rawGender}” should be female, male or other`)
    else gender = g
    display.gender = g ?? rawGender
  }
  let birthday: string | null = null
  const rawBirthday = get('birthday')
  if (rawBirthday) {
    birthday = parseDate(rawBirthday, order)
    display.birthday = birthday ?? rawBirthday
    if (!birthday) errors.push(`Birthday “${rawBirthday}” is not a date we recognise (use DD/MM/YYYY)`)
    else if (birthday > new Date().toISOString().slice(0, 10)) {
      errors.push('Birthday is in the future')
      birthday = null
    }
  }
  const tags = splitTags(get('tags'))
  if (tags.length) display.tags = tags.join(', ')
  const notes = text(get('notes'), 2000)
  if (notes) display.notes = notes
  const language = LANGUAGES[lowerKey(get('language'))] ?? null
  if (get('language')) display.language = language ?? get('language')
  const source = text(get('source'), 80)
  if (source) display.source = source
  const record: ClientRecord = { name, phone, gender, birthday, tags, notes, language, source }
  const key = phone ?? (name ? `name:${name.toLowerCase()}` : null)
  return { record, errors, display, key }
}

function validateMenu(get: (k: string) => string) {
  const errors: string[] = []
  const display: Record<string, string> = {}
  const nameEn = get('nameEn').slice(0, 120)
  display.nameEn = nameEn
  if (!nameEn) errors.push('Service name is missing')
  const nameAr = text(get('nameAr'), 120)
  if (nameAr) display.nameAr = nameAr
  const category = text(get('category'), 80)
  if (category) display.category = category
  const rawDuration = get('duration')
  const durationMin = parseDuration(rawDuration)
  display.duration = durationMin ? `${durationMin} min` : rawDuration
  if (!rawDuration) errors.push('Duration is missing')
  else if (!durationMin || durationMin < 5 || durationMin > 600)
    errors.push(`Duration “${rawDuration}” should be minutes between 5 and 600`)
  const rawPrice = get('price')
  const priceAed = parseAmount(rawPrice)
  display.price = priceAed == null ? rawPrice : priceAed.toFixed(2)
  if (!rawPrice) errors.push('Price is missing')
  else if (priceAed == null || priceAed < 0 || priceAed > 100_000)
    errors.push(`Price “${rawPrice}” should be an amount in AED`)
  const description = text(get('description'), 1000)
  if (description) display.description = description
  const record: MenuRecord = {
    category,
    nameEn,
    nameAr,
    durationMin: durationMin ?? 0,
    priceAed: Math.round((priceAed ?? 0) * 100) / 100,
    description,
  }
  const key = nameEn && durationMin ? `${nameEn.toLowerCase()}|${durationMin}` : null
  return { record, errors, display, key }
}

function validateProduct(get: (k: string) => string) {
  const errors: string[] = []
  const display: Record<string, string> = {}
  const name = get('name').slice(0, 120)
  display.name = name
  if (!name) errors.push('Name is missing')
  const nameAr = text(get('nameAr'), 120)
  if (nameAr) display.nameAr = nameAr
  const sku = text(get('sku'), 60)
  if (sku) display.sku = sku
  let kind: ProductRecord['kind'] = null
  const rawKind = get('kind')
  if (rawKind) {
    kind = PRODUCT_KINDS[lowerKey(rawKind)] ?? null
    display.kind = kind ?? rawKind
    if (!kind) errors.push(`Type “${rawKind}” should be retail or consumable`)
  }
  const rawUnit = get('unit')
  const unit = rawUnit ? (UNITS[lowerKey(rawUnit)] ?? lowerKey(rawUnit).slice(0, 12)) : null
  if (unit) display.unit = unit
  const amount = (k: 'cost' | 'price' | 'stock', label: string, max: number) => {
    const raw = get(k)
    if (!raw) return null
    const n = parseAmount(raw)
    display[k] = n == null ? raw : String(n)
    if (n == null || n < 0 || n > max) {
      errors.push(`${label} “${raw}” should be a number of 0 or more`)
      return null
    }
    return n
  }
  const costAed = amount('cost', 'Cost', 1_000_000)
  const priceAed = amount('price', 'Price', 1_000_000)
  const stock = amount('stock', 'Stock', 1_000_000)
  const r2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100)
  const record: ProductRecord = {
    name,
    nameAr,
    sku,
    kind,
    unit,
    costAed: r2(costAed),
    priceAed: r2(priceAed),
    stock: stock == null ? null : Math.round(stock * 1000) / 1000,
  }
  const key = sku ? `sku:${sku.toLowerCase()}` : name ? `name:${name.toLowerCase()}` : null
  return { record, errors, display, key }
}

export const isBlankRow = (r: string[]) => r.every((c) => !c?.trim())

/** Row error without the cell values quoted in it (for the audit log, which outlives the upload). */
export const withoutValues = (message: string) => message.replace(/“[^”]*”/g, '“…”')

/**
 * Validates and normalises every data row with the chosen mapping (column index → field key). Blank rows
 * are dropped but still counted, so `row` stays the spreadsheet row (`firstRow` = row number of rows[0]).
 */
export function validateRows(
  kind: ImportKind,
  rows: string[][],
  mapping: string[],
  firstRow = 2,
): ValidatedRow[] {
  const col = new Map<string, number>()
  mapping.forEach((key, i) => {
    if (key && !col.has(key)) col.set(key, i)
  })
  const cell = (r: string[], key: string) => {
    const i = col.get(key)
    return i == null ? '' : cleanCell(r[i])
  }
  const order = col.has('birthday') ? detectDateOrder(rows.map((r) => cell(r, 'birthday'))) : 'dmy'
  const seen = new Map<string, number>()
  return rows.flatMap((r, i) => {
    if (isBlankRow(r)) return []
    const get = (k: string) => cell(r, k)
    const v =
      kind === 'clients'
        ? validateClient(get, order)
        : kind === 'menu'
          ? validateMenu(get)
          : validateProduct(get)
    const row = i + firstRow
    let dupOfRow: number | null = null
    if (!v.errors.length && v.key) {
      dupOfRow = seen.get(v.key) ?? null
      if (dupOfRow == null) seen.set(v.key, row)
    }
    return [
      {
        row,
        record: v.errors.length ? null : v.record,
        errors: v.errors,
        key: v.key,
        dupOfRow,
        display: v.display,
      },
    ]
  })
}

// ---------------------------------------------------------------------------
// CSV output
// ---------------------------------------------------------------------------

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/

/** One quoted CSV cell; text that a spreadsheet would run as a formula is prefixed with an apostrophe. */
export function csvCell(value: unknown): string {
  let s: string
  if (value == null) s = ''
  else if (value instanceof Date) s = value.toISOString()
  else if (Array.isArray(value))
    s = value.every((v) => typeof v !== 'object') ? value.join('; ') : JSON.stringify(value)
  else if (typeof value === 'object') s = JSON.stringify(value)
  else s = String(value)
  if (/^[=+\-@\t\r]/.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`
  return `"${s.replaceAll('"', '""')}"`
}

/** Rows → Excel-friendly CSV (UTF-8 BOM so Arabic opens correctly, CRLF line endings). */
export const toCsv = (rows: unknown[][]) => `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`
