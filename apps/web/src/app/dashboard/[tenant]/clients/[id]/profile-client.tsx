'use client'
import { enumLabel } from '@spa/core/i18n'
import { Ban, Download, Eraser, Pencil, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { type ClientDetails, ClientDetailsFields } from '@/components/clients/details-fields'
import { PRESSURE_OPTIONS } from '@/components/clients/shared'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, FieldError, SubmitButton } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { useT } from '@/i18n/client'
import {
  addTreatmentNoteAction,
  eraseClientAction,
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
  const t = useT()
  return (
    <FormSheet
      title={t('clients.editSheet.title')}
      description={t('clients.editSheet.sub')}
      className="md:max-w-xl"
      action={updateClientAction.bind(null, slug, clientId)}
      trigger={
        <Button variant="secondary">
          <Pencil /> {t('common.edit')}
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
  const t = useT()
  return (
    <FormSheet
      title={t('clients.prefs.title')}
      description={t('clients.prefs.sub')}
      className="md:max-w-xl"
      action={updatePreferencesAction.bind(null, slug, clientId)}
      trigger={
        <Button variant="ghost" size="sm" className="h-11 sm:h-8">
          <SlidersHorizontal /> {t('common.edit')}
        </Button>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('clients.prefs.pressure')} name="pressure">
          <Select id="pressure" name="pressure" defaultValue={value.pressure}>
            <option value="">{t('clients.prefs.noPreference')}</option>
            {PRESSURE_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {t(`clients.prefs.pressureOption.${p}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('clients.prefs.therapistGender')} name="therapistGender">
          <Select id="therapistGender" name="therapistGender" defaultValue={value.therapistGender || 'any'}>
            <option value="any">{t('clients.prefs.any')}</option>
            <option value="female">{enumLabel(t, 'staffGender', 'female')}</option>
            <option value="male">{enumLabel(t, 'staffGender', 'male')}</option>
          </Select>
        </Field>
        <Field
          label={t('clients.prefs.preferredTherapist')}
          name="preferredStaffId"
          className="sm:col-span-2"
        >
          <Select id="preferredStaffId" name="preferredStaffId" defaultValue={value.preferredStaffId}>
            <option value="">{t('clients.prefs.anyone')}</option>
            {team.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('clients.prefs.oils')} name="oils" className="sm:col-span-2">
          <Input
            id="oils"
            name="oils"
            defaultValue={value.oils}
            placeholder={t('clients.prefs.oilsPlaceholder')}
          />
        </Field>
        <Field label={t('clients.prefs.allergies')} name="allergies" className="sm:col-span-2">
          <Input
            id="allergies"
            name="allergies"
            defaultValue={value.allergies}
            placeholder={t('clients.prefs.allergiesPlaceholder')}
          />
        </Field>
        <Field label={t('clients.prefs.focus')} name="focus" className="sm:col-span-2">
          <Textarea
            id="focus"
            name="focus"
            rows={3}
            defaultValue={value.focus}
            placeholder={t('clients.prefs.focusPlaceholder')}
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
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={blocklisted ? t('clients.blocklist.remove') : t('clients.blocklist.add')}
      description={blocklisted ? t('clients.blocklist.removeSub') : t('clients.blocklist.addSub')}
      trigger={
        blocklisted ? (
          <Button variant="secondary" className="w-full">
            <ShieldCheck /> {t('clients.blocklist.remove')}
          </Button>
        ) : (
          <Button variant="danger" className="w-full">
            <Ban /> {t('clients.blocklist.add')}
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
          reason && (
            <p className="rounded-lg bg-subtle px-3.5 py-3 text-sm text-muted">
              {t('clients.blocklist.reasonValue', { reason })}
            </p>
          )
        ) : (
          <Field label={t('clients.blocklist.reason')} name="reason">
            <Textarea
              id="reason"
              name="reason"
              rows={3}
              placeholder={t('clients.blocklist.reasonPlaceholder')}
            />
          </Field>
        )}
        <SubmitButton className="w-full" variant={blocklisted ? 'primary' : 'danger'}>
          {blocklisted ? t('clients.blocklist.remove') : t('clients.blocklist.submit')}
        </SubmitButton>
      </ActionForm>
    </Sheet>
  )
}

/** G12: owner-only erase of one client's personal data (financial records stay). */
export function EraseClientSheet({
  slug,
  clientId,
  exportHref,
}: {
  slug: string
  clientId: string
  exportHref: string | null
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('clients.erase.button')}
      description={t('clients.erase.sheetSub')}
      trigger={
        <Button variant="danger" className="w-full">
          <Eraser /> {t('clients.erase.button')}
        </Button>
      }
    >
      <ActionForm
        action={eraseClientAction.bind(null, slug, clientId)}
        className="space-y-5"
        onSuccess={() => setOpen(false)}
      >
        <div className="space-y-2.5 rounded-lg bg-subtle px-3.5 py-3 text-sm text-muted">
          <p>{t('clients.erase.removes')}</p>
          <p>{t('clients.erase.keeps')}</p>
        </div>
        {exportHref && (
          <Button variant="secondary" className="w-full" asChild>
            <a href={exportHref}>
              <Download /> {t('clients.erase.export')}
            </a>
          </Button>
        )}
        <div className="space-y-1.5">
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox name="confirm" id="erase-confirm" className="mt-0.5" />
            {t('clients.erase.confirm')}
          </label>
          <FieldError name="confirm" />
        </div>
        <SubmitButton className="w-full" variant="danger">
          {t('clients.erase.submit')}
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
  const t = useT()
  return (
    <ActionForm
      action={addTreatmentNoteAction.bind(null, slug, clientId)}
      resetOnSuccess
      className="space-y-3 rounded-xl border p-4"
    >
      <Field label={t('clients.notes.new')} name="text">
        <Textarea
          id="text"
          name="text"
          rows={3}
          placeholder={t('clients.notes.placeholder')}
          className="min-h-20"
        />
      </Field>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        {visits.length > 0 && (
          <Field label={t('clients.notes.visit')} name="bookingId" className="min-w-0 flex-1">
            <Select id="bookingId" name="bookingId" defaultValue="">
              <option value="">{t('clients.notes.unlinked')}</option>
              {visits.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <SubmitButton className="h-11 sm:ms-auto sm:h-10">{t('clients.notes.add')}</SubmitButton>
      </div>
    </ActionForm>
  )
}
