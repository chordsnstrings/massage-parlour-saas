'use client'
import { Ban, Pencil, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { type ClientDetails, ClientDetailsFields } from '@/components/clients/details-fields'
import { PRESSURE_OPTIONS } from '@/components/clients/shared'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import {
  addTreatmentNoteAction,
  setBlocklistAction,
  updateClientAction,
  updatePreferencesAction,
} from '../actions'

export function EditDetailsSheet({
  slug,
  clientId,
  value,
  showPhone,
}: {
  slug: string
  clientId: string
  value: ClientDetails
  showPhone: boolean
}) {
  return (
    <FormSheet
      title="Edit client"
      description="Contact details, tags and notes."
      className="md:max-w-xl"
      action={updateClientAction.bind(null, slug, clientId)}
      trigger={
        <Button variant="secondary">
          <Pencil /> Edit
        </Button>
      }
    >
      <ClientDetailsFields value={value} showPhone={showPhone} full />
    </FormSheet>
  )
}

type Prefs = {
  pressure: string
  oils: string
  allergies: string
  focus: string
  therapistGender: string
  preferredStaffId: string
}

export function PreferencesSheet({
  slug,
  clientId,
  value,
  team,
}: {
  slug: string
  clientId: string
  value: Prefs
  team: { id: string; name: string }[]
}) {
  return (
    <FormSheet
      title="Preferences"
      description="What the therapist should know before the session."
      className="md:max-w-xl"
      action={updatePreferencesAction.bind(null, slug, clientId)}
      trigger={
        <Button variant="ghost" size="sm" className="h-11 sm:h-8">
          <SlidersHorizontal /> Edit
        </Button>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Pressure" name="pressure">
          <Select id="pressure" name="pressure" defaultValue={value.pressure}>
            <option value="">No preference</option>
            {PRESSURE_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Therapist gender" name="therapistGender">
          <Select id="therapistGender" name="therapistGender" defaultValue={value.therapistGender || 'any'}>
            <option value="any">Any</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </Select>
        </Field>
        <Field label="Preferred therapist" name="preferredStaffId" className="sm:col-span-2">
          <Select id="preferredStaffId" name="preferredStaffId" defaultValue={value.preferredStaffId}>
            <option value="">Anyone available</option>
            {team.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Oils" name="oils" className="sm:col-span-2">
          <Input id="oils" name="oils" defaultValue={value.oils} placeholder="e.g. Lavender, unscented" />
        </Field>
        <Field label="Allergies" name="allergies" className="sm:col-span-2">
          <Input id="allergies" name="allergies" defaultValue={value.allergies} placeholder="e.g. Nut oils" />
        </Field>
        <Field label="Focus areas" name="focus" className="sm:col-span-2">
          <Textarea
            id="focus"
            name="focus"
            rows={3}
            defaultValue={value.focus}
            placeholder="e.g. Shoulders and lower back"
          />
        </Field>
      </div>
    </FormSheet>
  )
}

export function BlocklistSheet({
  slug,
  clientId,
  blocklisted,
  reason,
}: {
  slug: string
  clientId: string
  blocklisted: boolean
  reason: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={blocklisted ? 'Remove from blocklist' : 'Blocklist client'}
      description={
        blocklisted
          ? 'The client can book again as normal.'
          : 'The reason is visible to everyone on your team.'
      }
      trigger={
        blocklisted ? (
          <Button variant="secondary" className="w-full">
            <ShieldCheck /> Remove from blocklist
          </Button>
        ) : (
          <Button variant="danger" className="w-full">
            <Ban /> Blocklist client
          </Button>
        )
      }
    >
      <ActionForm
        action={setBlocklistAction.bind(null, slug, clientId)}
        className="space-y-5"
        onSuccess={() => setOpen(false)}
      >
        <input type="hidden" name="blocklisted" value={blocklisted ? 'false' : 'true'} />
        {blocklisted ? (
          reason && <p className="rounded-lg bg-subtle px-3.5 py-3 text-sm text-muted">Reason: {reason}</p>
        ) : (
          <Field label="Reason" name="reason">
            <Textarea
              id="reason"
              name="reason"
              rows={3}
              placeholder="e.g. Repeated no-shows, inappropriate behaviour"
            />
          </Field>
        )}
        <SubmitButton className="w-full" variant={blocklisted ? 'primary' : 'danger'}>
          {blocklisted ? 'Remove from blocklist' : 'Blocklist'}
        </SubmitButton>
      </ActionForm>
    </Sheet>
  )
}

export function TreatmentNoteForm({
  slug,
  clientId,
  visits,
}: {
  slug: string
  clientId: string
  visits: { id: string; label: string }[]
}) {
  return (
    <ActionForm
      action={addTreatmentNoteAction.bind(null, slug, clientId)}
      resetOnSuccess
      className="space-y-3 rounded-xl border p-4"
    >
      <Field label="New note" name="text">
        <Textarea
          id="text"
          name="text"
          rows={3}
          placeholder="Techniques used, tension areas, what to try next time…"
          className="min-h-20"
        />
      </Field>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        {visits.length > 0 && (
          <Field label="Visit" name="bookingId" className="min-w-0 flex-1">
            <Select id="bookingId" name="bookingId" defaultValue="">
              <option value="">Not linked to a visit</option>
              {visits.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <SubmitButton className="h-11 sm:ms-auto sm:h-10">Add note</SubmitButton>
      </div>
    </ActionForm>
  )
}
