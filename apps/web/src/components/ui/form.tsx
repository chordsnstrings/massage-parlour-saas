'use client'
import { createContext, useContext, useRef, useState, useTransition } from 'react'
import type { ActionResult } from '@/lib/action'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { Label } from './input'
import { toast } from './toast'

type Ctx = { state: ActionResult; pending: boolean }
const FormCtx = createContext<Ctx>({ state: null, pending: false })

/** Server-action form with pending state, field errors and toasts. */
export function ActionForm({
  action,
  children,
  className,
  successMessage,
  resetOnSuccess,
  onSuccess,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>
  children: React.ReactNode
  className?: string
  successMessage?: string
  resetOnSuccess?: boolean
  onSuccess?: (result: Extract<ActionResult, { ok: true }>) => void
}) {
  const [state, setState] = useState<ActionResult>(null)
  const [pending, start] = useTransition()
  const ref = useRef<HTMLFormElement>(null)
  const submit = (fd: FormData) =>
    start(async () => {
      const result = await action(state, fd)
      setState(result)
      // Feedback is fired here rather than in an effect so it survives the form unmounting after revalidation.
      if (!result) return
      if (result.ok) {
        const msg = result.message ?? successMessage
        if (msg) toast.success(msg)
        if (resetOnSuccess) ref.current?.reset()
        onSuccess?.(result)
      } else {
        toast.error(result.error)
      }
    })
  return (
    <FormCtx.Provider value={{ state, pending }}>
      {/* Submitted via a transition instead of `action=` so React doesn't reset the fields when validation fails. */}
      <form
        ref={ref}
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter)
          submit(fd)
        }}
        className={className}
        noValidate
      >
        {children}
      </form>
    </FormCtx.Provider>
  )
}

export function useFormCtx() {
  return useContext(FormCtx)
}

export function SubmitButton({ children, ...props }: React.ComponentProps<typeof Button>) {
  const { pending } = useFormCtx()
  return (
    <Button type="submit" pending={pending} {...props}>
      {children}
    </Button>
  )
}

export function FieldError({ name }: { name: string }) {
  const { state } = useFormCtx()
  const msg = state && !state.ok ? state.fieldErrors?.[name] : undefined
  if (!msg) return null
  return <p className="anim-fade-in text-[13px] text-danger">{msg}</p>
}

/** Label + control + hint + error. */
export function Field({
  label,
  name,
  hint,
  children,
  className,
}: {
  label: React.ReactNode
  name: string
  hint?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={name}>{label}</Label>
      {children}
      {hint && <p className="text-[13px] text-muted">{hint}</p>}
      <FieldError name={name} />
    </div>
  )
}
