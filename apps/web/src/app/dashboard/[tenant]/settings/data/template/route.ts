import { IMPORT_TEMPLATES, isImportKind } from '@spa/services'
import { notFound } from 'next/navigation'
import { IMPORT_PERMISSION } from '@/components/data/kinds'
import { xlsxDownload } from '@/components/data/server'
import { can, requireMember } from '@/server/access'

/** Example .xlsx with the headers the importer recognises (English, so autoMap always matches). */
export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  const kind = new URL(req.url).searchParams.get('kind') ?? ''
  if (!isImportKind(kind) || !can(ctx, IMPORT_PERMISSION[kind])) notFound()
  return xlsxDownload(`${kind}-template.xlsx`, {
    sheets: [
      {
        name: kind,
        title: `${ctx.tenant.name} — ${kind} import template`,
        subtitle:
          'Keep the header row; replace the example rows with yours. Upload this file as .xlsx or CSV.',
        rows: IMPORT_TEMPLATES[kind],
        kinds: IMPORT_TEMPLATES[kind][0]!.map(() => 'text' as const),
      },
    ],
  })
}
