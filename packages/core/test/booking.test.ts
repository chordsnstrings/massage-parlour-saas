import { describe, expect, it } from 'vitest'
import {
  businessDateOf,
  businessDayWindow,
  canTransition,
  dubaiInstant,
  findSlots,
  holdInterval,
  includedVat,
  openIntervals,
  pickStaff,
  type StaffAvailability,
  toRange,
} from '../src'

const D = '2026-10-06' // a Tuesday
const at = (hhmm: string, date = D) => {
  const [h, m] = hhmm.split(':').map(Number)
  return dubaiInstant(date, h! * 60 + m!)
}
const shift = (from: string, to: string): StaffAvailability['shifts'][number] => ({
  start: at(from),
  end: at(to),
})

describe('business day', () => {
  it('assigns after-midnight times to the previous business date', () => {
    expect(businessDateOf(at('01:30', '2026-10-07'), '05:00')).toBe(D)
    expect(businessDateOf(at('05:00', '2026-10-07'), '05:00')).toBe('2026-10-07')
    expect(businessDateOf(at('23:59'), '05:00')).toBe(D)
  })
  it('windows run cutoff to cutoff in Dubai time', () => {
    const w = businessDayWindow(D, '05:00')
    expect(w.start.toISOString()).toBe('2026-10-06T01:00:00.000Z')
    expect(w.end.toISOString()).toBe('2026-10-07T01:00:00.000Z')
  })
  it('opening hours may cross midnight', () => {
    const [i] = openIntervals(D, { tue: [{ open: '12:00', close: '02:00' }] })
    expect(i!.start.toISOString()).toBe('2026-10-06T08:00:00.000Z')
    expect(i!.end.toISOString()).toBe('2026-10-06T22:00:00.000Z')
  })
})

describe('findSlots', () => {
  const base = {
    date: D,
    hours: { tue: [{ open: '10:00', close: '14:00' }] },
    serviceId: 'swedish',
    durationMin: 60,
    bufferAfterMin: 15,
    stepMin: 30,
  }
  const maya: StaffAvailability = {
    id: 'maya',
    shifts: [shift('10:00', '14:00')],
    busy: [],
    skills: ['swedish'],
  }
  const ploy: StaffAvailability = {
    id: 'ploy',
    shifts: [shift('12:00', '14:00')],
    busy: [],
    skills: ['swedish', 'thai'],
  }
  const room = { id: 'r1', type: 'single', busy: [] }

  it('respects shifts, buffers and closing time', () => {
    const slots = findSlots({ ...base, staff: [maya], rooms: [room] })
    // last start: 12:30 → hold until 13:45 within the 14:00 shift end
    expect(slots.map((s) => s.start.toISOString().slice(11, 16))).toEqual([
      '06:00',
      '06:30',
      '07:00',
      '07:30',
      '08:00',
      '08:30',
    ])
  })

  it('excludes busy therapists and rooms', () => {
    const busyMaya = { ...maya, busy: [holdInterval(at('11:00'), 60, 0, 15)] }
    const slots = findSlots({ ...base, staff: [busyMaya], rooms: [room] })
    // Maya is held 11:00–12:15. A 10:00 start would hold until 11:15 and a 10:30 start until 11:45 (both clash);
    // 11:00 and 11:30 clash directly; 12:00 starts before the 12:15 release. Only 12:30 is left.
    expect(slots.map((s) => s.start.getTime())).toEqual([at('12:30').getTime()])
  })

  it('needs two therapists and one room for couples treatments', () => {
    const slots = findSlots({
      ...base,
      therapistsRequired: 2,
      staff: [maya, ploy],
      rooms: [{ id: 'c1', type: 'couple', busy: [] }],
      roomTypes: ['couple'],
    })
    expect(slots[0]!.start.getTime()).toBe(at('12:00').getTime())
    expect(slots[0]!.staffIds.sort()).toEqual(['maya', 'ploy'])
    expect(
      findSlots({
        ...base,
        therapistsRequired: 2,
        staff: [maya, ploy],
        rooms: [room],
        roomTypes: ['couple'],
      }),
    ).toEqual([])
  })

  it('honours preferred therapists and lead time', () => {
    const slots = findSlots({
      ...base,
      staff: [maya, ploy],
      rooms: [room],
      preferredStaffIds: ['ploy'],
      notBefore: at('12:15'),
    })
    expect(slots.map((s) => s.staffIds)).toEqual([['ploy']])
  })

  it('needs one free unit per required equipment type (B5.3)', () => {
    const stones = [
      { id: 'k1', type: 'Hot stones', busy: [{ start: at('10:00'), end: at('11:15') }] },
      { id: 'k2', type: 'Hot stones', busy: [] },
    ]
    const q = { ...base, staff: [maya], rooms: [room], equipmentTypes: ['Hot stones'] }
    const ten = findSlots({ ...q, equipment: stones })[0]!
    expect(ten.equipmentIds).toEqual(['k2'])
    // Two kits needed but k1 is held until 11:15 -> the first slot moves to 11:30.
    const two = findSlots({ ...q, equipmentTypes: ['Hot stones', 'Hot stones'], equipment: stones })
    expect(two[0]!.start.getTime()).toBe(at('11:30').getTime())
    expect(two[0]!.equipmentIds.sort()).toEqual(['k1', 'k2'])
    expect(findSlots({ ...q, equipment: [] })).toEqual([])
    expect(findSlots({ ...base, staff: [maya], rooms: [room] })[0]!.equipmentIds).toEqual([])
  })

  it('never offers a therapist on approved leave (B5.4)', () => {
    const away = { ...maya, leave: [{ start: at('00:00'), end: at('23:59') }] }
    expect(findSlots({ ...base, staff: [away], rooms: [room] })).toEqual([])
    const halfDay = { ...maya, leave: [{ start: at('12:00'), end: at('23:59') }] }
    const starts = findSlots({ ...base, staff: [halfDay], rooms: [room] }).map((s) => s.start.getTime())
    expect(starts).toEqual([at('10:00').getTime(), at('10:30').getTime()])
  })
})

describe('helpers', () => {
  it('picks staff by rotation, then load', () => {
    expect(pickStaff(['a', 'b', 'c'], 1, { rotation: ['c', 'a'] })).toEqual(['c'])
    expect(pickStaff(['a', 'b'], 1, { load: { a: 3, b: 1 } })).toEqual(['b'])
  })
  it('formats ranges and VAT', () => {
    expect(toRange({ start: at('10:00'), end: at('11:00') })).toBe(
      '[2026-10-06T06:00:00.000Z,2026-10-06T07:00:00.000Z)',
    )
    expect(includedVat(105)).toBe(5)
    expect(includedVat(350)).toBe(16.67)
  })
  it('guards status transitions', () => {
    expect(canTransition('pending', 'confirmed')).toBe(true)
    expect(canTransition('completed', 'cancelled')).toBe(true)
    expect(canTransition('in_service', 'pending')).toBe(false)
    expect(canTransition('cancelled', 'completed')).toBe(false)
  })
})

describe('week / month ranges', () => {
  it('weekStartOf, monthGridRange, addMonths', async () => {
    const { weekStartOf, monthGridRange, addMonths } = await import('../src/booking')
    expect(weekStartOf('2026-10-08')).toBe('2026-10-05')
    expect(weekStartOf('2026-10-11')).toBe('2026-10-05')
    expect(weekStartOf('2026-10-05')).toBe('2026-10-05')
    expect(monthGridRange('2026-10-08')).toEqual({
      first: '2026-10-01',
      last: '2026-10-31',
      from: '2026-09-28',
      to: '2026-11-01',
    })
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
  })
})
