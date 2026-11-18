'use client'
import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { resultText, useT } from '@/i18n/client'
import { cn } from '@/lib/utils'
import { saveBranchAction, setBranchActiveAction } from './actions'

type BranchForm = {
  id: string
  name: string
  address: string | null
  mapsUrl: string | null
  phone: string | null
  whatsapp: string | null
  cutoff: string
  areaLabel?: { en: string; ar?: string } | null
}

export function BranchSheet({ slug, branch }: { slug: string; branch?: BranchForm }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={branch ? t('settings.branches.editTitle') : t('settings.branches.addTitle')}
      description={branch ? branch.name : t('settings.branches.addDescription')}
      trigger={
        branch ? (
          <Button variant="ghost" size="sm" aria-label={`${t('settings.branches.edit')} ${branch.name}`}>
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus /> {t('settings.branches.add')}
          </Button>
        )
      }
    >
      <ActionForm
        action={saveBranchAction.bind(null, slug)}
        onSuccess={() => setOpen(false)}
        className="space-y-5"
      >
        <input type="hidden" name="id" value={branch?.id ?? ''} />
        <Field label={t('settings.branches.name')} name="name">
          <Input id="name" name="name" defaultValue={branch?.name} required autoFocus />
        </Field>
        <Field label={t('settings.branches.address')} name="address">
          <Input
            id="address"
            name="address"
            defaultValue={branch?.address ?? ''}
            placeholder={t('settings.profile.addressPlaceholder')}
          />
        </Field>
        <Field
          label={t('settings.branches.mapsUrl')}
          name="mapsUrl"
          hint={t('settings.branches.mapsUrlHint')}
        >
          <Input
            id="mapsUrl"
            name="mapsUrl"
            type="url"
            inputMode="url"
            dir="ltr"
            defaultValue={branch?.mapsUrl ?? ''}
            placeholder="https://maps.app.goo.gl/…"
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('settings.branches.phone')} name="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={branch?.phone ?? ''} />
          </Field>
          <Field label={t('settings.branches.whatsapp')} name="whatsapp">
            <Input
              id="whatsapp"
              name="whatsapp"
              type="tel"
              defaultValue={branch?.whatsapp ?? ''}
              placeholder={t('settings.profile.whatsappPlaceholder')}
            />
          </Field>
        </div>
        <AreaLabelFields value={branch?.areaLabel} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('settings.branches.cutoff')} name="cutoff" hint={t('settings.branches.cutoffHint')}>
            <Input id="cutoff" name="cutoff" type="time" defaultValue={branch?.cutoff ?? '05:00'} required />
          </Field>
          <Field label={t('settings.branches.timezone')} name="timezone">
            <Input id="timezone" value={t('settings.branches.timezoneValue')} disabled readOnly />
          </Field>
        </div>
        <SubmitButton className="w-full">{t('common.save')}</SubmitButton>
      </ActionForm>
    </Sheet>
  )
}

/** R28: the area HTML-design websites show (`spa.area_label`); empty = the city from the address. */
export function AreaLabelFields({
  value,
  className,
}: {
  value?: { en: string; ar?: string } | null
  className?: string
}) {
  const t = useT()
  return (
    <div className={cn('grid gap-5 sm:grid-cols-2', className)}>
      <Field
        label={t('settings.branches.areaLabel')}
        name="areaLabel"
        hint={t('settings.branches.areaLabelHint')}
      >
        <Input id="areaLabel" name="areaLabel" maxLength={80} defaultValue={value?.en ?? ''} />
      </Field>
      <Field
        label={t('settings.branches.areaLabelAr')}
        name="areaLabelAr"
        hint={t('settings.branches.areaLabelArHint')}
      >
        <Input
          id="areaLabelAr"
          name="areaLabelAr"
          dir="rtl"
          lang="ar"
          maxLength={80}
          defaultValue={value?.ar ?? ''}
        />
      </Field>
    </div>
  )
}

export function ArchiveBranchButton({
  slug,
  branchId,
  name,
  active,
}: {
  slug: string
  branchId: string
  name: string
  active: boolean
}) {
  const t = useT()
  const [pending, start] = useTransition()
  const label = active ? t('settings.branches.archive') : t('settings.branches.restore')
  return (
    <Button
      variant="ghost"
      size="sm"
      pending={pending}
      aria-label={`${label} ${name}`}
      title={label}
      onClick={() => {
        if (active && !window.confirm(`${label} ${name}?\n${t('settings.branches.archiveHint')}`)) return
        start(async () => {
          const r = await setBranchActiveAction(slug, branchId, !active)
          if (r?.ok) toast.success(resultText(t, r) ?? '')
          else if (r) toast.error(resultText(t, r) || t('errors.generic'))
        })
      }}
    >
      {active ? <Archive /> : <ArchiveRestore />}
    </Button>
  )
}
