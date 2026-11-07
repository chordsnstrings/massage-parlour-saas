'use client'
// B5.3 — equipment unit sheet (add / edit / delete), same pattern as RoomSheet.
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input, Select } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { useT } from '@/i18n/client'
import { deleteEquipmentAction, saveEquipmentAction } from './equipment-actions'
import { Toggle, useConfirmAction } from './services-client'

type Option = { id: string; name: string }

export function EquipmentSheet({
  slug,
  branches,
  types,
  unit,
}: {
  slug: string
  branches: Option[]
  /** Existing types, offered as suggestions. */
  types: string[]
  unit?: { id: string; branchId: string; name: string; type: string; active: boolean }
}) {
  const [open, setOpen] = useState(false)
  const { pending, run } = useConfirmAction()
  const t = useT()
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={unit ? t('equipment.edit', { name: unit.name }) : t('equipment.new')}
      description={t('equipment.sheetBody')}
      trigger={
        unit ? (
          <Button variant="ghost" size="sm" aria-label={t('equipment.editAria', { name: unit.name })}>
            <Pencil />
          </Button>
        ) : (
          <Button variant="secondary" size="sm">
            <Plus /> {t('equipment.add')}
          </Button>
        )
      }
    >
      <ActionForm
        action={saveEquipmentAction.bind(null, slug)}
        onSuccess={() => setOpen(false)}
        className="space-y-5"
      >
        <input type="hidden" name="id" value={unit?.id ?? ''} />
        {branches.length > 1 ? (
          <Field label={t('equipment.branch')} name="branchId">
            <Select id="eq-branchId" name="branchId" defaultValue={unit?.branchId ?? branches[0]?.id}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <input type="hidden" name="branchId" value={unit?.branchId ?? branches[0]?.id ?? ''} />
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('equipment.name')} name="name">
            <Input
              id="name"
              name="name"
              defaultValue={unit?.name}
              placeholder={t('equipment.namePlaceholder')}
              required
            />
          </Field>
          <Field label={t('equipment.type')} name="type" hint={t('equipment.typeHint')}>
            <Input
              id="type"
              name="type"
              list="equipment-types"
              defaultValue={unit?.type}
              placeholder={t('equipment.typePlaceholder')}
              required
            />
          </Field>
          <datalist id="equipment-types">
            {types.map((ty) => (
              <option key={ty} value={ty} />
            ))}
          </datalist>
        </div>
        <Toggle
          name="active"
          label={t('services.form.active')}
          hint={t('equipment.activeHint')}
          defaultChecked={unit?.active ?? true}
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {unit ? (
            <Button
              type="button"
              variant="ghost"
              className="text-danger"
              pending={pending}
              onClick={() =>
                run(
                  t('equipment.confirmDelete', { name: unit.name }),
                  () => deleteEquipmentAction(slug, unit.id),
                  () => setOpen(false),
                )
              }
            >
              <Trash2 /> {t('common.delete')}
            </Button>
          ) : (
            <span />
          )}
          <SubmitButton>{t(unit ? 'equipment.save' : 'equipment.submitAdd')}</SubmitButton>
        </div>
      </ActionForm>
    </Sheet>
  )
}
