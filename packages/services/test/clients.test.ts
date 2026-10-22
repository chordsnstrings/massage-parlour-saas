import { closeAllDbs, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DomainError, findOrCreateClient } from '../src'

const { platform, app } = testDbs()
let tenantId = ''
const find = (phone: string, name = 'Guest') =>
  withTenant(tenantId, (tx) => findOrCreateClient(tx, tenantId, { name, phone }), app)

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'phones', name: 'Phone Spa' }).returning()
  tenantId = t!.id
})
afterAll(closeAllDbs)

describe('findOrCreateClient phones (R38)', () => {
  it('takes UAE mobiles as before and any country with + or 00, one client per number', async () => {
    const uae = await find('050 123 4567', 'Aisha')
    expect(uae).toMatchObject({ name: 'Aisha', phoneE164: '971501234567' })
    expect((await find('+971 50 123 4567')).id).toBe(uae.id)
    expect((await find('501234567')).id).toBe(uae.id)
    for (const [input, e164] of [
      ['+44 7700 900123', '447700900123'],
      ['0044 7700 900123', '447700900123'],
      ['+1 202 555 0123', '12025550123'],
      ['+966 50 123 4567', '966501234567'],
    ] as const)
      expect((await find(input)).phoneE164).toBe(e164)
    const uk = await find('+447700900123')
    expect((await find('+44 (0)7700 900123')).id).toBe(uk.id)
    expect((await find('0044 7700 900123')).id).toBe(uk.id)
    expect(uk.id).not.toBe(uae.id)
  })

  it('refuses bare foreign digits, UAE landlines and +971 4…', async () => {
    for (const bad of [
      '447700900123',
      '07700 900123',
      '04 123 4567',
      '+971 4 123 4567',
      '0097141234567',
      '12345',
    ]) {
      const err = await find(bad).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(DomainError)
      expect((err as Error).message).toBe(
        'Enter a UAE mobile (05X XXX XXXX) or a number with + and its country code',
      )
    }
  })
})
