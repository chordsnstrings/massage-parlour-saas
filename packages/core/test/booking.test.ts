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
