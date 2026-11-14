'use client'
import { Check, X } from 'lucide-react'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { approveDomainOrderAction, rejectDomainOrderAction } from './actions'

export function OrderActions({
  id,
  domain,
  spa,
  priceUsd,
  retry,
}: {
  id: string
  domain: string
  spa: string
  priceUsd: string
  retry?: boolean
}) {
  const [pending, start] = useTransition()
  const approve = () => {
    if (!window.confirm(`Buy ${domain} for ${spa}? USD ${priceUsd} is charged to the Namecheap balance now.`))
      return
    start(async () => {
      const r = await approveDomainOrderAction(id)
      if (r?.ok) toast.success(r.message ?? 'Bought')
      else if (r) toast.error(r.error)
    })
  }
  const reject = () => {
    const note = window.prompt(`Decline ${domain}? Optional reason for the spa:`, '')
    if (note === null) return
    start(async () => {
      const r = await rejectDomainOrderAction(id, note)
      if (r?.ok) toast.success(r.message ?? 'Declined')
      else if (r) toast.error(r.error)
    })
  }
  return (
    <div className="flex flex-wrap justify-end gap-1.5 md:flex-nowrap [&_button]:h-11 md:[&_button]:h-8">
      <Button size="sm" pending={pending} onClick={approve}>
        {!pending && <Check />} {retry ? 'Retry purchase' : 'Approve & buy'}
      </Button>
      {!retry && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          className="text-danger hover:bg-danger-soft hover:text-danger"
          onClick={reject}
        >
          <X /> Decline
        </Button>
      )}
    </div>
  )
}
