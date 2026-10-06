import { aiModelConfig, type Db, platformDb } from '@spa/db'
import { EXPENSE_CODES, normalizeReceipt, type ReceiptFields } from '@spa/services'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { AiDisabledError, runChat } from '../gateway'
import type { ModelArkClient } from '../modelark'

/**
 * Model config used for receipt OCR: the super-admin's 'vision' entry when present and enabled, else the
 * general chat model (Seed 2.0 Lite is multimodal). Model ids always come from ai_model_config.
 */
export const RECEIPT_MODEL_KEYS = ['vision', 'dm_agent'] as const

export async function receiptModelKey(db: Db = platformDb()) {
  const rows = await db
    .select({ key: aiModelConfig.agentKey })
    .from(aiModelConfig)
    .where(
      and(
        inArray(aiModelConfig.agentKey, [...RECEIPT_MODEL_KEYS]),
        eq(aiModelConfig.enabled, true),
        eq(aiModelConfig.kind, 'chat'),
      ),
    )
  const found = new Set(rows.map((r) => r.key))
  return RECEIPT_MODEL_KEYS.find((k) => found.has(k)) ?? null
}

/** Loose on purpose: models write numbers as strings; normalizeReceipt() does the real validation. */
const loose = z.union([z.string(), z.number()]).nullable()
export const ReceiptModelSchema = z.object({
  vendor: z.string().nullable(),
  date: z.string().nullable(),
  total: loose,
  vat: loose,
  trn: loose,
  currency: z.string().nullable(),
  category: z.string().nullable(),
})

/**
 * Reads a receipt photo with a vision model → vendor, date, total, VAT, TRN and a suggested expense category.
 * `image` is a data: URL (JPEG/PNG/WebP). Budget checks and metering go through runChat.
 */
export async function scanReceipt(opts: {
  tenantId: string
  image: string
  today: string
  client?: ModelArkClient
  db?: Db
}): Promise<{
  fields: ReceiptFields
  raw: z.infer<typeof ReceiptModelSchema>
  modelKey: string
  costUsd: number
}> {
  const modelKey = await receiptModelKey(opts.db)
  if (!modelKey) throw new AiDisabledError('Receipt scanning is disabled')
  const categories = EXPENSE_CODES.map((a) => `${a.code} ${a.name}`).join('; ')
  const res = await runChat({
    tenantId: opts.tenantId,
    agentKey: modelKey,
    client: opts.client,
    db: opts.db,
    schema: ReceiptModelSchema,
    temperature: 0,
    maxTokens: 400,
    messages: [
      {
        role: 'system',
        content: `You read receipts and tax invoices for a spa in the UAE. Extract exactly what is printed; use null for anything you can't read. Never guess.
vendor: the business that issued it. date: the invoice date as YYYY-MM-DD (UAE receipts use day/month/year). total: the grand total actually paid, including VAT. vat: the VAT amount (5% in the UAE), null if none shown. trn: the supplier's 15-digit Tax Registration Number (TRN), null if absent. currency: ISO code, usually AED.
category: the best matching expense account code from this list: ${categories}.`,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract the receipt details as JSON.' },
          { type: 'image_url', image_url: { url: opts.image, detail: 'high' } },
        ],
      },
    ],
  })
  const fields = normalizeReceipt(res.output, opts.today)
  if (!fields) throw new Error('unreadable receipt output')
  return { fields, raw: res.output, modelKey, costUsd: res.costUsd }
}
