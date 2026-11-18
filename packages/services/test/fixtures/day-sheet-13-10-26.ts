// R32: the owner's paper day sheet BE RELAX 13-10-26 as data (design §12.1), shared by the services unit test and
// the e2e helper (apps/web/e2e/day-sheet.spec.ts). Every booking goes through createBooking + finishBooking, as
// reception would: Confirm with fee + commission, then Finish & pay.
import { dubaiInstant } from '@spa/core'
import { clients, rooms, services, serviceVariants, shifts, staff, type Tx } from '@spa/db'
import { createBooking, finishBooking, recordDrawerExpense } from '../../src'

/** Therapists in sheet (sort) order; `off` = no shift that day. */
export const SHEET_THERAPISTS = [
  ['Bella', false],
  ['Natcha', false],
  ['Linda', false],
  ['Lita', false],
  ['Haifa', true],
  ['Sara', false],
  ['Lily', true],
  ['Miney', false],
  ['Luna', false],
  ['Lisa', false],
  ['Manar', false],
  ['Natasha', true],
  ['Qamar', false],
  ['Shams', true],
] as const

type Source = 'phone' | 'walk_in' | 'whatsapp' | 'instagram'
export type SheetFixtureRow = {
  no: number
  therapist: string
  q: number
  /** Dubai 24 h, PM on the paper. */
  from: string
  to: string
  room: string
  source: Source
  line: number | null
  type: 'regular' | 'new' | null
  own: boolean
  pay: 'cash' | 'card_terminal'
  amount: number
  code: string
}

const r = (
  no: number,
  therapist: string,
  q: number,
  from: string,
  to: string,
  room: string,
  source: Source,
  line: number | null,
  type: 'regular' | 'new' | null,
  own: boolean,
  pay: 'cash' | 'card_terminal',
  amount: number,
  code: string,
): SheetFixtureRow => ({ no, therapist, q, from, to, room, source, line, type, own, pay, amount, code })

export const SHEET_ROWS: SheetFixtureRow[] = [
  r(1, 'Lisa', 1, '12:35', '13:35', '4', 'phone', 2, 'regular', false, 'card_terminal', 150, 'P2/R'),
  r(2, 'Bella', 1, '12:40', '13:25', '10', 'walk_in', null, 'new', false, 'cash', 170, 'W/N'),
  r(3, 'Luna', 1, '12:50', '13:35', '11', 'phone', 2, 'regular', false, 'cash', 170, 'P2/R'),
  r(4, 'Manar', 1, '13:30', '14:30', '9', 'phone', 2, 'new', false, 'card_terminal', 300, 'P2/N'),
  r(5, 'Lita', 0, '14:50', '15:50', '4', 'phone', 4, 'regular', true, 'cash', 150, 'P4/R'),
  r(6, 'Natcha', 1, '16:10', '17:10', '8', 'phone', 2, 'new', false, 'cash', 300, 'P2/N'),
  r(7, 'Bella', 0, '16:30', '17:30', '4', 'whatsapp', null, null, true, 'card_terminal', 150, 'B'),
  r(8, 'Luna', 2, '17:05', '18:05', '11', 'walk_in', null, 'new', false, 'card_terminal', 200, 'W/N'),
  r(9, 'Lita', 1, '17:25', '18:25', '10', 'walk_in', null, 'new', false, 'cash', 170, 'W/N'),
  r(10, 'Natcha', 2, '17:50', '18:50', '5', 'phone', 3, 'regular', false, 'cash', 200, 'P3/R'),
  r(11, 'Lisa', 2, '18:30', '19:30', '4', 'walk_in', null, 'regular', false, 'cash', 150, 'W/R'),
  r(12, 'Sara', 0, '18:45', '20:15', '6', 'instagram', null, null, true, 'card_terminal', 280, 'B'),
  r(13, 'Luna', 3, '21:40', '22:40', '10', 'phone', 3, 'regular', false, 'cash', 150, 'P3/R'),
]

/** The paper's check figures (AED). */
export const SHEET_TOTALS = { cash: 1460, card: 1080, expenses: 58, totalSale: 2482, totalCash: 1402 }

