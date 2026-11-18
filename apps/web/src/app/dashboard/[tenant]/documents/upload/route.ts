import { withTenant } from '@spa/db'
import { fileLink, putFile } from '@spa/services'
import { json, readScanUpload } from '@/components/documents/upload-request'
import { audit } from '@/server/audit'

/**
 * POST {app}/{slug}/documents/upload (multipart: file, scope) — stores a document scan privately and returns
 * its id; the document form then saves it with the rest of the fields. Requires `staff.manage`.
 */
export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const upload = await readScanUpload(req, (await params).tenant, 'staff.manage')
  if (upload instanceof Response) return upload
  const { ctx } = upload
  const scope = new URL(req.url).searchParams.get('scope') === 'business' ? 'business' : 'staff'
  const file = await withTenant(ctx.tenant.id, (tx) =>
    putFile(tx, {
      tenantId: ctx.tenant.id,
      bytes: upload.bytes,
      contentType: upload.contentType,
      filename: upload.filename,
      isPublic: false,
      purpose: `${scope}_document`,
      createdBy: ctx.user.id,
    }),
  )
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action: 'document.file_uploaded',
    entity: 'stored_file',
    entityId: file.id,
    data: { scope, size: file.size, contentType: file.contentType },
  })
  return json(200, {
    ok: true,
    file: { id: file.id, url: fileLink(file.id), name: upload.filename, contentType: file.contentType },
  })
}
