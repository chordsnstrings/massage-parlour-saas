import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { grantListedPlatformAdmins, listedAdminEmails } from '../src/admins'
import { closeAllDbs } from '../src/client'
import { platformAdmins, user } from '../src/schema'
import { seedPlatform } from '../src/seed'
import { resetTestDatabase, testDbs } from '../src/testing'

const { platform } = testDbs()
const mk = (id: string, email: string, emailVerified: boolean) => ({ id, name: id, email, emailVerified })

beforeAll(async () => {
  await resetTestDatabase()
  await platform
    .insert(user)
    .values([
      mk('u-unverified', 'boss@x.test', false),
      mk('u-verified', 'ops@x.test', true),
      mk('u-old-admin', 'old@x.test', false),
    ])
  await platform.insert(platformAdmins).values({ userId: 'u-old-admin' })
})
afterAll(closeAllDbs)

describe('PLATFORM_ADMIN_EMAILS promotion (G2)', () => {
  it('parses the env list', () => {
    expect(listedAdminEmails(' A@x.test, ,b@x.test ')).toEqual(['a@x.test', 'b@x.test'])
  })

  it('promotes only verified listed emails and never demotes existing super-admins', async () => {
    await seedPlatform(platform, ['BOSS@x.test', 'ops@x.test'])
    const ids = (await platform.select().from(platformAdmins)).map((r) => r.userId).sort()
    expect(ids).toEqual(['u-old-admin', 'u-verified'])
    // Scoped to one user (console visit / provisioning): the unverified one still gets nothing.
    expect(await grantListedPlatformAdmins(platform, ['boss@x.test'], 'u-unverified')).toBe(0)
  })
})
