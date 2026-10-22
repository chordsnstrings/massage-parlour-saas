'use client'
import { Power, PowerOff, RefreshCw, Trash2 } from 'lucide-react'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { adminDomainAction } from './actions'

export function DomainRowActions({ id, hostname, status }: { id: string; hostname: string; status: string }) {
  const [pending, start] = useTransition()
  const run = (op: 'recheck' | 'activate' | 'deactivate' | 'remove', question?: string) => {
    if (question && !window.confirm(question)) return
    start(async () => {
      const r = await adminDomainAction(id, op)
      if (r?.ok) toast.success(r.message ?? 'Done')
      else if (r) toast.error(r.error)
    })
  }
  return (
    <div className="flex flex-wrap justify-end gap-1.5 md:flex-nowrap [&_button]:h-11 md:[&_button]:h-8">
      <Button variant="secondary" size="sm" pending={pending} onClick={() => run('recheck')}>
        {!pending && <RefreshCw />} Re-check
      </Button>
      {status === 'active' ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          className="text-danger hover:bg-danger-soft hover:text-danger"
          onClick={() =>
            run(
              'deactivate',
              `Deactivate ${hostname}? The spa's site stops answering on it until it is re-checked.`,
            )
          }
        >
          <PowerOff /> Deactivate
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run('activate', `Activate ${hostname} without the DNS checks? This is audited.`)}
        >
          <Power /> Activate
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={`Remove ${hostname}`}
        className="text-danger hover:bg-danger-soft hover:text-danger"
        onClick={() =>
          run(
            'remove',
            `Remove ${hostname} from this spa? The hostname is freed so its real owner can connect it. This is audited.`,
          )
        }
      >
        <Trash2 /> Remove
      </Button>
    </div>
  )
}
