'use client'
import { Footprints, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { walkInAction } from '@/app/dashboard/[tenant]/calendar/actions'
import { Card, Pill, type Tone } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input, Select } from '@/components/ui/input'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState } from '@/components/ui/page'
import { Sheet } from '@/components/ui/sheet'
import { useT } from '@/i18n/client'
import { cn } from '@/lib/utils'
import { minuteLabel } from './time'
import type { CalendarData, RotationRow } from './types'

const TONE: Record<RotationRow['status'], Tone> = { free: 'ok', busy: 'warn', break: 'neutral', off: 'neutral' }

export function WalkInsPanel({ rotation, onWalkIn }: { rotation: RotationRow[]; onWalkIn: () => void }) {
  const t = useT()
  const next = rotation.find((r) => r.status === 'free')
  return (
    <Card
      className="xl:sticky xl:top-6"
      title={t('calendar.walkIns.title')}
      sub={t('calendar.walkIns.sub')}
      actions={
        <Button size="sm" variant="secondary" onClick={onWalkIn}>
          <Footprints /> {t('calendar.walkIn')}
        </Button>
      }
    >
      {rotation.length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title={t('calendar.walkIns.emptyTitle')}
          description={t('calendar.walkIns.emptyText')}
        />
      ) : (
        <Stagger className="-mx-2 space-y-1">
          {rotation.map((r, i) => {
            const isNext = r.staffId === next?.staffId
            return (
              <StaggerItem key={r.staffId}>
                <div
                  className={cn(
                    'flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 transition-colors',
                    isNext ? 'bg-accent-soft' : 'hover:bg-subtle/60',
                  )}
                  aria-current={isNext ? 'true' : undefined}
                >
                  <span className="w-4 text-xs text-muted tabular">{i + 1}</span>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.name}</span>
                    <span className="block text-xs text-muted">
                      {r.turns === 0
                        ? t('calendar.walkIns.none')
                        : t('calendar.walkIns.count', { count: r.turns })}
                    </span>
                  </span>
                  {isNext ? (
                    <Pill tone="acc">{t('calendar.walkIns.next')}</Pill>
                  ) : (
                    <Pill tone={TONE[r.status]}>{t(`calendar.walkIns.status.${r.status}`)}</Pill>
                  )}
                </div>
              </StaggerItem>
            )
          })}
        </Stagger>
      )}
    </Card>
  )
}

export function WalkInSheet({
  data,
  open,
  onOpenChange,
}: {
  data: CalendarData
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const rotation = data.rotation ?? []
  const next = rotation.find((r) => r.status === 'free')
  const [startLabel, setStartLabel] = useState('')
  useEffect(() => {
    if (!open) return
    setStartLabel(minuteLabel(Math.round((Date.now() - data.dayStartMs) / 300_000) * 5))
  }, [open, data.dayStartMs])
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('calendar.walkIns.sheetTitle')}
      description={
        startLabel ? t('calendar.walkIns.startsAt', { time: startLabel }) : t('calendar.walkIns.startsNow')
      }
    >
      <ActionForm
        key={String(open)}
        action={walkInAction.bind(null, data.slug)}
        onSuccess={() => onOpenChange(false)}
        className="space-y-5"
      >
        <input type="hidden" name="branchId" value={data.branchId} />
        <Field label={t('calendar.fields.service')} name="variantId">
          <Select id="variantId" name="variantId" defaultValue={data.variants[0]?.id}>
            {data.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('calendar.fields.therapist')} name="staffId">
          <Select id="staffId" name="staffId" defaultValue="">
            <option value="">{next
                ? t('calendar.walkIns.nextInRotation', { name: next.name })
                : t('calendar.walkIns.firstFree')}</option>
            {data.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('calendar.fields.name')} name="clientName" hint={t('common.optional')}>
            <Input id="clientName" name="clientName" autoComplete="off" />
          </Field>
          <Field
            label={t('calendar.fields.mobile')}
            name="clientPhone"
            hint={t('calendar.walkIns.phoneHint')}
          >
            <Input
              id="clientPhone"
              name="clientPhone"
              type="tel"
              inputMode="tel"
              placeholder="050 123 4567"
            />
          </Field>
        </div>
        <SubmitButton size="lg" className="w-full">
          {t('calendar.walkIns.start')}
        </SubmitButton>
      </ActionForm>
    </Sheet>
  )
}
