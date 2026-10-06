import { Badge } from '@/components/ui/badge'

const LABEL: Record<string, string> = { open: 'Open', paid: 'Paid', void: 'Void', refunded: 'Refunded' }
const TONE = { open: 'warning', paid: 'success', void: 'neutral', refunded: 'danger' } as const

export function SaleStatusBadge({ status, partRefunded }: { status: string; partRefunded?: boolean }) {
  if (status === 'paid' && partRefunded) return <Badge tone="warning">Part refunded</Badge>
  return <Badge tone={TONE[status as keyof typeof TONE] ?? 'neutral'}>{LABEL[status] ?? status}</Badge>
}
