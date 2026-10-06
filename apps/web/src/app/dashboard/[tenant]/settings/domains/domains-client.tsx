'use client'
import { ExternalLink, RefreshCw, Star, Trash2 } from 'lucide-react'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { ActionForm, FieldError, SubmitButton } from '@/components/ui/form'
import { Input, Label } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import type { ActionResult } from '@/lib/action'
import { addDomainAction, checkDomainAction, removeDomainAction, setPrimaryDomainAction } from './actions'

function useRun() {
  const [pending, start] = useTransition()
  const run = (fn: () => Promise<ActionResult>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return
    start(async () => {
      const r = await fn()
      if (r?.ok) {
        if (r.message) toast.success(r.message)
      } else if (r) toast.error(r.error)
    })
  }
  return { pending, run }
}

export function AddDomainForm({ slug }: { slug: string }) {
  return (
    <ActionForm action={addDomainAction.bind(null, slug)} resetOnSuccess className="space-y-1.5">
      <Label htmlFor="hostname">Your domain</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="hostname"
          name="hostname"
          placeholder="www.yourspa.ae"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="url"
          dir="ltr"
          className="h-11 sm:flex-1"
        />
        <SubmitButton size="lg" className="sm:w-auto">
          Add domain
        </SubmitButton>
      </div>
      <FieldError name="hostname" />
      <p className="text-[13px] text-muted">
        A domain you already own. We recommend the www version — you can forward the bare domain to it.
      </p>
    </ActionForm>
  )
}

export function DomainActions({
  slug,
  id,
  hostname,
  status,
  isPrimary,
}: {
  slug: string
  id: string
  hostname: string
  status: string
  isPrimary: boolean
}) {
  const { pending, run } = useRun()
  const active = status === 'active'
  return (
    <div className="flex flex-wrap gap-2 [&_button]:h-11 [&_a]:h-11 sm:[&_button]:h-10 sm:[&_a]:h-10">
      <Button
        variant={active ? 'secondary' : 'primary'}
        pending={pending}
        onClick={() => run(() => checkDomainAction(slug, id))}
      >
        {!pending && <RefreshCw />} Check now
      </Button>
      {active && !isPrimary && (
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => run(() => setPrimaryDomainAction(slug, id))}
        >
          <Star /> Make primary
        </Button>
      )}
      {active && (
        <Button variant="ghost" asChild>
          <a href={`https://${hostname}`} target="_blank" rel="noreferrer">
            <ExternalLink /> Open site
          </a>
        </Button>
      )}
      <Button
        variant="ghost"
        className="text-danger hover:bg-danger-soft hover:text-danger sm:ms-auto"
        disabled={pending}
        onClick={() =>
          run(
            () => removeDomainAction(slug, id),
            `Remove ${hostname}? Your site will stop answering on this address. You can add it again later.`,
          )
        }
      >
        <Trash2 /> Remove
      </Button>
    </div>
  )
}

export function SubdomainPrimaryButton({ slug }: { slug: string }) {
  const { pending, run } = useRun()
  return (
    <Button
      variant="secondary"
      size="sm"
      className="h-11 sm:h-8"
      pending={pending}
      onClick={() => run(() => setPrimaryDomainAction(slug, null))}
    >
      Make primary
    </Button>
  )
}
