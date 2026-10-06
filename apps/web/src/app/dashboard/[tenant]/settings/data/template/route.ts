import { IMPORT_TEMPLATES, isImportKind, toCsv } from '@spa/services'
import { notFound } from 'next/navigation'
import { IMPORT_PERMISSION } from '@/components/data/kinds'
import { csvDownload } from '@/components/data/server'
import { can, requireMember } from '@/server/access'

/** Example CSV with the headers the importer recognises. */
export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  const kind = new URL(req.url).searchParams.get('kind') ?? ''
  if (!isImportKind(kind) || !can(ctx, IMPORT_PERMISSION[kind])) notFound()
  return csvDownload(`${kind}-template.csv`, toCsv(IMPORT_TEMPLATES[kind]))
}
