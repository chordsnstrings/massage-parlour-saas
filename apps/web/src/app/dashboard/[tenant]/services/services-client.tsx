'use client'
import { Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, FieldError, SubmitButton } from '@/components/ui/form'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
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
import { ROOM_TYPE_LABEL, ROOM_TYPES, SWATCHES } from './constants'

type Option = { id: string; name: string }

/** Runs a server action from a button with a confirm prompt and toasts. */
export function useConfirmAction() {
  const [pending, start] = useTransition()
  const run = (question: string | null, fn: () => Promise<ActionResult>, after?: () => void) => {
    if (question && !window.confirm(question)) return
    start(async () => {
      const r = await fn()
      if (r?.ok) {
        if (r.message) toast.success(r.message)
        after?.()
      } else if (r) toast.error(r.error)
    })
  }
  return { pending, run }
}

export function SampleMenuButton({ slug }: { slug: string }) {
  const { pending, run } = useConfirmAction()
  return (
    <Button pending={pending} onClick={() => run(null, () => addSampleMenuAction(slug))}>
      <Sparkles /> Add a sample UAE spa menu
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
  const initial = defaultValue ?? SWATCHES[0]
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {SWATCHES.map((c) => (
        <label key={c} className="relative grid size-11 cursor-pointer place-items-center sm:size-9">
          <input
            type="radio"
            name={name}
            value={c}
            defaultChecked={c === initial}
            className="peer sr-only"
            aria-label={c}
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
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={category ? 'Edit category' : 'New category'}
      description="Groups services on your menu and website."
      trigger={
        category ? (
          <Button variant="ghost" size="sm" aria-label={`Edit category ${category.en}`}>
            <Pencil /> <span className="hidden sm:inline">Edit</span>
          </Button>
        ) : (
          <Button variant="secondary">
            <Plus /> Category
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
          <Field label="Name (English)" name="nameEn">
            <Input id="nameEn" name="nameEn" defaultValue={category?.en} placeholder="Massage" required />
          </Field>
          <Field label="Name (Arabic)" name="nameAr">
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
                  'Delete this category? Its services stay, as uncategorised.',
                  () => deleteCategoryAction(slug, category.id),
                  () => setOpen(false),
                )
              }
            >
              <Trash2 /> Delete
            </Button>
          ) : (
            <span />
          )}
          <SubmitButton>{category ? 'Save' : 'Add category'}</SubmitButton>
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
  onlineBookable: boolean
  active: boolean
  color: string | null
  variants: { id: string; durationMin: number; priceAed: number }[]
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
  variant = 'primary',
}: {
  slug: string
  categories: Option[]
  service?: ServiceInput
  variant?: 'primary' | 'secondary'
}) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={service ? service.name.en : 'New service'}
      description={service ? 'Edit details, durations and prices.' : 'Prices are VAT-inclusive, in AED.'}
      className="md:max-w-2xl"
      trigger={
        service ? (
          <Button variant="ghost" size="sm" aria-label={`Edit ${service.name.en}`}>
            <Pencil /> <span className="hidden sm:inline">Edit</span>
          </Button>
        ) : (
          <Button variant={variant}>
            <Plus /> Add service
          </Button>
        )
      }
    >
      <ServiceForm slug={slug} categories={categories} service={service} onDone={() => setOpen(false)} />
    </Sheet>
  )
}

