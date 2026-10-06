'use client'
import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Label, Select } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import type { ActionResult } from '@/lib/action'

/** "Belongs to" filter: navigates on change, so the list stays a server-rendered, shareable URL. */
export function OwnerFilter({
  value,
  options,
  hrefFor,
}: {
  value: string
  options: { value: string; label: string }[]
  hrefFor: Record<string, string>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <div className="flex items-center gap-3">
      <Label htmlFor="doc-owner" className="shrink-0 text-muted">
        Belongs to
      </Label>
      <Select
        id="doc-owner"
        value={value}
        aria-busy={pending}
        className="min-h-11 w-full sm:min-h-10 sm:w-56"
        onChange={(e) => {
          const href = hrefFor[e.target.value]
          if (href) start(() => router.push(href, { scroll: false }))
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  )
}

/** Two-step delete: the first tap arms it, the second removes the document and its scan. */
export function DeleteDocumentButton({ action }: { action: () => Promise<ActionResult> }) {
  const [armed, setArmed] = useState(false)
  const [pending, start] = useTransition()
  return (
    <Button
      variant={armed ? 'danger' : 'ghost'}
      size="sm"
      pending={pending}
      aria-label={armed ? 'Confirm delete' : 'Delete document'}
      className="min-h-11 md:min-h-8"
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) return setArmed(true)
        start(async () => {
          const r = await action()
          if (r?.ok) toast.success(r.message ?? 'Deleted')
          else if (r) toast.error(r.error)
          setArmed(false)
        })
      }}
    >
      {armed ? 'Delete?' : <Trash2 />}
    </Button>
  )
}
