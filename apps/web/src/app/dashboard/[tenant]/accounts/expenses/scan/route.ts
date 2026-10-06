import { AiBudgetExceededError, AiDisabledError, aiConfigured, scanReceipt } from '@spa/ai'
import { withTenant } from '@spa/db'
import { dubaiToday, fileLink, putFile } from '@spa/services'
import sharp from 'sharp'
import { json, readScanUpload } from '@/components/documents/upload-request'
import { audit } from '@/server/audit'

/**
 * POST {app}/{slug}/accounts/expenses/scan (multipart: file) — "Scan receipt": stores the photo privately
 * (purpose 'receipt'), then asks the vision model for vendor, date, total, VAT, TRN and a category so the
 * expense form can be prefilled. Without AI (or for PDFs) the receipt is still attached. Needs accounting.manage.
 */
export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const upload = await readScanUpload(req, (await params).tenant, 'accounting.manage')
  if (upload instanceof Response) return upload
  const { ctx } = upload
  const tenantId = ctx.tenant.id

  const stored = await withTenant(tenantId, (tx) =>
    putFile(tx, {
      tenantId,
      bytes: upload.bytes,
      contentType: upload.contentType,
      filename: upload.filename,
      isPublic: false,
      purpose: 'receipt',
      createdBy: ctx.user.id,
    }),
  )
  const file = {
    id: stored.id,
    url: fileLink(stored.id),
    name: upload.filename,
    contentType: stored.contentType,
  }
  await audit({
    tenantId,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action: 'expense.receipt_uploaded',
    entity: 'stored_file',
    entityId: stored.id,
    data: { size: stored.size, contentType: stored.contentType },
  })

  const attached = (status: string, message: string) => json(200, { ok: true, file, status, message })
  if (!aiConfigured())
    return attached(
      'unavailable',
      'Receipt attached. Automatic reading isn’t switched on yet — please fill in the details.',
    )
  if (!upload.contentType.startsWith('image/'))
    return attached('pdf', 'PDF attached. Scanning reads photos — please fill in the details from the PDF.')

  try {
    // Downscale before sending: receipts read fine at 1600px and it keeps tokens (and cost) low.
    const jpeg = await sharp(upload.bytes, { failOn: 'none' })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer()
    const res = await scanReceipt({
      tenantId,
      image: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      today: dubaiToday(),
    })
    // A receipt in another currency must not prefill the AED amount: the owner enters what they actually paid.
    const currency = res.fields.currency
    const foreign = currency && !/^(AED|DHS?)$/.test(currency) ? currency : null
    return json(200, {
      ok: true,
      file,
      status: foreign ? 'currency' : 'read',
      message: foreign
        ? `Receipt is in ${foreign} — enter the AED amount you paid.`
        : res.fields.totalAed
          ? 'Receipt read — check the details before saving.'
          : 'Receipt attached, but the total wasn’t readable — please fill it in.',
      fields: foreign ? { ...res.fields, totalAed: null, vatAed: null } : res.fields,
      ocr: { ...res.fields, model: res.modelKey },
    })
  } catch (e) {
    if (e instanceof AiBudgetExceededError)
      return attached(
        'budget',
        'Receipt attached. Your monthly AI budget is used up — please fill in the details.',
      )
    if (e instanceof AiDisabledError)
      return attached(
        'unavailable',
        'Receipt attached. Scanning is switched off — please fill in the details.',
      )
    console.error('receipt scan failed', e)
    return attached('failed', 'Receipt attached, but it couldn’t be read. Please fill in the details.')
  }
}
