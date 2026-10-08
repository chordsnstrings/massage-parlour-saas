import { withTenant } from '@spa/db'
import {
  autoMap,
  existingRows,
  IMPORT_FIELDS,
  isBinaryFile,
  isImportKind,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  missingRequired,
  runImport,
  toCsv,
  validateRows,
  withoutValues,
} from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { IMPORT_PERMISSION } from '@/components/data/kinds'
import { crossSite, json, parseCsvFile } from '@/components/data/server'
import { getT } from '@/i18n/server'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

const PREVIEW_ROWS = 20

const input = z.object({
  mode: z.enum(['preview', 'commit']),
  onDuplicate: z.enum(['update', 'skip']).default('update'),
  mapping: z
    .string()
    .optional()
    .transform((s, c) => {
      if (!s) return null
      try {
        return z.array(z.string().max(40)).max(500).parse(JSON.parse(s))
      } catch {
        c.addIssue({ code: 'custom', message: 'Invalid column mapping' })
        return z.NEVER
      }
    }),
})

const REVALIDATE = { clients: 'clients', menu: 'services', products: 'inventory' } as const

/** CSV import: `mode=preview` validates and checks duplicates; `mode=commit` writes in chunks of 500 rows. */
export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const slug = (await params).tenant
  const t = await getT()
  if (crossSite(req)) return json({ ok: false, error: t('errors.forbidden') }, 403)
  const fd = await req.formData().catch(() => null)
  const kind = String(fd?.get('kind') ?? '')
  if (!fd || !isImportKind(kind)) return json({ ok: false, error: t('settings.data.upload.choose') }, 400)
  const { ctx, error } = await guard(slug, IMPORT_PERMISSION[kind])
  if (error) return json({ ok: false, error }, 403)

  const parsed = input.safeParse({
    mode: fd.get('mode'),
    onDuplicate: fd.get('onDuplicate') ?? undefined,
    mapping: fd.get('mapping') ?? undefined,
  })
  if (!parsed.success) return json({ ok: false, error: t('settings.data.upload.settings') }, 400)
  const file = fd.get('file')
  if (!(file instanceof Blob) || file.size === 0)
    return json({ ok: false, error: t('settings.data.upload.chooseFile') }, 400)
  if (file.size > MAX_IMPORT_BYTES) return json({ ok: false, error: t('settings.data.upload.tooLarge') }, 400)
  const fileName = (file instanceof File ? file.name : 'import.csv').slice(0, 120)

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (isBinaryFile(bytes))
    return json(
      {
        ok: false,
        error: t('settings.data.upload.xlsx'),
      },
      400,
    )
  const { headers, rows, firstRow, count, delimiter } = parseCsvFile(bytes)
  if (!count) return json({ ok: false, error: t('settings.data.upload.noRows') }, 400)
  if (count > MAX_IMPORT_ROWS)
    return json(
      { ok: false, error: t('settings.data.upload.split', { max: MAX_IMPORT_ROWS.toLocaleString('en-GB') }) },
      400,
    )

  const known = new Set(IMPORT_FIELDS[kind].map((f) => f.key))
  const seen = new Set<string>()
  const requested = parsed.data.mapping ?? autoMap(kind, headers)
  const mapping = headers.map((_, i) => {
    const key = requested[i] ?? ''
    if (!known.has(key) || seen.has(key)) return ''
    seen.add(key)
    return key
  })
  const missing = missingRequired(kind, mapping)
  const validated = validateRows(kind, rows, mapping, firstRow)

  if (parsed.data.mode === 'preview') {
    const existing = await withTenant(ctx.tenant.id, (tx) => existingRows(tx, kind, validated))
    return json({
      ok: true,
      preview: {
        fileName,
        delimiter,
        headers,
        samples: headers.map(
          (_, i) =>
            rows
              .find((r) => r[i]?.trim())
              ?.[i]?.trim()
              .slice(0, 60) ?? '',
        ),
        mapping,
        missing,
        counts: {
          total: validated.length,
          errors: validated.filter((r) => r.errors.length).length,
          fileDuplicates: validated.filter((r) => r.dupOfRow != null).length,
          existing: existing.size,
        },
        rows: validated.slice(0, PREVIEW_ROWS).map((r) => ({
          row: r.row,
          display: r.display,
          errors: r.errors,
          dupOfRow: r.dupOfRow,
          exists: existing.has(r.row),
        })),
      },
    })
  }

  if (missing.length)
    return json({ ok: false, error: t('settings.data.upload.map', { fields: missing.join(', ') }) }, 400)
  const summary = await runImport({
    tenantId: ctx.tenant.id,
    kind,
    rows: validated,
    onDuplicate: parsed.data.onDuplicate,
    userId: ctx.user.id,
  })
  const errorCsv = summary.errors.length
    ? toCsv([
        ['Row', ...headers, 'Error'],
        ...summary.errors.map((e) => [
          e.row,
          ...headers.map((_, i) => rows[e.row - firstRow]?.[i] ?? ''),
          e.message,
        ]),
      ])
    : null
  const { errors, ...counts } = summary
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action: 'data.import',
    entity: kind,
    data: {
      file: fileName,
      by: ctx.user.name,
      onDuplicate: parsed.data.onDuplicate,
      ...counts,
      errorCount: errors.length,
      // Value-free messages: the audit log outlives the upload and must not keep phones or birthdays.
      errors: errors.slice(0, 500).map((e) => ({ row: e.row, message: withoutValues(e.message) })),
    },
  })
  revalidatePath(`/dashboard/${slug}/${REVALIDATE[kind]}`)
  revalidatePath(`/dashboard/${slug}/settings/data`)
  return json({
    ok: true,
    summary: { ...counts, errorCount: errors.length, errors: errors.slice(0, 50) },
    errorCsv,
  })
}
