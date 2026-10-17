import { dubaiInstant } from '@spa/core'
import {
  branches,
  clientMemberships,
  clientPackages,
  clients,
  closeAllDbs,
  conversations,
  giftCards,
  intakeSubmissions,
  journalEntries,
  membershipPlans,
  outbox,
  rooms,
  sales,
  services,
  serviceVariants,
  shifts,
  staff,
  staffServices,
  tenants,
  treatmentNotes,
  waitlistEntries,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addToWaitlist,
  bookFromWaitlist,
  CLIENT_REFERENCES,
  cancelWaitlistEntry,
  createBooking,
  DomainError,
  duplicateClientPairs,
  mergeClients,
  mergePreview,
  rescheduleItem,
  setBookingStatus,
} from '../src'

const { owner, platform, app } = testDbs()
const D = '2026-10-06'
const NOW = dubaiInstant(D, 8 * 60) // 08:00 that morning: every slot below is in the future
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return dubaiInstant(D, h! * 60 + m!)
}
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)
let phoneSeq = 0
const newClient = (name: string, phone: string | null = `9715000${String(++phoneSeq).padStart(5, '0')}`) =>
  tx(async (db) => {
    const [c] = await db.insert(clients).values({ tenantId: ids.tenant!, name, phoneE164: phone }).returning()
    return c!
  })
const book = (clientId: string, start: string, staffId = ids.maya!) =>
  tx((db) =>
    createBooking(db, {
      tenantId: ids.tenant!,
      branchId: ids.branch!,
      clientId,
      source: 'phone',
      status: 'confirmed',
      items: [{ serviceVariantId: ids.variant!, start: at(start), staffIds: [staffId] }],
    }),
  )
const wait = (clientId: string, over: Partial<Parameters<typeof addToWaitlist>[1]> = {}) =>
  tx((db) =>
    addToWaitlist(db, {
      tenantId: ids.tenant!,
      branchId: ids.branch!,
      clientId,
      serviceId: ids.service!,
      businessDate: D,
      ...over,
    }),
  )
const waitlistMsgs = (clientId: string) =>
  tx((db) =>
    db
      .select()
      .from(outbox)
      .where(sql`${outbox.clientId} = ${clientId} and ${outbox.kind} = 'waitlist_slot'`),
  )

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'calm', name: 'Calm Spa' }).returning()
  ids.tenant = t!.id
  await tx(async (db) => {
    const [b] = await db
      .insert(branches)
      .values({
        tenantId: ids.tenant!,
        name: 'Marina',
        isDefault: true,
        openingHours: { tue: [{ open: '10:00', close: '22:00' }] },
      })
      .returning()
    ids.branch = b!.id
    const [s] = await db
      .insert(services)
      .values({ tenantId: ids.tenant!, name: { en: 'Swedish massage' }, bufferAfterMin: 0 })
      .returning()
    const [o] = await db
      .insert(services)
      .values({ tenantId: ids.tenant!, name: { en: 'Facial' }, bufferAfterMin: 0 })
      .returning()
    ids.service = s!.id
    ids.other = o!.id
    const [v] = await db
      .insert(serviceVariants)
      .values({ tenantId: ids.tenant!, serviceId: s!.id, durationMin: 60, priceAed: '350' })
      .returning()
    ids.variant = v!.id
    const people = await db
      .insert(staff)
      .values([
        { tenantId: ids.tenant!, displayName: 'Maya', sort: 1 },
        { tenantId: ids.tenant!, displayName: 'Ploy', sort: 2 },
      ])
      .returning()
    ids.maya = people[0]!.id
    ids.ploy = people[1]!.id
    for (const p of people) {
      await db.insert(staffServices).values({ tenantId: ids.tenant!, staffId: p.id, serviceId: s!.id })
      await db.insert(shifts).values({
        tenantId: ids.tenant!,
        staffId: p.id,
        branchId: b!.id,
        startsAt: at('10:00'),
        endsAt: at('22:00'),
      })
    }
    await db.insert(rooms).values([
      { tenantId: ids.tenant!, branchId: b!.id, name: 'Room 1', type: 'single' },
      { tenantId: ids.tenant!, branchId: b!.id, name: 'Room 2', type: 'single' },
    ])
  })
})
afterAll(closeAllDbs)

