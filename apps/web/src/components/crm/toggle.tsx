'use client'
import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * On/off switch (`button role="switch"`). Controlled (`checked` + `onChange`) or uncontrolled (`defaultChecked`).
 * With `name` it also submits `name=on|off` in a surrounding form. `label` is the accessible name (translated).
 */
export function Toggle({
  label,
  checked,
  defaultChecked,
  onChange,
  name,
  disabled,
  className,
}: {
  label: string
  checked?: boolean
  defaultChecked?: boolean
  onChange?: (next: boolean) => void
  name?: string
  disabled?: boolean
  className?: string
}) {
  const [own, setOwn] = useState(defaultChecked ?? false)
  const on = checked ?? own
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        className={cn('crm-toggle', className)}
        onClick={() => {
          if (checked === undefined) setOwn(!on)
          onChange?.(!on)
        }}
      />
      {name && <input type="hidden" name={name} value={on ? 'on' : 'off'} />}
    </>
  )
}
