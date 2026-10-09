'use client'
import { Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, useTransition } from 'react'
import { ImageInput } from '@/components/media/image-input'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, FieldError, SubmitButton } from '@/components/ui/form'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { resultText, useT } from '@/i18n/client'
import type { ActionResult } from '@/lib/action'
import {
  addSampleMenuAction,
  deleteCategoryAction,
  deleteRoomAction,
  deleteServiceAction,
  saveCategoryAction,
  saveRoomAction,
  saveServiceAction,
} from './actions'
import { ROOM_TYPES, SWATCHES } from './constants'

type Option = { id: string; name: string }

/** Optional confirm → run the action → toast its result in the viewer's language (shared by services + staff). */
export function useConfirmAction() {
  const [pending, start] = useTransition()
  const t = useT()
  const run = (question: string | null, fn: () => Promise<ActionResult>, after?: () => void) => {
    if (question && !window.confirm(question)) return
    start(async () => {
      const r = await fn()
      if (r?.ok) {
        if (r.message || r.key) toast.success(resultText(t, r) ?? '')
        after?.()
      } else if (r) toast.error(resultText(t, r) || t('errors.generic'))
    })
  }
  return { pending, run }
}

export function SampleMenuButton({ slug }: { slug: string }) {
  const { pending, run } = useConfirmAction()
  const t = useT()
  return (
    <Button pending={pending} onClick={() => run(null, () => addSampleMenuAction(slug))}>
      <Sparkles /> {t('services.sampleMenu')}
    </Button>
  )
}

/** A row of toggle-chips backed by real checkboxes (so they post with the form). */
export function ChipCheckbox({
  name,
  value,
  label,
  defaultChecked,
}: {
  name: string
  value: string
  label: string
  defaultChecked?: boolean
}) {
  return (
    <label className="relative inline-flex min-h-11 cursor-pointer items-center sm:min-h-9">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="peer sr-only"
      />
      <span className="rounded-full border px-3.5 py-1.5 text-sm text-muted transition-colors peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent peer-focus-visible:ring-4 peer-focus-visible:ring-accent/15 hover:border-fg/20">
        {label}
      </span>
    </label>
  )
}

export function ColorPicker({ name, defaultValue }: { name: string; defaultValue?: string | null }) {
  const t = useT()
  const initial = defaultValue ?? SWATCHES[0]
  return (
    // The surrounding <fieldset><legend> names the group.
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {SWATCHES.map((c, i) => (
        <label key={c} className="relative grid size-11 cursor-pointer place-items-center sm:size-9">
          <input
            type="radio"
            name={name}
            value={c}
            defaultChecked={c === initial}
            className="peer sr-only"
            aria-label={t('common.colourSwatch', { n: i + 1, total: SWATCHES.length })}
          />
          <span
            className="size-7 rounded-full ring-offset-2 ring-offset-surface transition-transform peer-checked:ring-2 peer-checked:ring-fg/70 peer-focus-visible:ring-2 peer-focus-visible:ring-accent hover:scale-110 motion-reduce:transition-none"
            style={{ background: c }}
          />
        </label>
      ))}
    </div>
  )
}

