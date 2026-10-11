import {
  auditLog,
  closeAllDbs,
  oauthClient,
  oauthConsent,
  pageVersions,
  platformAdmins,
  sitePages,
  tenants,
  user,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { ensureSite, getEditablePage, publishPage } from '@spa/services'
import type { SiteEditSchema } from '@spa/services/site-kit'
import { and, eq, like } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleSiteMcpRequest, SITE_MCP_TOOL_NAMES, type SiteMcpOpts } from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>

const schema: SiteEditSchema = {
  blocks: {
    Heading: { label: 'Heading', props: { text: { kind: 'bi' } }, defaults: { text: { en: 'Heading' } } },
  },
  root: { title: { kind: 'bi' } },
  theme: { accent: { kind: 'color' } },
  presets: [],
}
const EDITORS = ['owner@mcp.test', 'no2fa@mcp.test']
/** Test tokens stand in for Better Auth access tokens (their verification is the auth package's job). */
const TOKENS: Record<string, { userId: string; clientId: string; tokenId: string }> = {}

const opts = (over: Partial<SiteMcpOpts> = {}): SiteMcpOpts => ({
  verifyToken: async (t) => TOKENS[t] ?? null,
  schema,
  resourceMetadataUrl: 'http://localhost/.well-known/oauth-protected-resource/api/mcp',
  appUrl: (p) => `http://app.localhost${p}`,
  adminUrl: (p) => `http://admin.localhost${p}`,
  previewSecret: 'preview-secret',
  editorEmails: EDITORS,
  platform,
  app,
  ...over,
})

let rpcId = 0
const rpc = (token: string | null, method: string, params: unknown = {}, o = opts()) =>
  handleSiteMcpRequest(
    new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    }),
    o,
  )
const call = async (token: string, name: string, args: Record<string, unknown>) => {
  const res = await rpc(token, 'tools/call', { name, arguments: args })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } }
  return { isError: Boolean(body.result.isError), data: JSON.parse(body.result.content[0]!.text) }
}

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'mcp-spa', name: 'MCP Spa' }).returning()
  ids.tenant = t!.id
  await withTenant(
    t!.id,
    (tx) =>
      ensureSite(tx, t!.id, {
        key: 'zen',
        name: 'Zen',
        theme: { accent: '#111111' },
        pages: [
          {
            slug: '',
            title: { en: 'Home' },
            data: {
              root: { props: {} },
              content: [{ type: 'Heading', props: { id: 'h1', text: { en: 'Slow down' } } }],
            },
          },
        ],
      }),
    app,
  )
  const [home] = await withTenant(t!.id, (tx) => tx.select().from(sitePages), app)
  ids.home = home!.id
  await withTenant(t!.id, (tx) => publishPage(tx, { tenantId: t!.id, pageId: home!.id }), app)
  const mk = async (email: string, admin: boolean, twoFactor: boolean) => {
    const id = `u-${email}`
    await platform
      .insert(user)
      .values({ id, name: email, email, emailVerified: true, twoFactorEnabled: twoFactor })
    if (admin) await platform.insert(platformAdmins).values({ userId: id })
    return id
  }
  ids.owner = await mk('owner@mcp.test', true, true)
  ids.otherAdmin = await mk('other@mcp.test', true, true)
  ids.no2fa = await mk('no2fa@mcp.test', true, false)
  await platform.insert(oauthClient).values({
    id: 'c1',
    clientId: 'claude-client',
    name: 'Claude',
    redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
  })
  for (const u of [ids.owner, ids.otherAdmin, ids.no2fa])
    await platform
      .insert(oauthConsent)
      .values({ id: `consent-${u}`, clientId: 'claude-client', userId: u, scopes: ['sites:edit'] })
  TOKENS.owner = { userId: ids.owner!, clientId: 'claude-client', tokenId: 't-owner' }
  TOKENS.other = { userId: ids.otherAdmin!, clientId: 'claude-client', tokenId: 't-other' }
  TOKENS.no2fa = { userId: ids.no2fa!, clientId: 'claude-client', tokenId: 't-no2fa' }
})
afterAll(() => closeAllDbs())

