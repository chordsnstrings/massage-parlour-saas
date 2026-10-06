'use client'
import { useState, useTransition } from 'react'
import { connectInstagramAction, disconnectInstagramAction } from '@/app/api/integrations/meta/actions'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { InstagramGlyph } from '../inbox/icons'

export function InstagramConnectButton({
  slug,
  label = 'Connect Instagram',
  variant = 'primary',
}: {
  slug: string
  label?: string
  variant?: 'primary' | 'secondary'
}) {
  const [pending, start] = useTransition()
  return (
    <Button
      variant={variant}
      className="min-h-11"
      pending={pending}
      onClick={() =>
        start(async () => {
          const r = await connectInstagramAction(slug)
          if (r?.ok && typeof r.data?.url === 'string') window.location.assign(r.data.url)
          else if (r && !r.ok) toast.error(r.error)
        })
      }
    >
      {!pending && <InstagramGlyph />}
      {label}
    </Button>
  )
}

export function InstagramDisconnectButton({ slug, username }: { slug: string; username: string | null }) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="Disconnect Instagram?"
      description={`${username ? `@${username}` : 'The account'} stops syncing: the AI no longer answers DMs or comments and scheduled posts are not published. Conversations stay in the inbox.`}
      trigger={
        <Button variant="ghost" className="min-h-11 text-danger hover:text-danger">
          Disconnect
        </Button>
      }
    >
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" className="min-h-11" onClick={() => setOpen(false)}>
          Keep connected
        </Button>
        <Button
          variant="danger"
          className="min-h-11"
          pending={pending}
          onClick={() =>
            start(async () => {
              const r = await disconnectInstagramAction(slug)
              if (r?.ok) {
                toast.success(r.message ?? 'Disconnected')
                setOpen(false)
              } else if (r) toast.error(r.error)
            })
          }
        >
          Disconnect
        </Button>
      </div>
    </Sheet>
  )
}
