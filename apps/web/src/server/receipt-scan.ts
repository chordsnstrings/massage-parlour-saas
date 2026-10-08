import { AiBudgetExceededError, AiDisabledError, aiConfigured, scanReceipt } from '@spa/ai'
import type { Permission } from '@spa/core'
import { withTenant } from '@spa/db'
import { dubaiToday, fileLink, putFile } from '@spa/services'
import sharp from 'sharp'
import { json, readScanUpload } from '@/components/documents/upload-request'
import { getT } from '@/i18n/server'
import { audit } from '@/server/audit'

/**
 * "Scan receipt" (multipart: file): stores the photo privately (purpose 'receipt'), then asks the vision model for
 * vendor, date, total, VAT, TRN and a category so the expense / purchase form can be prefilled. Without AI (or for
 * PDFs) the receipt is still attached. Used by accounts/expenses/scan and purchases/scan.
 */
export async function receiptScan(req: Request, slug: string, permission: Permission, auditAction: string) {
  const upload = await readScanUpload(req, slug, permission)
  if (upload instanceof Response) return upload
  const { ctx } = upload
  const t = await getT()
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
    action: auditAction,
    entity: 'stored_file',
    entityId: stored.id,
    data: { size: stored.size, contentType: stored.contentType },
  })

  const attached = (status: string, message: string) => json(200, { ok: true, file, status, message })
  if (!aiConfigured()) return attached('unavailable', t('accounts.scan.unavailable'))
  if (!upload.contentType.startsWith('image/')) return attached('pdf', t('accounts.scan.pdf'))

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
        ? t('accounts.scan.currency', { currency: foreign })
        : res.fields.totalAed
          ? t('accounts.scan.read')
          : t('accounts.scan.noTotal'),
      fields: foreign ? { ...res.fields, totalAed: null, vatAed: null } : res.fields,
      ocr: { ...res.fields, model: res.modelKey },
    })
  } catch (e) {
    if (e instanceof AiBudgetExceededError) return attached('budget', t('accounts.scan.budget'))
    if (e instanceof AiDisabledError) return attached('unavailable', t('accounts.scan.disabled'))
    console.error('receipt scan failed', e)
    return attached('failed', t('accounts.scan.failed'))
  }
}