describe('site MCP server (/api/mcp)', () => {
  it('401 with the RFC 9728 challenge without or with a bad token', async () => {
    const none = await rpc(null, 'tools/list')
    expect(none.status).toBe(401)
    expect(none.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource/api/mcp"',
    )
    const bad = await rpc('forged', 'tools/list')
    expect(bad.status).toBe(401)
    expect(bad.headers.get('www-authenticate')).toContain('error="invalid_token"')
  })

  it('403 for a super-admin outside SITE_AI_EDITOR_EMAILS and for a listed one without 2FA', async () => {
    expect((await rpc('other', 'tools/list')).status).toBe(403)
    expect((await rpc('no2fa', 'tools/list')).status).toBe(403)
    // Empty allow-list = nobody, even the owner.
    expect((await rpc('owner', 'tools/list', {}, opts({ editorEmails: [] }))).status).toBe(403)
  })

  it('initialize + list tools: the ops, and no publish tool', async () => {
    const init = await rpc('owner', 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    })
    expect(init.status).toBe(200)
    expect(((await init.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe(
      'spamanagement-sites',
    )
    const list = (await (await rpc('owner', 'tools/list')).json()) as {
      result: { tools: { name: string }[] }
    }
    const names = list.result.tools.map((t) => t.name)
    expect(names.sort()).toEqual([...SITE_MCP_TOOL_NAMES].sort())
    expect(names).toEqual(
      expect.arrayContaining(['list_spas', 'get_site', 'update_block', 'set_theme', 'preview_link']),
    )
    expect(names.some((n) => n.includes('publish'))).toBe(false)
  })

  it('get_site and update_block edit the draft only, audited via Claude (MCP)', async () => {
    const site = await call('owner', 'get_site', { spa: 'mcp-spa' })
    expect(site.data.pages[0].data.content[0]).toMatchObject({ id: 'h1', type: 'Heading' })
    // R23: the owner previews and publishes in the console.
    expect(site.data.console_url).toBe('http://admin.localhost/websites/mcp-spa')
    const dry = await call('owner', 'update_block', {
      spa: 'mcp-spa',
      page: 'home',
      block_id: 'h1',
      props: { text: { en: 'Preview only' } },
      dry_run: true,
    })
    expect(dry.data.saved).toBe(false)
    const draft = async () =>
      JSON.stringify(
        (await withTenant(ids.tenant!, (tx) => getEditablePage(tx, ids.tenant!, ids.home!), app))!.data,
      )
    expect(await draft()).not.toContain('Preview only')
    const r = await call('owner', 'update_block', {
      spa: 'mcp-spa',
      page: 'home',
      block_id: 'h1',
      props: { text: { en: 'Golden calm', ar: 'هدوء ذهبي' } },
    })
    expect(r.isError).toBe(false)
    expect(r.data.saved).toBe(true)
    expect(r.data.summary).toEqual(['Home: Updated Heading (text)'])
    expect(await draft()).toContain('Golden calm')
    const versions = await withTenant(
      ids.tenant!,
      (tx) => tx.select().from(pageVersions).where(eq(pageVersions.pageId, ids.home!)),
      app,
    )
    const live = versions.find((v) => v.status === 'published')!
    expect(JSON.stringify(live.data)).toContain('Slow down')
    const bad = await call('owner', 'update_block', {
      spa: 'mcp-spa',
      page: 'home',
      block_id: 'h1',
      props: { colour: 'red' },
    })
    expect(bad.isError).toBe(true)
    expect(bad.data.error).toMatch(/Nothing was changed: .*no prop "colour"/)
    const rows = await platform.select().from(auditLog).where(like(auditLog.action, 'site.mcp.%'))
    const update = rows.find((x) => x.action === 'site.mcp.update_block' && (x.data as { ok?: boolean }).ok)
    expect(update).toMatchObject({ tenantId: ids.tenant, actorUserId: ids.owner })
    expect(update!.data).toMatchObject({ via: 'via Claude (MCP)', client: 'Claude', ops: ['update'] })
    expect(rows.some((x) => x.action === 'site.mcp.get_site')).toBe(true)
  })

  it('preview_link signs a draft preview URL', async () => {
    const r = await call('owner', 'preview_link', { spa: 'mcp-spa', days: 1 })
    expect(r.data.url).toMatch(/^http:\/\/app\.localhost\/website\/preview\?token=/)
  })

  it('rate-limits per token and stops at once when the consent is revoked', async () => {
    const o = opts({ rateLimit: 2 })
    TOKENS.burst = { ...TOKENS.owner!, tokenId: 't-burst' }
    expect((await rpc('burst', 'tools/list', {}, o)).status).toBe(200)
    expect((await rpc('burst', 'tools/list', {}, o)).status).toBe(200)
    expect((await rpc('burst', 'tools/list', {}, o)).status).toBe(429)
    await platform
      .delete(oauthConsent)
      .where(and(eq(oauthConsent.userId, ids.owner!), eq(oauthConsent.clientId, 'claude-client')))
    const revoked = await rpc('owner', 'tools/list')
    expect(revoked.status).toBe(401)
    expect(revoked.headers.get('www-authenticate')).toContain('invalid_token')
  })
})