export function Toggle({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string
  label: string
  hint?: string
  defaultChecked?: boolean
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors hover:bg-subtle/50">
      <Checkbox name={name} defaultChecked={defaultChecked} className="mt-0.5" />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-[13px] text-muted">{hint}</span>}
      </span>
    </label>
  )
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export function CategorySheet({
  slug,
  category,
}: {
  slug: string
  category?: { id: string; en: string; ar?: string }
}) {
  const [open, setOpen] = useState(false)
  const { pending, run } = useConfirmAction()
  const t = useT()
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t(category ? 'services.category.edit' : 'services.category.new')}
      description={t('services.category.sheetBody')}
      trigger={
        category ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('services.category.editAria', { name: category.en })}
          >
            <Pencil /> <span className="hidden sm:inline">{t('common.edit')}</span>
          </Button>
        ) : (
          <Button variant="secondary">
            <Plus /> {t('services.category.add')}
          </Button>
        )
      }
    >
      <ActionForm
        action={saveCategoryAction.bind(null, slug)}
        onSuccess={() => setOpen(false)}
        className="space-y-5"
      >
        <input type="hidden" name="id" value={category?.id ?? ''} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('services.form.nameEn')} name="nameEn">
            <Input id="nameEn" name="nameEn" defaultValue={category?.en} placeholder="Massage" required />
          </Field>
          <Field label={t('services.form.nameAr')} name="nameAr">
            <Input
              id="nameAr"
              name="nameAr"
              dir="rtl"
              lang="ar"
              defaultValue={category?.ar}
              placeholder="مساج"
            />
          </Field>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {category ? (
            <Button
              type="button"
              variant="ghost"
              className="text-danger"
              pending={pending}
              onClick={() =>
                run(
                  t('services.category.confirmDelete'),
                  () => deleteCategoryAction(slug, category.id),
                  () => setOpen(false),
                )
              }
            >
              <Trash2 /> {t('common.delete')}
            </Button>
          ) : (
            <span />
          )}
          <SubmitButton>{t(category ? 'common.save' : 'services.category.submitAdd')}</SubmitButton>
        </div>
      </ActionForm>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export type ServiceInput = {
  id: string
  categoryId: string | null
  name: { en: string; ar?: string }
  description: { en: string; ar?: string } | null
  bufferBeforeMin: number
  bufferAfterMin: number
  therapistsRequired: number
  roomTypes: string[]
  equipmentTypes: string[]
  onlineBookable: boolean
  showPrice: boolean | null
  active: boolean
  color: string | null
  imageUrl?: string | null
  variants: { id: string; durationMin: number; priceAed: number | null }[]
}

type VariantRow = { key: string; id?: string; durationMin: string; priceAed: string }
let rowSeq = 0
const newRow = (durationMin = '60', priceAed = ''): VariantRow => ({
  key: `new-${++rowSeq}`,
  durationMin,
  priceAed,
})

export function ServiceSheet({
  slug,
  categories,
  service,
  equipmentTypes = [],
  variant = 'primary',
}: {
  slug: string
  categories: Option[]
  service?: ServiceInput
  /** Equipment types the spa has (B5.3), offered as requirements. */
  equipmentTypes?: string[]
  variant?: 'primary' | 'secondary'
}) {
  const [open, setOpen] = useState(false)
  const t = useT()
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={service ? service.name.en : t('services.service.new')}
      description={t(service ? 'services.service.editBody' : 'services.service.newBody')}
      className="md:max-w-2xl"
      trigger={
        service ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('services.service.editAria', { name: service.name.en })}
          >
            <Pencil /> <span className="hidden sm:inline">{t('common.edit')}</span>
          </Button>
        ) : (
          <Button variant={variant}>
            <Plus /> {t('services.service.add')}
          </Button>
        )
      }
    >
      <ServiceForm
        slug={slug}
        categories={categories}
        service={service}
        equipmentTypes={equipmentTypes}
        onDone={() => setOpen(false)}
      />
    </Sheet>
  )
}

