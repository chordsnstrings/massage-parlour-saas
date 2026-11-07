// F23: renaming a spa's address — validation like the Apply form, history for 301s, the 12-month cooling period
// (another spa can't claim the old address; the spa itself can take it back), claims after it, platform-only table.
import { closeAllDbs, plans, tenantSlugHistory, tenants, user } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  provisionTenant,
  renameTenantSlug,
  SLUG_COOLING_MONTHS,
  slugHistoryOf,
  slugRedirects,
  slugReservedUntil,
  slugStatus,
  submitApplication,
} from '../src'

const { platform, app } = testDbs()
const today = '2026-10-10'
const ids: Record<string, string> = {}
const now = new Date('2026-10-10T08:00:00Z')
const later = (months: number) => {
  const d = new Date(now)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d
}
const slugOf = async (id: string) =>
  (await platform.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, id)))[0]?.slug

beforeAll(async () => {
  await resetTestDatabase()
  await platform.insert(plans).values({ code: 'std', name: 'Standard', priceAed: '24000' })
  await platform.insert(user).values([
    { id: 'u-a', name: 'A', email: 'a@slug.test' },
    { id: 'u-b', name: 'B', email: 'b@slug.test' },
    { id: 'u-c', name: 'C', email: 'c@slug.test' },
  ])
  ids.a = (await provisionTenant(platform, { userId: 'u-a', businessName: 'Lotus', slug: 'lotus', today })).id
  ids.b = (
    await provisionTenant(platform, { userId: 'u-b', businessName: 'Jasmine', slug: 'jasmine', today })
  ).id
})
afterAll(closeAllDbs)

describe('renameTenantSlug', () => {
  it('validates like the Apply form: format, reserved names, a live spa, a pending application, unchanged', async () => {
    const rename = (slug: string) => renameTenantSlug(platform, { tenantId: ids.a!, slug, now })
    await expect(rename('ab')).rejects.toThrow('Use 3–40 lowercase letters')
    await expect(rename('admin')).rejects.toThrow('This name is reserved.')
    await expect(rename('jasmine')).rejects.toThrow('That address is taken.')
    await expect(rename('lotus')).rejects.toThrow('already this spa’s address')
    await submitApplication(platform, {
      userId: 'u-c',
      applicantName: 'C',
      email: 'c@slug.test',
      phone: '+971501234567',
      spaName: 'Held',
      slug: 'held-spa',
      emirate: 'dubai',
      streetAddress: 'Marina',
      planId: null,
      preferredStart: today,
      today,
    })
    await expect(rename('held-spa')).rejects.toThrow('That address is taken.')
    expect(await slugOf(ids.a!)).toBe('lotus')
  })

  it('renames (normalised), records the old slug reserved for 12 months, and maps it for redirects', async () => {
    const r = await renameTenantSlug(platform, {
      tenantId: ids.a!,
      slug: '  Lotus Marina ',
      actorUserId: 'u-a',
      now,
    })
    expect(r).toMatchObject({ from: 'lotus', to: 'lotus-marina' })
    expect(SLUG_COOLING_MONTHS).toBe(12)
    expect(r.reservedUntil.toISOString()).toBe(slugReservedUntil(now).toISOString())
    expect(r.reservedUntil.toISOString()).toBe('2027-10-10T08:00:00.000Z')
    expect(await slugOf(ids.a!)).toBe('lotus-marina')
    const [row] = await platform.select().from(tenantSlugHistory).where(eq(tenantSlugHistory.slug, 'lotus'))
    expect(row).toMatchObject({ renamedTenantId: ids.a, renamedBy: 'u-a' })
    expect(Object.fromEntries(await slugRedirects(platform))).toEqual({ lotus: 'lotus-marina' })
    expect((await slugHistoryOf(platform, ids.a!)).map((h) => h.slug)).toEqual(['lotus'])
  })

  it('keeps the old address from everyone else during the cooling period (rename, Apply, provisioning)', async () => {
    await expect(renameTenantSlug(platform, { tenantId: ids.b!, slug: 'lotus', now })).rejects.toThrow(
      'That address is taken.',
    )
    expect(await slugStatus(platform, 'lotus', { now })).toBe('previous')
    await expect(
      provisionTenant(platform, { userId: 'u-c', businessName: 'Copy', slug: 'lotus', today }),
    ).rejects.toThrow('That address is taken.')
  })

  it('follows chains to the current slug, and lets the spa take an old address back', async () => {
    await renameTenantSlug(platform, { tenantId: ids.a!, slug: 'lotus-jbr', now: later(1) })
    expect(Object.fromEntries(await slugRedirects(platform))).toEqual({
      lotus: 'lotus-jbr',
      'lotus-marina': 'lotus-jbr',
    })
    await renameTenantSlug(platform, { tenantId: ids.a!, slug: 'lotus', now: later(2) })
    expect(await slugOf(ids.a!)).toBe('lotus')
    // The live address no longer redirects; the two others point at it.
    expect(Object.fromEntries(await slugRedirects(platform))).toEqual({
      'lotus-marina': 'lotus',
      'lotus-jbr': 'lotus',
    })
    expect((await slugHistoryOf(platform, ids.a!)).map((h) => h.slug).sort()).toEqual([
      'lotus-jbr',
      'lotus-marina',
    ])
  })

  it('after the cooling period another spa may claim it: the row goes, the address stops redirecting', async () => {
    const after = later(1 + SLUG_COOLING_MONTHS + 1)
    expect(await slugStatus(platform, 'lotus-marina', { now: after })).toBe('free')
    await renameTenantSlug(platform, { tenantId: ids.b!, slug: 'lotus-marina', now: after })
    expect(await slugOf(ids.b!)).toBe('lotus-marina')
    const map = Object.fromEntries(await slugRedirects(platform))
    expect(map).toEqual({ 'lotus-jbr': 'lotus', jasmine: 'lotus-marina' })
  })

  it('is platform-only: a spa’s app role sees no rows', async () => {
    expect(await app.select().from(tenantSlugHistory)).toHaveLength(0)
  })
})