describe('waitlist', () => {
  it('a cancellation offers the slot to matching entries only, once, with a WhatsApp message', async () => {
    const booked = await newClient('Booked Client')
    const fits = await newClient('Aisha Waiting')
    const later = await newClient('Late Window')
    const otherSvc = await newClient('Wants Facial')
    const noPhone = await newClient('No Phone', null)
    const b = await book(booked.id, '11:00')
    const e1 = await wait(fits.id, { fromAt: at('10:00'), untilAt: at('13:00') })
    const e2 = await wait(later.id, { fromAt: at('18:00'), untilAt: at('21:00') })
    const e3 = await wait(otherSvc.id, { serviceId: ids.other })
    const e4 = await wait(noPhone.id)
    await tx((db) => setBookingStatus(db, b.id, 'cancelled', 'Client ill', { now: NOW }))
    const rows = await tx((db) => db.select().from(waitlistEntries))
    const st = (id: string) => rows.find((r) => r.id === id)!.status
    expect([st(e1.id), st(e2.id), st(e3.id), st(e4.id)]).toEqual([
      'notified',
      'waiting',
      'waiting',
      'waiting',
    ])
    const [msg] = await waitlistMsgs(fits.id)
    expect(msg!.status).toBe('queued')
    expect(msg!.text).toContain('Swedish massage')
    expect(msg!.text).toContain('Calm Spa')
    // Already notified → a second freed slot doesn't message the same entry again.
    const b2 = await book(booked.id, '12:00')
    await tx((db) => setBookingStatus(db, b2.id, 'no_show', undefined, { now: NOW }))
    expect(await waitlistMsgs(fits.id)).toHaveLength(1)
    // Past slots are not offered.
    const past = await newClient('Past')
    await wait(past.id)
    const b3 = await book(booked.id, '14:00')
    await tx((db) => setBookingStatus(db, b3.id, 'cancelled', 'x', { now: at('16:00') }))
    expect(await waitlistMsgs(past.id)).toHaveLength(0)
    for (const e of [e2, e3, e4]) await tx((db) => cancelWaitlistEntry(db, e.id))
    await tx((db) => db.delete(waitlistEntries))
  })

  it('a reschedule offers the old time', async () => {
    const booked = await newClient('Mover')
    const waiting = await newClient('Wants Mover Time')
    const b = await book(booked.id, '15:00')
    await wait(waiting.id, { fromAt: at('15:00'), untilAt: at('16:00') })
    const [item] = await tx((db) =>
      db.execute<{ id: string }>(sql`select id from booking_items where booking_id = ${b.id}`),
    ).then((r) => r.rows)
    await tx((db) => rescheduleItem(db, item!.id, { start: at('19:00') }, { now: NOW }))
    expect(await waitlistMsgs(waiting.id)).toHaveLength(1)
    await tx((db) => db.delete(waitlistEntries))
  })

  it('race: two cancellations at once notify one waiting entry exactly once', async () => {
    const c1 = await newClient('Race One')
    const c2 = await newClient('Race Two')
    const waiting = await newClient('Race Waiter')
    const b1 = await book(c1.id, '17:00', ids.maya)
    const b2 = await book(c2.id, '17:00', ids.ploy)
    await wait(waiting.id)
    await Promise.all(
      [b1, b2].map((b) => tx((db) => setBookingStatus(db, b.id, 'cancelled', 'x', { now: NOW }))),
    )
    expect(await waitlistMsgs(waiting.id)).toHaveLength(1)
    await tx((db) => db.delete(waitlistEntries))
  })

  it('converts an entry into a booking once (normal createBooking path)', async () => {
    const c = await newClient('Convert Me')
    const e = await wait(c.id, { serviceVariantId: ids.variant })
    const input = {
      source: 'phone' as const,
      status: 'confirmed' as const,
      items: [{ serviceVariantId: ids.variant!, start: at('20:00') }],
    }
    const { booking, entry } = await tx((db) => bookFromWaitlist(db, e.id, input))
    expect(booking.clientId).toBe(c.id)
    expect(entry.status).toBe('booked')
    expect(entry.bookingId).toBe(booking.id)
    await expect(tx((db) => bookFromWaitlist(db, e.id, input))).rejects.toBeInstanceOf(DomainError)
    await expect(wait(c.id, { fromAt: at('12:00'), untilAt: at('11:00') })).rejects.toBeInstanceOf(
      DomainError,
    )
  })
})

