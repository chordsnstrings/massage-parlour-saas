// Signed intake / waiver PDF (F27), server-only (`@spa/services/intake-pdf`; pdfkit is external in next.config).
// Rendered in-process with embedded font subsets — no headless browser. Stored as a private file (purpose
// `intake_pdf`) and linked from the submission; regenerating replaces the file.
import { clients, intakeSubmissions, intakeTemplates, type Tx, tenants } from '@spa/db'
import { eq } from 'drizzle-orm'
import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { DomainError } from '../errors'
import {
  INTAKE_PDF_PURPOSE,
  intakeAnswerRows,
  intakeContentHash,
  intakePdfFilename,
  sha256Hex,
} from '../intake'
import { deleteFile, getFile, putFile } from '../storage'
import { PDF_FONTS, type PdfFontKey } from './fonts.generated'
import { baseRtl, type Family, type Piece, visualPieces, wrapLines } from './text'

export type IntakePdfInput = {
  spaName: string
  /** PNG or JPEG bytes (the caller converts the WebP logo). */
  logo?: Buffer | null
  templateName: string | null
  lang: 'en' | 'ar'
  clientName: string
  answers: { label: string; value: string }[]
  waiverText: string
  /** SVG path data (M/L) in a `viewBox.w × viewBox.h` space. */
  signature: string
  viewBox?: { w: number; h: number }
  signedAt: Date
  ip: string | null
  templateVersion: number
  submissionId: string
  contentSha256: string
  generatedAt: Date
}

const LABELS = {
  en: {
    doc: 'Signed intake form',
    fallbackTitle: 'Intake form',
    client: 'Client',
    signed: 'Signed',
    version: 'Form version',
    consent: 'Consent',
    signature: 'Signature',
    submission: 'Submission',
    hash: 'Record SHA-256',
    page: 'Page {n} of {total}',
    dubai: '(Dubai)',
  },
  ar: {
    doc: 'نموذج موقّع',
    fallbackTitle: 'نموذج الاستقبال',
    client: 'العميل',
    signed: 'تاريخ التوقيع',
    version: 'إصدار النموذج',
    consent: 'الإقرار والموافقة',
    signature: 'التوقيع',
    submission: 'رقم النموذج',
    hash: 'بصمة السجل SHA-256',
    page: 'صفحة {n} من {total}',
    dubai: '(دبي)',
  },
} as const

const INK = '#16201B'
const MUTED = '#5E6B64'
const LINE = '#D5DED8'
const ACCENT = '#0F6B4B'

const A4 = { w: 595.28, h: 841.89 }
const M = { x: 48, top: 48, bottom: 64 }

const fontKey = (family: Family, bold: boolean) => `${family}${bold ? 'Bold' : 'Regular'}` as PdfFontKey

/**
 * Features passed to pdfkit: any value makes pdfkit shape the whole piece at once (its default path lays text out
 * word by word, which puts right-to-left words in left-to-right order). The script's default features (joining,
 * marks, kerning) still apply.
 */
const SHAPE = { features: [] as PDFKit.Mixins.OpenTypeFeatures[] }

/**
 * Glyphs made by decomposition (Noto Naskh's separate dot glyphs, Thai NIKHAHIT split out of SARA AM) map to no
 * text, and pdf.js and others then show the glyph id as a character when copying. Map them to U+034F (combining
 * grapheme joiner: invisible, transparent to Arabic joining). Uses pdfkit's EmbeddedFont `unicode` table (pdfkit
 * is pinned; the services test reads the text back).
 */
function fillEmptyToUnicode(doc: PDFKit.PDFDocument) {
  const fonts = (doc as unknown as { _fontFamilies?: Record<string, { unicode?: number[][] }> })._fontFamilies
  for (const f of Object.values(fonts ?? {}))
    f.unicode?.forEach((cps, gid) => {
      if (gid > 0 && cps.length === 0) f.unicode![gid] = [0x034f]
    })
}

