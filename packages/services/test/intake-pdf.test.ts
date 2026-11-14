import { inflateSync } from 'node:zlib'
import {
  clients,
  closeAllDbs,
  intakeSubmissions,
  intakeTemplates,
  storedFiles,
  tenants,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq, sql } from 'drizzle-orm'
import { extractText, getDocumentProxy } from 'unpdf'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  countTenantRows,
  deleteTenant,
  eraseClient,
  getFile,
  INTAKE_PDF_PURPOSE,
  intakeAnswerRows,
  intakeContentHash,
  intakePdfExportList,
  purgeTenant,
  sha256Hex,
  zipStream,
} from '../src'
import { generateIntakePdf, renderIntakePdf } from '../src/pdf/intake-pdf'
import { bidiLevels, visualPieces } from '../src/pdf/text'

const { owner, platform, app } = testDbs()
const SIGNATURE = 'M 20 150 L 60 60 L 100 140 L 150 50 L 200 150 L 260 90'

async function pdfText(bytes: Buffer) {
  const doc = await getDocumentProxy(new Uint8Array(bytes))
  const { text } = await extractText(doc, { mergePages: true })
  // Decomposed glyphs (Arabic dots, Thai NIKHAHIT) read back as U+034F, and pdf.js guesses a space after some
  // repositioned Thai marks; neither is in the drawn text.
  const clean = (text as string)
    .replaceAll('\u034f', '')
    .replace(/(?<=[\u0e00-\u0e7f]) (?=[\u0e00-\u0e7f])/g, '')
  return { text: clean, pages: doc.numPages }
}

/**
 * ActualText of the marked-content spans (Arabic pieces carry their text there: Noto Naskh shares glyphs between
 * letters, so the per-glyph text map alone can't hold it). Inflates the content streams and decodes UTF-16BE.
 */
function actualTexts(pdf: Buffer) {
  const out: string[] = []
  const raw = pdf.toString('latin1')
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = m.index! + m[0].length
    const end = raw.indexOf('endstream', start)
    let body: string
    try {
      body = inflateSync(pdf.subarray(start, end)).toString('latin1')
    } catch {
      continue
    }
    for (const a of body.matchAll(/\/ActualText \(((?:\\[\s\S]|[^\\)])*)\)/g)) {
      const bytes = Buffer.from(
        a[1]!.replace(/\\([0-7]{1,3}|[\s\S])/g, (_, e: string) =>
          /^[0-7]/.test(e)
            ? String.fromCharCode(Number.parseInt(e, 8))
            : (({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[e] ?? e),
        ),
        'latin1',
      )
      out.push(bytes.subarray(2).swap16().toString('utf16le'))
    }
  }
  return out
}

/** A spa with an intake template and one signed submission (Thai client name, Arabic + Thai answers). */
async function seed(slug: string, lang: 'en' | 'ar' = 'en') {
  const [t] = await platform
    .insert(tenants)
    .values({ slug, name: `${slug} Spa` })
    .returning()
  const tenant = t!.id
  return withTenant(
    tenant,
    async (db) => {
      const [c] = await db.insert(clients).values({ tenantId: tenant, name: 'สมชาย ใจดี' }).returning()
      const [tpl] = await db
        .insert(intakeTemplates)
        .values({
          tenantId: tenant,
          name: 'Massage intake & consent',
          fields: [
            { key: 'allergies', label: { en: 'Any allergies?', ar: 'هل لديك أي حساسية؟' }, type: 'text' },
            { key: 'pregnant', label: { en: 'Pregnant?', ar: 'هل أنتِ حامل؟' }, type: 'yesno' },
          ],
          waiver: { en: 'I confirm the information is correct.', ar: 'أقر بأن المعلومات صحيحة.' },
          version: 2,
        })
        .returning()
      const [s] = await db
        .insert(intakeSubmissions)
        .values({
          tenantId: tenant,
          clientId: c!.id,
          templateId: tpl!.id,
          templateVersion: 2,
          answers: { allergies: 'แพ้น้ำมันอัลมอนด์', pregnant: 'no', old_question: 'kept', _lang: lang },
          waiverText: lang === 'ar' ? 'أقر بأن المعلومات صحيحة.' : 'I confirm the information is correct.',
          signature: SIGNATURE,
          ip: '203.0.113.7',
        })
        .returning()
      return { tenant, client: c!.id, submission: s!.id }
    },
    app,
  )
}

