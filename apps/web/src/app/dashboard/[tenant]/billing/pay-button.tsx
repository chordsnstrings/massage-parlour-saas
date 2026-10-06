'use client'
import { CreditCard } from 'lucide-react'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { payInvoiceByCardAction } from './actions'

export function PayByCardButton({ slug, invoiceId }: { slug: string; invoiceId: string }) {
  const [pending, start] = useTransition()
  return (
    <Button
      size="sm"
      pending={pending}
      className="h-11 sm:h-8"
      onClick={() =>
        start(async () => {
          const r = await payInvoiceByCardAction(slug, invoiceId)
          if (r.ok) window.location.assign(r.url)
          else toast.error(r.error)
        })
      }
    >
      {!pending && <CreditCard />} Pay by card
    </Button>
  )
}