function ServiceForm({
  slug,
  categories,
  service,
  equipmentTypes,
  onDone,
}: {
  slug: string
  categories: Option[]
  service?: ServiceInput
  equipmentTypes: string[]
  onDone: () => void
}) {
  const kitTypes = [...new Set([...equipmentTypes, ...(service?.equipmentTypes ?? [])])].sort()
  const [rows, setRows] = useState<VariantRow[]>(() =>
    service?.variants.length
      ? service.variants.map((v) => ({
          key: v.id,
          id: v.id,
          durationMin: String(v.durationMin),
          priceAed: v.priceAed == null ? '' : String(v.priceAed),
        }))
      : [newRow('60'), newRow('90')],
  )
  const { pending, run } = useConfirmAction()
  const t = useT()
  const set = (key: string, patch: Partial<VariantRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  return (
    <ActionForm action={saveServiceAction.bind(null, slug)} onSuccess={onDone} className="space-y-6">
      <input type="hidden" name="id" value={service?.id ?? ''} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('services.form.nameEn')} name="nameEn">
          <Input
            id="nameEn"
            name="nameEn"
            defaultValue={service?.name.en}
            placeholder="Swedish massage"
            required
          />
        </Field>
        <Field label={t('services.form.nameAr')} name="nameAr">
          <Input
            id="nameAr"
            name="nameAr"
            dir="rtl"
            lang="ar"
            defaultValue={service?.name.ar}
            placeholder="مساج سويدي"
          />
        </Field>
        <Field label={t('services.form.descriptionEn')} name="descriptionEn">
          <Textarea
            id="descriptionEn"
            name="descriptionEn"
            rows={3}
            defaultValue={service?.description?.en}
          />
        </Field>
        <Field label={t('services.form.descriptionAr')} name="descriptionAr">
          <Textarea
            id="descriptionAr"
            name="descriptionAr"
            dir="rtl"
            lang="ar"
            rows={3}
            defaultValue={service?.description?.ar}
          />
        </Field>
        <div className="sm:col-span-2">
          <ImageInput
            slug={slug}
            name="imageUrl"
            label={t('services.form.photo')}
            hint={t('services.form.photoHint')}
            defaultValue={service?.imageUrl}
          />
        </div>
        <Field label={t('services.form.category')} name="categoryId">
          <Select
            id="categoryId"
            name="categoryId"
            defaultValue={service?.categoryId ?? categories[0]?.id ?? ''}
          >
            <option value="">{t('services.uncategorised')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('services.form.therapists')} name="therapistsRequired">
          <Select
            id="therapistsRequired"
            name="therapistsRequired"
            defaultValue={String(service?.therapistsRequired ?? 1)}
          >
            <option value="1">{t('services.form.therapistsOne')}</option>
            <option value="2">{t('services.form.therapistsTwo')}</option>
          </Select>
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-[13px] font-medium">{t('services.form.durations')}</legend>
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {rows.map((r, i) => (
              <motion.li
                key={r.key}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-1"
              >
                <div className="flex items-center gap-2">
                  <input type="hidden" name="variantId" value={r.id ?? ''} />
                  <div className="relative flex-1">
                    <Input
                      aria-label={t('services.form.durationAria', { n: i + 1 })}
                      name="variantDuration"
                      inputMode="numeric"
                      value={r.durationMin}
                      onChange={(e) => set(r.key, { durationMin: e.target.value })}
                      className="pe-12 tabular-nums"
                    />
                    <span className="pointer-events-none absolute inset-y-0 end-3 grid place-items-center text-sm text-muted">
                      {t('services.form.min')}
                    </span>
                  </div>
                  <div className="relative flex-1">
                    <span className="pointer-events-none absolute inset-y-0 start-3 grid place-items-center text-sm text-muted">
                      AED
                    </span>
                    <Input
                      aria-label={t('services.form.priceAria', { n: i + 1 })}
                      name="variantPrice"
                      inputMode="decimal"
                      value={r.priceAed}
                      placeholder={t('services.form.pricePh')}
                      onChange={(e) => set(r.key, { priceAed: e.target.value })}
                      className="ps-12 tabular-nums"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('services.form.removeDuration')}
                    disabled={rows.length === 1}
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  >
                    <X />
                  </Button>
                </div>
                <FieldError name={`variants.${i}`} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        <FieldError name="variants" />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            const last = Number(rows.at(-1)?.durationMin) || 60
            setRows((rs) => [...rs, newRow(String(last + 30))])
          }}
        >
          <Plus /> {t('services.form.addDuration')}
        </Button>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label={t('services.form.bufferBefore')}
          name="bufferBeforeMin"
          hint={t('services.form.bufferBeforeHint')}
        >
          <Input
            id="bufferBeforeMin"
            name="bufferBeforeMin"
            type="number"
            min={0}
            max={120}
            step={5}
            defaultValue={service?.bufferBeforeMin ?? 0}
          />
        </Field>
        <Field
          label={t('services.form.bufferAfter')}
          name="bufferAfterMin"
          hint={t('services.form.bufferAfterHint')}
        >
          <Input
            id="bufferAfterMin"
            name="bufferAfterMin"
            type="number"
            min={0}
            max={120}
            step={5}
            defaultValue={service?.bufferAfterMin ?? 10}
          />
        </Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium">{t('services.form.roomTypes')}</legend>
        <p className="text-[13px] text-muted">{t('services.form.roomTypesHint')}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          {ROOM_TYPES.map((rt) => (
            <ChipCheckbox
              key={rt}
              name="roomTypes"
              value={rt}
              label={t(`services.roomType.${rt}`)}
              defaultChecked={service?.roomTypes.includes(rt)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium">{t('equipment.form.legend')}</legend>
        <p className="text-[13px] text-muted">
          {kitTypes.length ? t('equipment.form.hint') : t('equipment.form.none')}
        </p>
        {kitTypes.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {kitTypes.map((ty) => (
              <ChipCheckbox
                key={ty}
                name="equipmentTypes"
                value={ty}
                label={ty}
                defaultChecked={service?.equipmentTypes.includes(ty)}
              />
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium">{t('services.form.colour')}</legend>
        <ColorPicker name="color" defaultValue={service?.color} />
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle
          name="onlineBookable"
          label={t('services.form.onlineBookable')}
          hint={t('services.form.onlineBookableHint')}
          defaultChecked={service?.onlineBookable ?? true}
        />
        <Toggle
          name="active"
          label={t('services.form.active')}
          hint={t('services.form.activeHint')}
          defaultChecked={service?.active ?? true}
        />
        <Field label={t('services.form.showPrice')} name="showPrice" hint={t('services.form.showPriceHint')}>
          <Select
            id="showPrice"
            name="showPrice"
            defaultValue={service?.showPrice == null ? '' : service.showPrice ? 'show' : 'hide'}
          >
            <option value="">{t('services.form.showPriceDefault')}</option>
            <option value="show">{t('services.form.showPriceShow')}</option>
            <option value="hide">{t('services.form.showPriceHide')}</option>
          </Select>
        </Field>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-between">
        {service ? (
          <Button
            type="button"
            variant="ghost"
            className="text-danger"
            pending={pending}
            onClick={() =>
              run(
                t('services.service.confirmDelete', { name: service.name.en }),
                () => deleteServiceAction(slug, service.id),
                onDone,
              )
            }
          >
            <Trash2 /> {t('common.delete')}
          </Button>
        ) : (
          <span />
        )}
        <SubmitButton>{t(service ? 'services.service.save' : 'services.service.add')}</SubmitButton>
      </div>
    </ActionForm>
  )
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export function RoomSheet({
  slug,
  branches,
  room,
}: {
  slug: string
  branches: Option[]
  room?: { id: string; branchId: string; name: string; type: string; active: boolean }
}) {
  const [open, setOpen] = useState(false)
  const { pending, run } = useConfirmAction()
  const t = useT()
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={room ? t('services.room.edit', { name: room.name }) : t('services.room.new')}
      description={t('services.room.sheetBody')}
      trigger={
        room ? (
          <Button variant="ghost" size="sm" aria-label={t('services.room.editAria', { name: room.name })}>
            <Pencil />
          </Button>
        ) : (
          <Button variant="secondary" size="sm">
            <Plus /> {t('services.room.add')}
          </Button>
        )
      }
    >
      <ActionForm
        action={saveRoomAction.bind(null, slug)}
        onSuccess={() => setOpen(false)}
        className="space-y-5"
      >
        <input type="hidden" name="id" value={room?.id ?? ''} />
        {branches.length > 1 ? (
          <Field label={t('services.room.branch')} name="branchId">
            <Select id="branchId" name="branchId" defaultValue={room?.branchId ?? branches[0]?.id}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <input type="hidden" name="branchId" value={room?.branchId ?? branches[0]?.id ?? ''} />
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('services.room.name')} name="name">
            <Input
              id="name"
              name="name"
              defaultValue={room?.name}
              placeholder={t('services.room.namePlaceholder')}
              required
            />
          </Field>
          <Field label={t('services.room.type')} name="type">
            <Select id="type" name="type" defaultValue={room?.type ?? 'single'}>
              {ROOM_TYPES.map((rt) => (
                <option key={rt} value={rt}>
                  {t(`services.roomType.${rt}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Toggle
          name="active"
          label={t('services.form.active')}
          hint={t('services.room.activeHint')}
          defaultChecked={room?.active ?? true}
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {room ? (
            <Button
              type="button"
              variant="ghost"
              className="text-danger"
              pending={pending}
              onClick={() =>
                run(
                  t('services.room.confirmDelete', { name: room.name }),
                  () => deleteRoomAction(slug, room.id),
                  () => setOpen(false),
                )
              }
            >
              <Trash2 /> {t('common.delete')}
            </Button>
          ) : (
            <span />
          )}
          <SubmitButton>{t(room ? 'services.room.save' : 'services.room.submitAdd')}</SubmitButton>
        </div>
      </ActionForm>
    </Sheet>
  )
}