beforeAll(resetTestDatabase)
afterAll(closeAllDbs)

describe('intake PDF text layout', () => {
  it('orders Arabic right to left with numbers, IPs and bracketed Latin kept readable', () => {
    const pieces = (s: string, rtl: boolean) => visualPieces(s, rtl).map((p) => p.text)
    expect(pieces('203.0.113.7', true)).toEqual(['203.0.113.7'])
    expect(pieces('abc (عربي) def', false)).toEqual(['abc (', 'عربي', ') def'])
    // Visual order of an Arabic sentence with a number: the number sits left of the first word.
    expect(pieces('رقم 12', true)).toEqual(['12', 'رقم '])
    expect(bidiLevels([...'14:05'], true)).toEqual([2, 2, 2, 2, 2])
  })
})

describe('renderIntakePdf', () => {
  it('writes the record (EN form, Thai answers) and reads back as text', async () => {
    const pdf = await renderIntakePdf({
      spaName: 'Oasis Spa',
      templateName: 'Massage intake & consent',
      lang: 'en',
      clientName: 'สมชาย ใจดี',
      answers: [
        { label: 'Any allergies?', value: 'แพ้น้ำมันอัลมอนด์' },
        { label: 'Pressure', value: 'Medium' },
      ],
      waiverText: 'I confirm the information I have given is correct and complete. '.repeat(40),
      signature: SIGNATURE,
      signedAt: new Date('2026-10-09T10:05:00Z'),
      ip: '203.0.113.7',
      templateVersion: 3,
      submissionId: '0b6f7f2e-4a1c-4d8e-9c55-1f2a3b4c5d6e',
      contentSha256: 'ab'.repeat(32),
      generatedAt: new Date('2026-10-09T10:06:00Z'),
    })
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    const { text, pages } = await pdfText(pdf)
    expect(pages).toBeGreaterThanOrEqual(2) // long waiver flows onto a second page
    for (const s of [
      'Oasis Spa',
      'Massage intake & consent',
      'สมชาย',
      'แพ้น้ำมันอัลมอนด์',
      'Medium',
      '9 Oct 2026, 14:05',
      '203.0.113.7',
      '0b6f7f2e-4a1c-4d8e-9c55-1f2a3b4c5d6e',
      'ab'.repeat(32),
      `Page 2 of ${pages}`,
    ])
      expect(text).toContain(s)
  })

  it('renders an Arabic form (labels and waiver in Arabic)', async () => {
    const pdf = await renderIntakePdf({
      spaName: 'سبا الواحة',
      templateName: 'استمارة التدليك',
      lang: 'ar',
      clientName: 'فاطمة',
      answers: [{ label: 'هل لديك أي حساسية؟', value: 'لا' }],
      waiverText: 'أقر بأن المعلومات صحيحة.',
      signature: SIGNATURE,
      signedAt: new Date('2026-10-09T10:05:00Z'),
      ip: null,
      templateVersion: 1,
      submissionId: '11111111-2222-4333-8444-555555555555',
      contentSha256: 'cd'.repeat(32),
      generatedAt: new Date(),
    })
    const { text } = await pdfText(pdf)
    expect(text).toContain('11111111-2222-4333-8444-555555555555')
    expect(text).toContain('14:05') // numbers stay left to right inside Arabic lines
    const actual = actualTexts(pdf)
    for (const s of ['سبا الواحة', 'فاطمة', 'التوقيع', 'الإقرار والموافقة', 'أقر بأن المعلومات صحيحة'])
      expect(actual.some((a) => a.includes(s))).toBe(true)
  })
})