/** Turn panel as on the paper: turns per therapist, own-lead count, OFF. */
export const SHEET_PANEL: Record<string, { turns: number[]; own: number; off: boolean }> = {
  Bella: { turns: [1], own: 1, off: false },
  Natcha: { turns: [1, 2], own: 0, off: false },
  Linda: { turns: [], own: 0, off: false },
  Lita: { turns: [1], own: 1, off: false },
  Haifa: { turns: [], own: 0, off: true },
  Sara: { turns: [], own: 1, off: false },
  Lily: { turns: [], own: 0, off: true },
  Miney: { turns: [], own: 0, off: false },
  Luna: { turns: [1, 2, 3], own: 0, off: false },
  Lisa: { turns: [1, 2], own: 0, off: false },
  Manar: { turns: [1], own: 0, off: false },
  Natasha: { turns: [], own: 0, off: true },
  Qamar: { turns: [], own: 0, off: false },
  Shams: { turns: [], own: 0, off: true },
}

const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

/**
 * Seeds the 13-10-26 day on `date` for a branch (05:00 cutoff): rooms 4–11, a 45/60/90 min treatment (no buffers),
 * the 14 therapists (12:00–23:30 shifts except Haifa, Lily, Natasha, Shams), the 13 finished sessions and, with
 * `expense`, Laundry 58 from the drawer. `run` gives a transaction (withTenant in unit tests, testDb in e2e).
 */
export async function seedDaySheetDay(
  run: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>,
  o: { tenantId: string; branchId: string; date: string; now?: Date; expense?: boolean; tips?: boolean },
) {
  const { tenantId, branchId, date } = o
  const ids = await run(async (tx) => {
    const roomRows = await tx
      .insert(rooms)
      .values(['4', '5', '6', '8', '9', '10', '11'].map((name, sort) => ({ tenantId, branchId, name, sort })))
      .returning()
    const [svc] = await tx
      .insert(services)
      .values({ tenantId, name: { en: 'Thai massage' }, bufferBeforeMin: 0, bufferAfterMin: 0 })
      .returning()
    const variants = await tx
      .insert(serviceVariants)
      .values(
        [45, 60, 90].map((durationMin, sort) => ({
          tenantId,
          serviceId: svc!.id,
          durationMin,
          priceAed: String(durationMin * 3),
          sort,
        })),
      )
      .returning()
    const people = await tx
      .insert(staff)
      .values(SHEET_THERAPISTS.map(([displayName], sort) => ({ tenantId, displayName, sort: sort + 1 })))
      .returning()
    for (const [i, p] of people.entries())
      if (!SHEET_THERAPISTS[i]![1])
        await tx.insert(shifts).values({
          tenantId,
          staffId: p.id,
          branchId,
          startsAt: dubaiInstant(date, 12 * 60),
          endsAt: dubaiInstant(date, 23 * 60 + 30),
        })
    const [client] = await tx
      .insert(clients)
      .values({ tenantId, name: 'Walk-in guest', phoneE164: '971500000013' })
      .returning()
    return {
      room: new Map(roomRows.map((x) => [x.name, x.id])),
      variant: new Map(variants.map((v) => [v.durationMin, v.id])),
      staff: new Map(people.map((p) => [p.displayName, p.id])),
      client: client!.id,
    }
  })
  const bookingIds: string[] = []
  for (const row of SHEET_ROWS) {
    const duration = minutes(row.to) - minutes(row.from)
    const variantId = ids.variant.get(duration)!
    const staffId = ids.staff.get(row.therapist)!
    await run(async (tx) => {
      const b = await createBooking(tx, {
        tenantId,
        branchId,
        clientId: ids.client,
        source: row.source,
        status: 'confirmed',
        allowOffShift: true,
        phoneLine: row.line,
        clientType: row.type,
        ownLead: row.own,
        items: [
          {
            serviceVariantId: variantId,
            start: dubaiInstant(date, minutes(row.from)),
            staffIds: [staffId],
            roomId: ids.room.get(row.room)!,
            feeAed: row.amount,
            commissionAed: 40,
          },
        ],
      })
      await finishBooking(tx, {
        tenantId,
        branchId,
        bookingId: b.id,
        clientId: ids.client,
        lines: [
          {
            kind: 'service',
            refId: variantId,
            description: `Thai massage ${duration} min`,
            qty: 1,
            unitPriceAed: row.amount,
            staffId,
          },
        ],
        payments: [{ method: row.pay, amountAed: row.amount }],
        tips: o.tips && row.no === 1 ? [{ staffId, amountAed: 20, method: 'cash' }] : [],
        now: o.now,
      })
      bookingIds.push(b.id)
    })
  }
  if (o.expense)
    await run((tx) =>
      recordDrawerExpense(tx, {
        tenantId,
        branchId,
        date,
        description: 'Laundry',
        accountCode: '6180',
        amountAed: 58,
        now: o.now,
      }),
    )
  return { ...ids, bookingIds }
}
