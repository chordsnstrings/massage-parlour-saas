import { receiptScan } from '@/server/receipt-scan'

/** POST {app}/{slug}/accounts/expenses/scan — "Scan receipt" for an expense (server/receipt-scan.ts). */
export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  return receiptScan(req, (await params).tenant, 'accounting.manage', 'expense.receipt_uploaded')
}
