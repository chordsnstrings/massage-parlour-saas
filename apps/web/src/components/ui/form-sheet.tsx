'use client'
import { useState } from 'react'
import { useT } from '@/i18n/client'
import type { ActionResult } from '@/lib/action'
import { ActionForm, SubmitButton } from './form'
import { Sheet } from './sheet'

/** A sheet containing a server-action form that closes itself on success. */
export function FormSheet({
  title,
  description,
  trigger,
  action,
  submitLabel,
  children,
  className,
}: {
  title: string
  description?: string
  trigger: React.ReactNode
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>
  submitLabel?: string
  children: React.ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const t = useT()
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={title}
      description={description}
      trigger={trigger}
      className={className}
    >
      <ActionForm action={action} onSuccess={() => setOpen(false)} className="space-y-5">
        {children}
        <SubmitButton className="w-full sm:w-auto">{submitLabel ?? t('ui.save')}</SubmitButton>
      </ActionForm>
    </Sheet>
  )
}
