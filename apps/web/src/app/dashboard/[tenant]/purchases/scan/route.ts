import { receiptScan } from '@/server/receipt-scan'

/** POST {app}/{slug}/purchases/scan — "Scan receipt" for a purchase record (server/receipt-scan.ts). */
export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  return receiptScan(req, (await params).tenant, 'inventory.purchase', 'purchase.receipt_uploaded')
}
