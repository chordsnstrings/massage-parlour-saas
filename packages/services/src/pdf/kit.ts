// Shared pdfkit kit for generated PDFs (F27 intake, R32 day sheet), server-only: colours, A4, the embedded font
// subsets (no standard Helvetica), shaped/bidi line drawing and the spa logo as a small JPEG.
import type { Tx } from '@spa/db'
import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { getFile } from '../storage'
import { PDF_FONTS, type PdfFontKey } from './fonts.generated'
import { type Family, type Piece, visualPieces } from './text'

export const INK = '#16201B'
export const MUTED = '#5E6B64'
export const LINE = '#D5DED8'
export const ACCENT = '#0F6B4B'

export const A4 = { w: 595.28, h: 841.89 }

export const fontKey = (family: Family, bold: boolean) =>
  `${family}${bold ? 'Bold' : 'Regular'}` as PdfFontKey

/**
 * Features passed to pdfkit: any value makes pdfkit shape the whole piece at once (its default path lays text out
 * word by word, which puts right-to-left words in left-to-right order). The script's default features (joining,
 * marks, kerning) still apply.
 */
export const SHAPE = { features: [] as PDFKit.Mixins.OpenTypeFeatures[] }

/**
 * Glyphs made by decomposition (Noto Naskh's separate dot glyphs, Thai NIKHAHIT split out of SARA AM) map to no
 * text, and pdf.js and others then show the glyph id as a character when copying. Map them to U+034F (combining
 * grapheme joiner: invisible, transparent to Arabic joining). Uses pdfkit's EmbeddedFont `unicode` table (pdfkit
 * is pinned; the services test reads the text back).
 */
export function fillEmptyToUnicode(doc: PDFKit.PDFDocument) {
  const fonts = (doc as unknown as { _fontFamilies?: Record<string, { unicode?: number[][] }> })._fontFamilies
  for (const f of Object.values(fonts ?? {}))
    f.unicode?.forEach((cps, gid) => {
      if (gid > 0 && cps.length === 0) f.unicode![gid] = [0x034f]
    })
}

/**
 * A buffered A4 document with the embedded fonts registered (no standard font: every glyph comes from the subsets).
 * Call `finish()` once drawing is done: it fixes the copy-text map and resolves with the PDF bytes.
 */
export function createPdf(opts: PDFKit.PDFDocumentOptions) {
  const doc = new PDFDocument({
    size: 'A4',
    bufferPages: true,
    autoFirstPage: true,
    font: null as unknown as string,
    displayTitle: true,
    ...opts,
  })
  for (const [key, b64] of Object.entries(PDF_FONTS)) doc.registerFont(key, Buffer.from(b64, 'base64'))
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
  const finish = () => {
    fillEmptyToUnicode(doc)
    doc.end()
    return done
  }
  return { doc, finish }
}

export type DrawLineOptions = {
  size: number
  bold?: boolean
  color?: string
  /** The line's bidi base direction. */
  rtl: boolean
  /** Right-aligned (default: when rtl). */
  right?: boolean
  /** Centred in `w` (wins over `right`). */
  center?: boolean
}

/** `measure` (one shaped piece) and `drawLine` (one line, font per script, bidi order) bound to a document. */
export function makeDrawLine(doc: PDFKit.PDFDocument) {
  const measure = (p: Piece, size: number, bold = false) =>
    doc.font(fontKey(p.family, bold)).fontSize(size).widthOfString(p.text, SHAPE)
  /** Width of a line as drawLine would draw it. */
  const widthOf = (line: string, o: { size: number; bold?: boolean; rtl: boolean }) =>
    visualPieces(line, o.rtl).reduce((s, p) => s + measure(p, o.size, o.bold), 0)
  /** Draws one line at a baseline `at.y`; returns its width. */
  const drawLine = (line: string, at: { x: number; y: number; w: number }, o: DrawLineOptions) => {
    const pieces = visualPieces(line, o.rtl)
    const widths = pieces.map((p) => measure(p, o.size, o.bold))
    const total = widths.reduce((a, b) => a + b, 0)
    let x = o.center ? at.x + (at.w - total) / 2 : (o.right ?? o.rtl) ? at.x + at.w - total : at.x
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
  return { measure, widthOf, drawLine }
}

/** The spa logo as a small JPEG for a PDF header (null when unset or unreadable). */
export async function logoForPdf(tx: Tx, fileId: string | null) {
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