function ServiceForm({
  slug,
  categories,
  service,
  onDone,
}: {
  slug: string
  categories: Option[]
  service?: ServiceInput
  onDone: () => void
}) {
  const [rows, setRows] = useState<VariantRow[]>(() =>
    service?.variants.length
      ? service.variants.map((v) => ({
          key: v.id,
          id: v.id,
          durationMin: String(v.durationMin),
          priceAed: String(v.priceAed),
        }))
      : [newRow('60'), newRow('90')],
  )
  const { pending, run } = useConfirmAction()
  const set = (key: string, patch: Partial<VariantRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  return (
    <ActionForm action={saveServiceAction.bind(null, slug)} onSuccess={onDone} className="space-y-6">
      <input type="hidden" name="id" value={service?.id ?? ''} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name (English)" name="nameEn">
          <Input
            id="nameEn"
            name="nameEn"
            defaultValue={service?.name.en}
            placeholder="Swedish massage"
            required
          />
        </Field>
        <Field label="Name (Arabic)" name="nameAr">
          <Input
            id="nameAr"
            name="nameAr"
            dir="rtl"
            lang="ar"
            defaultValue={service?.name.ar}
            placeholder="مساج سويدي"
          />
        </Field>
        <Field label="Description (English)" name="descriptionEn">
          <Textarea
            id="descriptionEn"
            name="descriptionEn"
            rows={3}
            defaultValue={service?.description?.en}
          />
        </Field>
        <Field label="Description (Arabic)" name="descriptionAr">
          <Textarea
            id="descriptionAr"
            name="descriptionAr"
            dir="rtl"
            lang="ar"
            rows={3}
            defaultValue={service?.description?.ar}
          />
        </Field>
        <Field label="Category" name="categoryId">
          <Select
            id="categoryId"
            name="categoryId"
            defaultValue={service?.categoryId ?? categories[0]?.id ?? ''}
          >
            <option value="">Uncategorised</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Therapists" name="therapistsRequired">
          <Select
            id="therapistsRequired"
            name="therapistsRequired"
            defaultValue={String(service?.therapistsRequired ?? 1)}
          >
            <option value="1">1 therapist</option>
            <option value="2">2 therapists (couples / four hands)</option>
          </Select>
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-[13px] font-medium">Durations & prices</legend>
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
                      aria-label={`Duration ${i + 1} (minutes)`}
                      name="variantDuration"
                      inputMode="numeric"
                      value={r.durationMin}
                      onChange={(e) => set(r.key, { durationMin: e.target.value })}
                      className="pe-12 tabular-nums"
                    />
                    <span className="pointer-events-none absolute inset-y-0 end-3 grid place-items-center text-sm text-muted">
                      min
                    </span>
                  </div>
                  <div className="relative flex-1">
                    <span className="pointer-events-none absolute inset-y-0 start-3 grid place-items-center text-sm text-muted">
                      AED
                    </span>
                    <Input
                      aria-label={`Price ${i + 1} (AED)`}
                      name="variantPrice"
                      inputMode="decimal"
                      value={r.priceAed}
                      placeholder="350"
                      onChange={(e) => set(r.key, { priceAed: e.target.value })}
                      className="ps-12 tabular-nums"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove duration"
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
          <Plus /> Add duration
        </Button>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Buffer before" name="bufferBeforeMin" hint="Minutes to prepare the room.">
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
        <Field label="Buffer after" name="bufferAfterMin" hint="Cleanup and change of linen.">
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
        <legend className="text-[13px] font-medium">Room types</legend>
        <p className="text-[13px] text-muted">Leave all off to allow any room.</p>
        <div className="flex flex-wrap gap-2 pt-1">
          {ROOM_TYPES.map((t) => (
            <ChipCheckbox
              key={t}
              name="roomTypes"
              value={t}
              label={ROOM_TYPE_LABEL[t]}
              defaultChecked={service?.roomTypes.includes(t)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium">Colour on the calendar</legend>
        <ColorPicker name="color" defaultValue={service?.color} />
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle
          name="onlineBookable"
          label="Bookable online"
          hint="Shown on your website booking page."
          defaultChecked={service?.onlineBookable ?? true}
        />
        <Toggle
          name="active"
          label="Active"
          hint="Inactive services are hidden everywhere."
          defaultChecked={service?.active ?? true}
        />
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
                `Delete ${service.name.en}? Past bookings keep their details.`,
                () => deleteServiceAction(slug, service.id),
                onDone,
              )
            }
          >
            <Trash2 /> Delete
          </Button>
        ) : (
          <span />
        )}
        <SubmitButton>{service ? 'Save service' : 'Add service'}</SubmitButton>
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
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={room ? `Edit ${room.name}` : 'New room'}
      description="Room type decides which services can use it."
      trigger={
        room ? (
          <Button variant="ghost" size="sm" aria-label={`Edit room ${room.name}`}>
            <Pencil />
          </Button>
        ) : (
          <Button variant="secondary" size="sm">
            <Plus /> Room
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
          <Field label="Branch" name="branchId">
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
          <Field label="Room name" name="name">
            <Input id="name" name="name" defaultValue={room?.name} placeholder="Room 1" required />
          </Field>
          <Field label="Type" name="type">
            <Select id="type" name="type" defaultValue={room?.type ?? 'single'}>
              {ROOM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ROOM_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Toggle
          name="active"
          label="Active"
          hint="Inactive rooms can’t be booked."
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
                  `Delete ${room.name}?`,
                  () => deleteRoomAction(slug, room.id),
                  () => setOpen(false),
                )
              }
            >
              <Trash2 /> Delete
            </Button>
          ) : (
            <span />
          )}
          <SubmitButton>{room ? 'Save room' : 'Add room'}</SubmitButton>
        </div>
      </ActionForm>
    </Sheet>
  )
}