describe('generateIntakePdf', () => {
  let spa: Awaited<ReturnType<typeof seed>>
  let other: Awaited<ReturnType<typeof seed>>
  beforeAll(async () => {
    spa = await seed('pdf-a')
    other = await seed('pdf-b', 'ar')
  })

  it('stores a private PDF with the record hash and replaces it on regenerate', async () => {
    const first = await withTenant(spa.tenant, (db) => generateIntakePdf(db, spa.submission), app)
    const { row, file } = await withTenant(
      spa.tenant,
      async (db) => {
        const [row] = await db
          .select()
          .from(intakeSubmissions)
          .where(eq(intakeSubmissions.id, spa.submission))
        return { row: row!, file: await getFile(db, first.fileId) }
      },
      app,
    )
    expect(file).toMatchObject({
      isPublic: false,
      purpose: INTAKE_PDF_PURPOSE,
      contentType: 'application/pdf',
    })
    expect(file!.filename).toMatch(/^intake-client-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.pdf$/)
    expect(row.pdfFileId).toBe(first.fileId)
    expect(row.pdfSha256).toBe(sha256Hex(file!.bytes))
    expect(row.contentSha256).toBe(intakeContentHash(row))
    const { text } = await pdfText(file!.bytes)
    expect(text).toContain(row.contentSha256!)
    expect(text).toContain('Any allergies?')
    expect(text).toContain('แพ้น้ำมันอัลมอนด์')
    expect(text).toContain('Old question') // an answer whose question left the template is kept

    const second = await withTenant(spa.tenant, (db) => generateIntakePdf(db, spa.submission), app)
    expect(second.fileId).not.toBe(first.fileId)
    expect(second.contentSha256).toBe(first.contentSha256)
    await withTenant(
      spa.tenant,
      async (db) => {
        expect(await getFile(db, first.fileId)).toBeNull()
        const list = await intakePdfExportList(db)
        expect(list.map((r) => r.fileId)).toEqual([second.fileId])
      },
      app,
    )
  })

  it('cannot read or render another spa’s submission (RLS)', async () => {
    const theirs = await withTenant(other.tenant, (db) => generateIntakePdf(db, other.submission), app)
    await withTenant(
      spa.tenant,
      async (db) => {
        expect(await getFile(db, theirs.fileId)).toBeNull()
        await expect(generateIntakePdf(db, other.submission)).rejects.toThrow(/not found/i)
      },
      app,
    )
  })

  it('a changed record no longer matches its hash', async () => {
    const [row] = await withTenant(
      spa.tenant,
      (db) => db.select().from(intakeSubmissions).where(eq(intakeSubmissions.id, spa.submission)),
      app,
    )
    expect(intakeContentHash({ ...row!, waiverText: `${row!.waiverText} (edited)` })).not.toBe(
      row!.contentSha256,
    )
    expect(intakeAnswerRows(null, { pregnant: 'yes' }, 'ar')).toEqual([
      { key: 'pregnant', label: 'Pregnant', value: 'نعم' },
    ])
  })

  it('client erase deletes the PDF file with the submission', async () => {
    const { removed } = await withTenant(other.tenant, (db) => eraseClient(db, other.client), app)
    expect(removed).toMatchObject({ intakePdfs: 1, intakeSubmissions: 1 })
    const [n] = await owner
      .select({ n: sql<number>`count(*)::int` })
      .from(storedFiles)
      .where(eq(storedFiles.tenantId, other.tenant))
    expect(n!.n).toBe(0)
  })

  it('tenant purge removes the PDFs with the spa', async () => {
    expect((await countTenantRows(owner, spa.tenant)).stored_files).toBe(1)
    await deleteTenant(platform, spa.tenant, 'pdf-a')
    await purgeTenant(platform, spa.tenant, 'pdf-a', { cf: null })
    expect(await countTenantRows(owner, spa.tenant)).toEqual({})
  })
})

describe('zipStream', () => {
  it('writes a valid STORE zip (local headers, central directory, UTF-8 names)', async () => {
    async function* entries() {
      yield { name: 'a.pdf', bytes: Buffer.from('%PDF-1 a'), date: new Date('2026-10-09T10:00:00Z') }
      yield { name: 'ข.pdf', bytes: Buffer.from('%PDF-1 bb') }
    }
    const buf = Buffer.from(await new Response(zipStream(entries())).arrayBuffer())
    expect(buf.readUInt32LE(0)).toBe(0x04034b50)
    const end = buf.length - 22
    expect(buf.readUInt32LE(end)).toBe(0x06054b50)
    expect(buf.readUInt16LE(end + 10)).toBe(2)
    const dirOffset = buf.readUInt32LE(end + 16)
    expect(buf.readUInt32LE(dirOffset)).toBe(0x02014b50)
    const nameLen = buf.readUInt16LE(dirOffset + 28)
    expect(buf.subarray(dirOffset + 46, dirOffset + 46 + nameLen).toString()).toBe('a.pdf')
    expect(buf.includes(Buffer.from('ข.pdf'))).toBe(true)
  })
})
