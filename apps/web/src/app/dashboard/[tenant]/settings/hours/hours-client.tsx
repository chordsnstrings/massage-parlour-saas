'use client'
import { Copy, Moon, Plus, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ActionForm, FieldError, SubmitButton } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n/client'
import { cn } from '@/lib/utils'
import { saveHoursAction } from './actions'

const DAYS = [['mon'], ['tue'], ['wed'], ['thu'], ['fri'], ['sat'], ['sun']] as const
type Day = (typeof DAYS)[number][0]
type Interval = { key: number; open: string; close: string }
type Hours = Partial<Record<Day, { open: string; close: string }[]>>

let seq = 0
// <input type="time"> can't show 24:00; midnight is 00:00 (a close before open runs past midnight).
const norm = (t: string) => (t === '24:00' ? '00:00' : t)

export function HoursForm({ slug, branchId, initial }: { slug: string; branchId: string; initial: Hours }) {
  const t = useT()
  const [days, setDays] = useState<Record<Day, Interval[]>>(
    () =>
      Object.fromEntries(
        DAYS.map(([d]) => [
          d,
          (initial[d] ?? []).map((i) => ({ key: ++seq, open: norm(i.open), close: norm(i.close) })),
        ]),
      ) as Record<Day, Interval[]>,
  )
  const update = (d: Day, fn: (list: Interval[]) => Interval[]) => setDays((s) => ({ ...s, [d]: fn(s[d]) }))
  const payload = JSON.stringify(
    Object.fromEntries(DAYS.map(([d]) => [d, days[d].map(({ open, close }) => ({ open, close }))])),
  )
  const copyToAll = (from: Day) =>
    setDays(
      (s) =>
        Object.fromEntries(DAYS.map(([d]) => [d, s[from].map((i) => ({ ...i, key: ++seq }))])) as Record<
          Day,
          Interval[]
        >,
    )

  return (
    <ActionForm action={saveHoursAction.bind(null, slug, branchId)} className="space-y-6">
      <input type="hidden" name="hours" value={payload} />
      <ul className="divide-y rounded-xl border">
        {DAYS.map(([d]) => {
          const label = t(`settings.hours.days.${d}`)
          const list = days[d]
          const closed = list.length === 0
          return (
            <li
              key={d}
              className="grid gap-3 px-3 py-4 sm:grid-cols-[9rem_1fr_auto] sm:items-start sm:px-5"
              data-day={d}
            >
              <div className="flex min-h-10 items-center justify-between gap-3 sm:justify-start">
                <span className={cn('text-sm font-medium', closed && 'text-muted')}>{label}</span>
                {closed && <span className="text-sm text-muted sm:hidden">{t('settings.hours.closed')}</span>}
              </div>
              <div className="space-y-2">
                {closed && (
                  <p className="hidden min-h-10 items-center text-sm text-muted sm:flex">
                    {t('settings.hours.closed')}
                  </p>
                )}
                <AnimatePresence initial={false}>
                  {list.map((i, idx) => {
                    const overnight = i.close <= i.open && i.close !== i.open
                    return (
                      <motion.div
                        key={i.key}
                        layout
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <Input
                          type="time"
                          aria-label={t('settings.hours.opens', { day: label, n: idx + 1 })}
                          value={i.open}
                          onChange={(e) =>
                            update(d, (l) =>
                              l.map((x) => (x.key === i.key ? { ...x, open: e.target.value } : x)),
                            )
                          }
                          className="min-w-0 flex-1 px-2.5 sm:w-36 sm:flex-none sm:px-3"
                        />
                        <span className="text-muted">–</span>
                        <Input
                          type="time"
                          aria-label={t('settings.hours.closes', { day: label, n: idx + 1 })}
                          value={i.close}
                          onChange={(e) =>
                            update(d, (l) =>
                              l.map((x) => (x.key === i.key ? { ...x, close: e.target.value } : x)),
                            )
                          }
                          className="min-w-0 flex-1 px-2.5 sm:w-36 sm:flex-none sm:px-3"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t('settings.hours.removeInterval', { day: label, n: idx + 1 })}
                          onClick={() => update(d, (l) => l.filter((x) => x.key !== i.key))}
                        >
                          <X />
                        </Button>
                        {overnight && (
                          <span className="flex basis-full items-center gap-1 text-[13px] text-muted sm:basis-auto">
                            <Moon className="size-3.5" /> {t('settings.hours.overnight')}
                          </span>
                        )}
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
                <FieldError name={d} />
              </div>
              <div className="flex flex-wrap gap-1 sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('settings.hours.addOn', { day: label })}
                  onClick={() =>
                    update(d, (l) => [
                      ...l,
                      l.length
                        ? { key: ++seq, open: '18:00', close: '02:00' }
                        : { key: ++seq, open: '10:00', close: '00:00' },
                    ])
                  }
                  disabled={list.length >= 4}
                >
                  <Plus /> {closed ? t('settings.hours.open') : t('settings.hours.add')}
                </Button>
                {!closed && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('settings.hours.copyAll', { day: label })}
                    onClick={() => copyToAll(d)}
                  >
                    <Copy /> <span className="sm:hidden lg:inline">{t('settings.hours.copyAllShort')}</span>
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <div className="flex justify-end">
        <SubmitButton size="lg">{t('settings.hours.save')}</SubmitButton>
      </div>
    </ActionForm>
  )
}
