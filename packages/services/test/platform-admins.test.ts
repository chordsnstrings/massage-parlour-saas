// Super-admin bootstrap (owner, 2026-10-09): join gate for PLATFORM_ADMIN_EMAILS, the console roster, and
// "Mark email verified" — only for listed logins, only by a super-admin with 2FA, never on yourself.
import { closeAllDbs, platformAdmins, user } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertAdminJoinAllowed, markListedAdminVerified, superAdminRoster } from '../src'

const { platform } = testDbs()
const LISTED = ['boss@adm.test', 'new@adm.test', 'joined@adm.test', 'nologin@adm.test', 'off@adm.test']

const mk = (id: string, email: string, extra: Partial<typeof user.$inferInsert> = {}) => ({
  id,
  name: id,
  email,
  ...extra,
})

beforeAll(async () => {
  await resetTestDatabase()
  await platform
    .insert(user)
    .values([
      mk('boss', 'boss@adm.test', { emailVerified: true, twoFactorEnabled: true }),
      mk('no2fa', 'no2fa@adm.test', { emailVerified: true, twoFactorEnabled: false }),
      mk('new', 'new@adm.test'),
      mk('joined', 'joined@adm.test', { emailVerified: true }),
      mk('stranger', 'stranger@adm.test'),
      mk('off', 'off@adm.test', { disabledAt: new Date() }),
    ])
  await platform.insert(platformAdmins).values([{ userId: 'boss' }, { userId: 'no2fa' }])
})
afterAll(closeAllDbs)

const isAdmin = async (id: string) =>
  (await platform.select().from(platformAdmins).where(eq(platformAdmins.userId, id))).length === 1

describe('super-admin join gate', () => {
  it('only PLATFORM_ADMIN_EMAILS addresses may join (case-insensitive), with a neutral refusal', () => {
    expect(() => assertAdminJoinAllowed(' NEW@adm.test ', LISTED)).not.toThrow()
    expect(() => assertAdminJoinAllowed('stranger@adm.test', LISTED)).toThrow(
      'This email address cannot create a super-admin account.',
    )
    expect(() => assertAdminJoinAllowed('new@adm.test', [])).toThrow()
  })
})

describe('super-admins roster', () => {
  it('lists super-admins (verified, 2FA, listed) and listed emails that are not super-admins yet', async () => {
    const { admins, pending } = await superAdminRoster(platform, LISTED)
    expect(admins.map((a) => [a.email, a.verified, a.twoFactor, a.listed])).toEqual([
      ['boss@adm.test', true, true, true],
      ['no2fa@adm.test', true, false, false],
    ])
    expect(pending).toEqual([
      { email: 'new@adm.test', userId: 'new', name: 'new', verified: false, disabled: false },
      { email: 'joined@adm.test', userId: 'joined', name: 'joined', verified: true, disabled: false },
      { email: 'nologin@adm.test', userId: null, name: null, verified: false, disabled: false },
      { email: 'off@adm.test', userId: 'off', name: 'off', verified: false, disabled: true },
    ])
  })
})

describe('mark email verified', () => {
  it('is refused for an actor without 2FA or without a super-admin row', async () => {
    await expect(
      markListedAdminVerified(platform, { actorUserId: 'no2fa', userId: 'new' }, LISTED),
    ).rejects.toThrow('Only a super-admin with two-step verification can confirm super-admins.')
    await expect(
      markListedAdminVerified(platform, { actorUserId: 'stranger', userId: 'new' }, LISTED),
    ).rejects.toThrow('Only a super-admin with two-step verification')
    expect(await isAdmin('new')).toBe(false)
  })

  it('is refused for an unlisted, disabled or unknown login, and for yourself', async () => {
    const only = 'Only a login whose email is in PLATFORM_ADMIN_EMAILS can be confirmed here.'
    for (const userId of ['stranger', 'off', 'missing'])
      await expect(
        markListedAdminVerified(platform, { actorUserId: 'boss', userId }, LISTED),
      ).rejects.toThrow(only)
    await expect(
      markListedAdminVerified(platform, { actorUserId: 'boss', userId: 'boss' }, LISTED),
    ).rejects.toThrow('You are already a super-admin.')
    const [stranger] = await platform.select().from(user).where(eq(user.id, 'stranger'))
    expect(stranger?.emailVerified).toBe(false)
    expect(await isAdmin('stranger')).toBe(false)
    expect(await isAdmin('off')).toBe(false)
  })

  it('verifies a listed login and promotes it at once; a verified one is just promoted', async () => {
    expect(await markListedAdminVerified(platform, { actorUserId: 'boss', userId: 'new' }, LISTED)).toEqual({
      email: 'new@adm.test',
      markedVerified: true,
      promoted: true,
    })
    const [row] = await platform.select().from(user).where(eq(user.id, 'new'))
    expect(row?.emailVerified).toBe(true)
    expect(await isAdmin('new')).toBe(true)
    expect(
      await markListedAdminVerified(platform, { actorUserId: 'boss', userId: 'joined' }, LISTED),
    ).toEqual({ email: 'joined@adm.test', markedVerified: false, promoted: true })
    // Idempotent: a second confirm changes nothing.
    expect(await markListedAdminVerified(platform, { actorUserId: 'boss', userId: 'new' }, LISTED)).toEqual({
      email: 'new@adm.test',
      markedVerified: false,
      promoted: false,
    })
    const { pending } = await superAdminRoster(platform, LISTED)
    expect(pending.map((p) => p.email)).toEqual(['nologin@adm.test', 'off@adm.test'])
  })
})