export const formatSignedAt = (d: Date, lang: 'en' | 'ar') =>
  new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', {
    timeZone: 'Asia/Dubai',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)

/** Renders the signed intake as an A4 PDF (EN or AR layout; Thai and Arabic text shaped with embedded fonts). */
export async function renderIntakePdf(input: IntakePdfInput): Promise<Buffer> {
  const L = LABELS[input.lang]
  const docRtl = input.lang === 'ar'
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: M.top, bottom: 24, left: M.x, right: M.x },
    bufferPages: true,
    autoFirstPage: true,
    // No standard (Helvetica) font: every glyph comes from the embedded subsets.
    font: null as unknown as string,
    lang: input.lang,
    displayTitle: true,
    info: {
      Title: `${input.templateName ?? L.fallbackTitle} — ${input.clientName}`,
      Author: input.spaName,
      Subject: `${L.doc} ${input.submissionId}`,
      Keywords: `intake ${input.submissionId} sha256:${input.contentSha256}`,
      Creator: 'spamanagement.co',
      Producer: 'spamanagement.co',
      CreationDate: input.generatedAt,
    },
  })
  for (const [key, b64] of Object.entries(PDF_FONTS)) doc.registerFont(key, Buffer.from(b64, 'base64'))
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const contentW = A4.w - 2 * M.x
  const bottom = A4.h - M.bottom
  let y = M.top
  const measure = (p: Piece, size: number, bold = false) =>
    doc.font(fontKey(p.family, bold)).fontSize(size).widthOfString(p.text, SHAPE)

  /** Draws one line: `rtl` = its bidi base direction, `right` = right-aligned (default: when rtl). */
  const drawLine = (
    line: string,
    at: { x: number; y: number; w: number },
    o: { size: number; bold?: boolean; color?: string; rtl: boolean; right?: boolean },
  ) => {
    const pieces = visualPieces(line, o.rtl)
    const widths = pieces.map((p) => measure(p, o.size, o.bold))
    const total = widths.reduce((a, b) => a + b, 0)
    let x = (o.right ?? o.rtl) ? at.x + at.w - total : at.x
    pieces.forEach((p, i) => {
      // Arabic glyphs are shared between letters (skeleton + dots), so copy/search uses ActualText instead.
      const actual = p.family === 'arabic' && !/^[\s\d٠-٩۰-۹]*$/.test(p.text)
      if (actual) doc.markContent('Span', { actual: p.rtl ? p.text : [...p.text].reverse().join('') })
      doc
        .font(fontKey(p.family, Boolean(o.bold)))
        .fontSize(o.size)
        .fillColor(o.color ?? INK)
        .text(p.text, x, at.y, { ...SHAPE, lineBreak: false, baseline: 'alphabetic' })
      if (actual) doc.endMarkedContent()
      x += widths[i]!
    })
    return total
  }

  /** Wrapped paragraph in the content column, page breaks included; direction from its text unless given. */
  const paragraph = (
    text: string,
    o: {
      size: number
      bold?: boolean
      color?: string
      gap?: number
      lead?: number
      rtl?: boolean
      right?: boolean
    },
  ) => {
    const rtl = o.rtl ?? baseRtl(text, docRtl)
    const lead = o.size * (o.lead ?? 1.55)
    for (const line of wrapLines(text, contentW, o.size, (p, s) => measure(p, s, o.bold), rtl)) {
      if (y + lead > bottom) {
        doc.addPage()
        y = M.top
      }
      drawLine(line, { x: M.x, y: y + o.size, w: contentW }, { ...o, rtl })
      y += lead
    }
    y += o.gap ?? 0
  }

  const rule = (gapBefore = 10, gapAfter = 14) => {
    y += gapBefore
    doc
      .moveTo(M.x, y)
      .lineTo(A4.w - M.x, y)
      .lineWidth(0.6)
      .strokeColor(LINE)
      .stroke()
    y += gapAfter
  }

  const ensure = (h: number) => {
    if (y + h > bottom) {
      doc.addPage()
      y = M.top
    }
  }

  // Header: logo + spa name on the start side, document kind on the end side.
  const logoSize = 40
  let offset = 0
  if (input.logo) {
    try {
      const lx = docRtl ? A4.w - M.x - logoSize : M.x
      doc.image(input.logo, lx, y, { fit: [logoSize, logoSize], align: 'center', valign: 'center' })
      offset = logoSize + 12
    } catch {
      offset = 0 // unreadable image: name only
    }
  }
  const head = { x: docRtl ? M.x : M.x + offset, w: contentW - offset }
  drawLine(
    input.spaName,
    { ...head, y: y + 16 },
    { size: 13, bold: true, rtl: baseRtl(input.spaName, docRtl), right: docRtl },
  )
  drawLine(L.doc, { ...head, y: y + 32 }, { size: 9, color: MUTED, rtl: docRtl })
  y += Math.max(logoSize, 36)
  rule(12, 18)

  paragraph(input.templateName ?? L.fallbackTitle, { size: 18, bold: true, gap: 2, right: docRtl })
  paragraph(input.clientName, { size: 12, gap: 6, right: docRtl })

  // Facts (label: value), two columns.
  const facts: [string, string][] = [
    [L.client, input.clientName],
    [L.signed, `${formatSignedAt(input.signedAt, input.lang)} ${L.dubai}`],
    [L.version, `v${input.templateVersion}`],
    ...(input.ip ? ([['IP', input.ip]] as [string, string][]) : []),
    [L.submission, input.submissionId],
  ]
  const labelW = 120
  for (const [label, value] of facts) {
    ensure(18)
    const labelX = docRtl ? A4.w - M.x - labelW : M.x
    const valueX = docRtl ? M.x : M.x + labelW
    drawLine(label, { x: labelX, y: y + 10, w: labelW }, { size: 9, color: MUTED, rtl: docRtl })
    drawLine(
      value,
      { x: valueX, y: y + 10, w: contentW - labelW },
      { size: 10, rtl: baseRtl(value, docRtl), right: docRtl },
    )
    y += 17
  }
  rule(6, 14)

  // Answers: numbered question, answer below.
  input.answers.forEach((a, i) => {
    ensure(36)
    paragraph(`${i + 1}. ${a.label}`, { size: 9.5, color: MUTED, lead: 1.5, rtl: baseRtl(a.label, docRtl) })
    paragraph(a.value || '—', { size: 11, bold: true, gap: 8 })
  })
  rule(0, 14)

  // Consent text.
  ensure(40)
  paragraph(L.consent, { size: 11, bold: true, color: ACCENT, gap: 4, rtl: docRtl })
  paragraph(input.waiverText, { size: 10, lead: 1.6, gap: 10 })

  // Signature box.
  const vb = input.viewBox ?? { w: 600, h: 200 }
  const boxW = Math.min(300, contentW)
  const scale = (boxW - 16) / vb.w
  const boxH = vb.h * scale + 16
  ensure(boxH + 52)
  drawLine(L.signature, { x: M.x, y: y + 10, w: contentW }, { size: 9, color: MUTED, rtl: docRtl })
  y += 18
  const boxX = docRtl ? A4.w - M.x - boxW : M.x
  doc.roundedRect(boxX, y, boxW, boxH, 8).lineWidth(0.8).strokeColor(LINE).stroke()
  doc
    .save()
    .translate(boxX + 8, y + 8)
    .scale(scale)
    .path(input.signature)
    .lineWidth(2.4)
    .lineCap('round')
    .lineJoin('round')
    .strokeColor(INK)
    .stroke()
    .restore()
  y += boxH + 8
  drawLine(
    `${L.signed}: ${formatSignedAt(input.signedAt, input.lang)} ${L.dubai}`,
    { x: M.x, y: y + 10, w: contentW },
    { size: 9, color: MUTED, rtl: docRtl },
  )

  // Footer on every page: submission id + record hash (integrity) and page numbers.
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    const fy = A4.h - 36
    doc
      .moveTo(M.x, fy - 12)
      .lineTo(A4.w - M.x, fy - 12)
      .lineWidth(0.4)
      .strokeColor(LINE)
      .stroke()
    drawLine(
      `${input.submissionId} · SHA-256 ${input.contentSha256}`,
      { x: M.x, y: fy, w: contentW },
      { size: 7, color: MUTED, rtl: false },
    )
    drawLine(
      L.page.replace('{n}', String(i - range.start + 1)).replace('{total}', String(range.count)),
      { x: M.x, y: fy + 11, w: contentW },
      { size: 7, color: MUTED, rtl: docRtl },
    )
  }
  fillEmptyToUnicode(doc)
  doc.end()
  return done
}

