'use client'
import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Label, Select } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { resultText, useT } from '@/i18n/client'
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
  const t = useT()
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <div className="flex items-center gap-3">
      <Label htmlFor="doc-owner" className="shrink-0 text-muted">
        {t('documents.filter.belongsTo')}
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
  const t = useT()
  const [armed, setArmed] = useState(false)
  const [pending, start] = useTransition()
  return (
    <Button
      variant={armed ? 'danger' : 'ghost'}
      size="sm"
      pending={pending}
      aria-label={armed ? t('documents.confirmDelete') : t('documents.delete')}
      className="min-h-11 md:min-h-8"
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) return setArmed(true)
        start(async () => {
          const r = await action()
          if (r?.ok) toast.success(resultText(t, r) ?? t('documents.result.deleted'))
          else if (r) toast.error(resultText(t, r) ?? t('errors.generic'))
          setArmed(false)
        })
      }}
    >
      {armed ? t('documents.deleteQ') : <Trash2 />}
    </Button>
  )
}
