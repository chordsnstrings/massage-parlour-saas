'use client'
// B5.4 — kiosk tiles (PIN sheet) and leave decision buttons.
import { Check, LogIn, LogOut, X } from 'lucide-react'
import { useState } from 'react'
import { Avatar } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { useT } from '@/i18n/client'
import { useConfirmAction } from '../services/services-client'
import { decideLeaveAction, punchAction, withdrawLeaveAction } from './actions'

export function KioskTile({
  slug,
  branchId,
  person,
}: {
  slug: string
  branchId: string
  /** `since` = formatted clock-in time when clocked in. */
  person: { id: string; name: string; color: string; since: string | null; hasPin: boolean }
}) {
  const [open, setOpen] = useState(false)
  const t = useT()
  const status = person.since
    ? t('timeclock.kiosk.in', { time: person.since })
    : person.hasPin
      ? t('timeclock.kiosk.out')
      : t('timeclock.kiosk.noPin')
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={person.name}
      description={t('timeclock.kiosk.sheetBody')}
      trigger={
        <button
          type="button"
          disabled={!person.hasPin}
          aria-label={`${person.name} — ${status}`}
          className="crm-card flex min-h-20 w-full items-center gap-3 text-start transition-shadow hover:shadow-soft disabled:opacity-60"
          data-state={person.since ? 'in' : 'out'}
        >
          <Avatar name={person.name} color={person.color} />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{person.name}</span>
            <span className={person.since ? 'block text-xs text-accent' : 'crm-muted block text-xs'}>
              {status}
            </span>
          </span>
          <span className="ms-auto text-muted" aria-hidden>
            {person.since ? <LogOut className="size-4" /> : <LogIn className="size-4" />}
          </span>
        </button>
      }
    >
      <ActionForm
        action={punchAction.bind(null, slug)}
        onSuccess={() => setOpen(false)}
        className="space-y-5"
      >
        <input type="hidden" name="staffId" value={person.id} />
        <input type="hidden" name="branchId" value={branchId} />
        <Field label={t('timeclock.kiosk.pin')} name="pin">
          <Input
            id="pin"
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="\d{4,8}"
            maxLength={8}
            required
            autoFocus
          />
        </Field>
        <SubmitButton className="w-full">
          {person.since ? t('timeclock.kiosk.submitOut') : t('timeclock.kiosk.submitIn')}
        </SubmitButton>
      </ActionForm>
    </Sheet>
  )
}

export function LeaveButtons({
  slug,
  id,
  canDecide,
  canWithdraw,
}: {
  slug: string
  id: string
  canDecide: boolean
  canWithdraw: boolean
}) {
  const { pending, run } = useConfirmAction()
  const t = useT()
  return (
    <span className="flex flex-wrap justify-end gap-1.5">
      {canDecide && (
        <>
          <Button
            size="sm"
            pending={pending}
            onClick={() => run(null, () => decideLeaveAction(slug, id, 'approved'))}
          >
            <Check /> {t('timeclock.leave.approve')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            pending={pending}
            onClick={() => run(null, () => decideLeaveAction(slug, id, 'rejected'))}
          >
            <X /> {t('timeclock.leave.reject')}
          </Button>
        </>
      )}
      {canWithdraw && (
        <Button
          size="sm"
          variant="ghost"
          pending={pending}
          onClick={() => run(t('timeclock.leave.confirmWithdraw'), () => withdrawLeaveAction(slug, id))}
        >
          {t('timeclock.leave.withdraw')}
        </Button>
      )}
    </span>
  )
}