describe('merge duplicate clients', () => {
  it('suggests pairs by normalised phone and name', async () => {
    const a = await newClient('Sara  Khan', '971509990001')
    const b = await newClient('sara khan', null)
    const c = await newClient('Someone Else', '0509990001') // stored un-normalised (old import)
    const pairs = await tx((db) => duplicateClientPairs(db))
    const has = (x: string, y: string, reason: string) =>
      pairs.some((p) => p.keep.id === x && p.merge.id === y && p.reason === reason)
    expect(has(a.id, b.id, 'name')).toBe(true)
    expect(has(a.id, c.id, 'phone')).toBe(true)
  })

  it('moves every client reference, combines stats, deletes the duplicate, leaves the ledger alone', async () => {
    const keep = await newClient('Keep Me', null)
    const dup = await newClient('Dup Me')
    await tx((db) =>
      db
        .update(clients)
        .set({
          tags: ['vip'],
          noShowCount: 2,
          notes: 'Prefers mornings',
          createdAt: new Date('2020-01-01T00:00:00Z'),
          lastVisitAt: new Date('2026-09-01T00:00:00Z'),
        })
        .where(eq(clients.id, dup.id)),
    )
    await tx((db) =>
      db
        .update(clients)
        .set({ tags: ['regular'], noShowCount: 1 })
        .where(eq(clients.id, keep.id)),
    )
    const b = await book(dup.id, '21:00')
    const t = ids.tenant!
    await tx(async (db) => {
      await db.insert(sales).values({
        tenantId: t,
        branchId: ids.branch!,
        clientId: dup.id,
        number: 9001,
        businessDate: D,
        subtotalAed: '0',
        totalAed: '0',
      })
      await db
        .insert(outbox)
        .values({ tenantId: t, clientId: dup.id, kind: 'custom', phoneE164: dup.phoneE164!, text: 'Hi' })
      await db.insert(intakeSubmissions).values({
        tenantId: t,
        clientId: dup.id,
        templateVersion: 1,
        answers: {},
        waiverText: 'ok',
        signature: 'M0 0',
      })
      await db.insert(treatmentNotes).values({ tenantId: t, clientId: dup.id, text: 'Tight shoulders' })
      await db.insert(clientPackages).values({
        tenantId: t,
        clientId: dup.id,
        name: '5 x Swedish',
        pricePaidAed: '1000',
        balances: {},
        remainingValueAed: '1000',
        expiresAt: new Date('2027-01-01'),
      })
      const [plan] = await db
        .insert(membershipPlans)
        .values({ tenantId: t, name: { en: 'Monthly' }, monthlyAed: '300' })
        .returning()
      await db.insert(clientMemberships).values({
        tenantId: t,
        clientId: dup.id,
        planId: plan!.id,
        currentPeriodStart: D,
        currentPeriodEnd: '2026-11-06',
      })
      await db.insert(giftCards).values({
        tenantId: t,
        code: 'GIFT1',
        initialAed: '100',
        balanceAed: '100',
        purchaserClientId: dup.id,
      })
      await db
        .insert(conversations)
        .values({ tenantId: t, channel: 'instagram', externalThreadId: 'th1', clientId: dup.id })
      await addToWaitlist(db, { tenantId: t, branchId: ids.branch!, clientId: dup.id, businessDate: D })
    })
    // The FK list covers every column that references clients.id in the database.
    const { rows: fks } = await owner.execute<{ tbl: string; col: string }>(sql`
      select c.conrelid::regclass::text as tbl, a.attname as col from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.contype = 'f' and c.confrelid = 'clients'::regclass`)
    expect(fks.map((f) => f.tbl).sort()).toEqual(Object.keys(CLIENT_REFERENCES).sort())

    const preview = await tx((db) => mergePreview(db, keep.id, dup.id))
    expect(Object.values(preview.counts).every((n) => n >= 1)).toBe(true)
    expect(preview.counts.bookings).toBe(1)
    const ledgerBefore = await owner.select({ n: sql<number>`count(*)::int` }).from(journalEntries)
    const { kept, moved } = await tx((db) => mergeClients(db, keep.id, dup.id))
    expect(moved).toEqual(preview.counts)
    for (const f of fks) {
      const { rows } = await owner.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(f.tbl)} where ${sql.identifier(f.col)} = ${dup.id}`,
      )
      expect(rows[0]!.n, `${f.tbl}.${f.col}`).toBe(0)
    }
    expect((await owner.select().from(clients).where(eq(clients.id, dup.id))).length).toBe(0)
    expect(kept.phoneE164).toBe(dup.phoneE164)
    expect(kept.tags.sort()).toEqual(['regular', 'vip'])
    expect(kept.noShowCount).toBe(3)
    expect(kept.notes).toBe('Prefers mornings')
    expect(kept.createdAt.toISOString()).toBe('2020-01-01T00:00:00.000Z')
    expect(kept.lastVisitAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    const [moved1] = await tx((db) => db.select().from(clients).where(eq(clients.id, keep.id)))
    expect(moved1!.id).toBe(keep.id)
    expect(
      (
        await tx((db) =>
          db.execute<{ c: string }>(sql`select client_id as c from bookings where id = ${b.id}`),
        )
      ).rows[0]!.c,
    ).toBe(keep.id)
    const ledgerAfter = await owner.select({ n: sql<number>`count(*)::int` }).from(journalEntries)
    expect(ledgerAfter).toEqual(ledgerBefore)
  })

  it('race: opposite merges at once — one wins, the other finds its client gone', async () => {
    const a = await newClient('Race A')
    const b = await newClient('Race B')
    const results = await Promise.allSettled([
      tx((db) => mergeClients(db, a.id, b.id)),
      tx((db) => mergeClients(db, b.id, a.id)),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(lost.reason).toBeInstanceOf(DomainError)
    const left = await tx((db) => db.select().from(clients).where(sql`${clients.id} in (${a.id}, ${b.id})`))
    expect(left).toHaveLength(1)
  })

  it('refuses merging a client into itself', async () => {
    const a = await newClient('Solo')
    await expect(tx((db) => mergeClients(db, a.id, a.id))).rejects.toBeInstanceOf(DomainError)
  })
})
