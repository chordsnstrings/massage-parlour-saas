import { closeAllDbs, oauthClient, oauthConsent, user } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pruneUnusedOAuthClients } from '../src'

const { platform } = testDbs()

beforeAll(() => resetTestDatabase())
afterAll(() => closeAllDbs())

describe('dynamic OAuth clients (Claude MCP connector)', () => {
  it('prunes clients nobody approved within a day; keeps approved and recent ones', async () => {
    const now = new Date('2026-10-09T12:00:00Z')
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000)
    await platform.insert(user).values({ id: 'u-prune', name: 'Owner', email: 'prune@oauth.test' })
    const client = (id: string, createdAt: Date) => ({
      id,
      clientId: id,
      redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
      createdAt,
    })
    await platform
      .insert(oauthClient)
      .values([
        client('old-unused', hoursAgo(30)),
        client('old-approved', hoursAgo(30)),
        client('fresh-unused', hoursAgo(2)),
      ])
    await platform
      .insert(oauthConsent)
      .values({ id: 'c1', clientId: 'old-approved', userId: 'u-prune', scopes: ['sites:edit'] })
    expect(await pruneUnusedOAuthClients(platform, { now })).toEqual(['old-unused'])
    const left = (await platform.select({ id: oauthClient.clientId }).from(oauthClient)).map((r) => r.id)
    expect(left.sort()).toEqual(['fresh-unused', 'old-approved'])
    expect(await pruneUnusedOAuthClients(platform, { now })).toEqual([])
  })
})
