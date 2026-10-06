'use client'
import { Footprints, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { walkInAction } from '@/app/dashboard/[tenant]/calendar/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input, Select } from '@/components/ui/input'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState } from '@/components/ui/page'
import { Sheet } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { minuteLabel } from './time'
import type { CalendarData, RotationRow } from './types'

const STATUS: Record<RotationRow['status'], { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  free: { label: 'Free', tone: 'success' },
  busy: { label: 'With client', tone: 'warning' },
  break: { label: 'On break', tone: 'neutral' },
  off: { label: 'Off shift', tone: 'neutral' },
}

export function WalkInsPanel({ rotation, onWalkIn }: { rotation: RotationRow[]; onWalkIn: () => void }) {
  const next = rotation.find((r) => r.status === 'free')
  return (
    <Card className="xl:sticky xl:top-6">
      <CardHeader
        title="Walk-ins"
        description="Today’s turn list"
        action={
          <Button size="sm" variant="secondary" onClick={onWalkIn} className="h-9">
            <Footprints /> Walk-in
          </Button>
        }
      />
      {rotation.length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title="No one on shift"
          description="Add today’s shifts to start the turn list."
        />
      ) : (
        <Stagger className="mt-4 space-y-1 px-3 pb-4 sm:px-4">
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
                        ? 'No walk-ins yet'
                        : `${r.turns} ${r.turns === 1 ? 'walk-in' : 'walk-ins'}`}
                    </span>
                  </span>
                  {isNext ? (
                    <Badge tone="accent">Next</Badge>
                  ) : (
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
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
      title="Walk-in"
      description={`Starts now${startLabel ? ` · ${startLabel}` : ''}. Room is assigned automatically.`}
    >
      <ActionForm
        key={String(open)}
        action={walkInAction.bind(null, data.slug)}
        onSuccess={() => onOpenChange(false)}
        className="space-y-5"
      >
        <input type="hidden" name="branchId" value={data.branchId} />
        <Field label="Service" name="variantId">
          <Select id="variantId" name="variantId" defaultValue={data.variants[0]?.id}>
            {data.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Therapist" name="staffId">
          <Select id="staffId" name="staffId" defaultValue="">
            <option value="">{next ? `Next in rotation (${next.name})` : 'First free therapist'}</option>
            {data.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" name="clientName" hint="Optional">
            <Input id="clientName" name="clientName" autoComplete="off" />
          </Field>
          <Field label="UAE mobile" name="clientPhone" hint="Optional, for receipts and rebooking">
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
          Start walk-in
        </SubmitButton>
      </ActionForm>
    </Sheet>
  )
}
