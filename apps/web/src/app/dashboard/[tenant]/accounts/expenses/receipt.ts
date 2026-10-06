import { storedFiles, type Tx } from '@spa/db'
import { fileLink } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

/** Optional receipt fields posted with the expense form after "Scan receipt". */
export const receiptFields = {
  receiptFileId: z
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  ocr: z.string().max(4000).optional(),
}

const OcrSchema = z
  .object({
    vendor: z.string().max(120).nullable(),
    date: z.string().max(10).nullable(),
    totalAed: z.number().nullable(),
    vatAed: z.number().nullable(),
    trn: z.string().max(15).nullable(),
    currency: z.string().max(8).nullable(),
    category: z.string().max(4).nullable(),
    model: z.string().max(40).optional(),
  })
  .partial()

/**
 * Receipt columns for a new expense: the file must be one of this tenant's receipts (RLS-scoped lookup);
 * the OCR result is kept as read (validated shape), so later edits to the form don't rewrite what was scanned.
 */
export async function receiptColumns(tx: Tx, fileId?: string, ocr?: string) {
  if (!fileId) return {}
  const [file] = await tx
    .select({ id: storedFiles.id })
    .from(storedFiles)
    .where(and(eq(storedFiles.id, fileId), eq(storedFiles.purpose, 'receipt')))
  if (!file) return {}
  let parsed: z.infer<typeof OcrSchema> | null = null
  try {
    const result = OcrSchema.safeParse(ocr ? JSON.parse(ocr) : null)
    parsed = result.success ? result.data : null
  } catch {
    parsed = null
  }
  return { receiptUrl: fileLink(file.id), ocr: parsed }
}
