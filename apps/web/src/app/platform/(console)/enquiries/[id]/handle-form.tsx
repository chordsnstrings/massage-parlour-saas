'use client'
import type { EnquiryStatus } from '@spa/services'
import { ActionForm, Field, FieldError, SubmitButton } from '@/components/ui/form'
import { Textarea } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action'
import { ENQUIRY_STATUS } from '../status'

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>

/** Status (new / contacted / closed) + internal note; one save, audited by the action. */
export function HandleEnquiryForm({
  action,
  status,
  note,
}: {
  action: Action
  status: EnquiryStatus
  note: string | null
}) {
  return (
    <ActionForm action={action} className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Status</legend>
        {(Object.keys(ENQUIRY_STATUS) as EnquiryStatus[]).map((s) => (
          <label
            key={s}
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-fg"
          >
            <input type="radio" name="status" value={s} defaultChecked={s === status} className="mt-0.5" />
            <span>
              <span className="block font-medium">{ENQUIRY_STATUS[s].label}</span>
              <span className="text-muted">{ENQUIRY_STATUS[s].hint}</span>
            </span>
          </label>
        ))}
        <FieldError name="status" />
      </fieldset>
      <Field label="Internal note" name="note" hint="Only super-admins see this.">
        <Textarea id="note" name="note" rows={4} maxLength={2000} defaultValue={note ?? ''} />
      </Field>
      <SubmitButton>Save</SubmitButton>
    </ActionForm>
  )
}
