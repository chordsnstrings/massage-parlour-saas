import { addDays, businessDateOf, dubaiInstant } from '@spa/core'
import {
  bookings,
  branches,
  closeAllDbs,
  rooms,
  services,
  serviceVariants,
  shifts,
  staff,
  staffServices,
  tenants,
  withTenant,
} from '@spa/db'
import { seedPlatform } from '@spa/db/seed'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createModelArkClient, runDmTurn, truncateBytes } from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>
const now = dubaiInstant('2026-10-06', 10 * 60)
const tomorrow = addDays(businessDateOf(now), 1)

const msg = (m: object) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', ...m }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 500, completion_tokens: 50 },
    }),
  )
const call = (id: string, name: string, args: object) => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
})

beforeAll(async () => {
  await resetTestDatabase()
  await seedPlatform(platform)
  const [t] = await platform.insert(tenants).values({ slug: 'dm', name: 'Lotus Spa' }).returning()
  ids.tenant = t!.id
  await withTenant(
    ids.tenant,
    // biome-ignore lint/suspicious/noExplicitAny: test seeding helper
    async (tx: any) => {
      const [b] = await tx
        .insert(branches)
        .values({ tenantId: ids.tenant, name: 'JLT', isDefault: true, address: 'Cluster D, JLT, Dubai' })
        .returning()
      const [s] = await tx
        .insert(services)
        .values({ tenantId: ids.tenant, name: { en: 'Swedish massage' } })
        .returning()
      const [v] = await tx
        .insert(serviceVariants)
        .values({ tenantId: ids.tenant, serviceId: s.id, durationMin: 60, priceAed: '350' })
        .returning()
      ids.variant = v.id
      const [m] = await tx.insert(staff).values({ tenantId: ids.tenant, displayName: 'Maya' }).returning()
      await tx.insert(staffServices).values({ tenantId: ids.tenant, staffId: m.id, serviceId: s.id })
      await tx.insert(shifts).values({
        tenantId: ids.tenant,
        staffId: m.id,
        branchId: b.id,
        startsAt: dubaiInstant(tomorrow, 10 * 60),
        endsAt: dubaiInstant(tomorrow, 22 * 60),
      })
      await tx.insert(rooms).values({ tenantId: ids.tenant, branchId: b.id, name: 'Room 1' })
    },
    app,
  )
})
afterAll(closeAllDbs)

describe('DM agent', () => {
  it('checks availability, books, and replies with the reference', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        msg({
          content: null,
          tool_calls: [
            call('c1', 'check_availability', { variant_id: ids.variant, date: tomorrow, after: '18:00' }),
          ],
        }),
      )
      .mockResolvedValueOnce(
        msg({
          content: null,
          tool_calls: [
            call('c2', 'book', {
              variant_id: ids.variant,
              date: tomorrow,
              time: '18:00',
              name: 'Sara',
              phone: '050 765 4321',
            }),
          ],
        }),
      )
      .mockResolvedValueOnce(
        msg({ content: 'You are booked for 18:00 tomorrow! Your reference is in the confirmation.' }),
      )
    const client = createModelArkClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch })
    const res = await runDmTurn({
      tenantId: ids.tenant!,
      history: [],
      incoming: 'Swedish tomorrow evening please, Sara 0507654321',
      client,
      now,
    })
    expect(res.bookingRef).toMatch(/^[A-Z2-9]{5}$/)
    expect(res.reply).toContain('18:00')
    const toolResult = JSON.parse(
      JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).messages.at(
        -1,
      ).content,
    )
    expect(toolResult.times[0]).toBe('18:00')
    const rows = await withTenant(ids.tenant!, (tx) => tx.select().from(bookings), app)
    expect(rows.map((b) => [b.source, b.status])).toEqual([['instagram', 'pending']])
  })

  it('flags inappropriate conversations', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        msg({ content: null, tool_calls: [call('f1', 'flag_conversation', { reason: 'inappropriate' })] }),
      )
      .mockResolvedValueOnce(msg({ content: 'We can help with bookings and spa services only.' }))
    const client = createModelArkClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch })
    const res = await runDmTurn({
      tenantId: ids.tenant!,
      history: [],
      incoming: '(inappropriate request)',
      client,
      now,
    })
    expect(res.flagged).toBe('inappropriate')
    expect(res.reply).toBe('We can help with bookings and spa services only.')
  })

  it('keeps replies within the Instagram byte limit', () => {
    expect(new TextEncoder().encode(truncateBytes('مرحبا '.repeat(400), 1000)).length).toBeLessThanOrEqual(
      1000,
    )
  })
})