/** The spa logo as a small JPEG for the PDF header (null when unset or unreadable). */
async function logoForPdf(tx: Tx, fileId: string | null) {
  if (!fileId) return null
  try {
    const f = await getFile(tx, fileId)
    if (!f?.bytes.length) return null
    return await sharp(f.bytes)
      .resize(160, 160, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88 })
      .toBuffer()
  } catch {
    return null
  }
}

/**
 * Renders (or re-renders) a submission's PDF inside the caller's tenant transaction and stores it as a private
 * file; the previous PDF is deleted. Fills `content_sha256` for submissions signed before F27.
 */
export async function generateIntakePdf(
  tx: Tx,
  submissionId: string,
  opts: { createdBy?: string | null; now?: Date } = {},
) {
  const [row] = await tx
    .select({
      s: intakeSubmissions,
      clientName: clients.name,
      spaName: tenants.name,
      logoFileId: tenants.logoFileId,
      templateName: intakeTemplates.name,
      fields: intakeTemplates.fields,
    })
    .from(intakeSubmissions)
    .innerJoin(clients, eq(clients.id, intakeSubmissions.clientId))
    .innerJoin(tenants, eq(tenants.id, intakeSubmissions.tenantId))
    .leftJoin(intakeTemplates, eq(intakeTemplates.id, intakeSubmissions.templateId))
    .where(eq(intakeSubmissions.id, submissionId))
    .for('update', { of: intakeSubmissions })
  if (!row) throw new DomainError('Intake form not found', 'not_found', { key: 'clients.intake.notFound' })
  const { s } = row
  const now = opts.now ?? new Date()
  const hash = s.contentSha256 ?? intakeContentHash(s)
  const lang = s.answers._lang === 'ar' ? 'ar' : 'en'
  const pdf = await renderIntakePdf({
    spaName: row.spaName,
    logo: await logoForPdf(tx, row.logoFileId),
    templateName: row.templateName,
    lang,
    clientName: row.clientName,
    answers: intakeAnswerRows(row.fields, s.answers, lang),
    waiverText: s.waiverText,
    signature: s.signature,
    signedAt: s.signedAt,
    ip: s.ip,
    templateVersion: s.templateVersion,
    submissionId: s.id,
    contentSha256: hash,
    generatedAt: now,
  })
  const file = await putFile(tx, {
    tenantId: s.tenantId,
    bytes: pdf,
    contentType: 'application/pdf',
    filename: intakePdfFilename(row.clientName, s.signedAt, s.id),
    isPublic: false,
    purpose: INTAKE_PDF_PURPOSE,
    createdBy: opts.createdBy ?? null,
  })
  const pdfSha256 = sha256Hex(pdf)
  await tx
    .update(intakeSubmissions)
    .set({ contentSha256: hash, pdfFileId: file.id, pdfSha256, pdfGeneratedAt: now })
    .where(eq(intakeSubmissions.id, s.id))
  if (s.pdfFileId) await deleteFile(tx, s.pdfFileId)
  return { fileId: file.id, size: file.size, sha256: pdfSha256, contentSha256: hash }
}
