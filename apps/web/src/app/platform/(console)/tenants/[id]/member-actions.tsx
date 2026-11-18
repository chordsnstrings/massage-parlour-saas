'use client'
import { Trash2 } from 'lucide-react'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { removeMemberAction } from '../../actions'

/** R42: remove a team member from the spa (asks first; the server decides what happens to the login). */
export function RemoveMemberButton({
  tenantId,
  memberId,
  name,
}: {
  tenantId: string
  memberId: string
  name: string
}) {
  const [pending, start] = useTransition()
  const remove = () => {
    if (!window.confirm(`Remove ${name} from this spa's team? They lose access at once. This is audited.`))
      return
    start(async () => {
      const r = await removeMemberAction(tenantId, memberId)
      if (r?.ok) toast.success(r.message ?? 'Removed')
      else if (r) toast.error(r.error)
    })
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      pending={pending}
      aria-label={`Delete ${name}`}
      className="text-danger hover:bg-danger-soft hover:text-danger"
      onClick={remove}
    >
      {!pending && <Trash2 />} Delete
    </Button>
  )
}
