'use client'
import { CreditCard } from 'lucide-react'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n/client'
import { cn } from '@/lib/utils'
import { payInvoiceByCardAction } from './actions'

export function PayByCardButton({
  slug,
  invoiceId,
  label,
  wide,
}: {
  slug: string
  invoiceId: string
  label: string
  wide?: boolean
}) {
  const t = useT()
  const [pending, start] = useTransition()
  return (
    <Button
      size={wide ? 'md' : 'sm'}
      pending={pending}
      className={cn(wide ? 'w-full' : 'h-11 sm:h-8')}
      onClick={() =>
        start(async () => {
          const r = await payInvoiceByCardAction(slug, invoiceId)
          if (r.ok) window.location.assign(r.url)
          else toast.error(t.maybe(r.error) ?? r.error)
        })
      }
    >
      {!pending && <CreditCard />} {label}
    </Button>
  )
}
