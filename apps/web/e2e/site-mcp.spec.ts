import { createHash, randomBytes } from 'node:crypto'
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { auditLog, pageVersions, sitePages } from '@spa/db'
import { ensureSite } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import {
  admin,
  base,
  makeSiteAiEditor,
  makeStudio,
  passTwoFactor,
  seedCatalog,
  signUpOwner,
  testDb,
} from './helpers'

// Claude custom connector, end to end against the real server: discovery (RFC 9728 / 8414) → dynamic client
// registration → authorize (sign-in + 2FA resumes the flow) → consent → code + PKCE → token → MCP tools → console
// revoke. Only SITE_AI_EDITOR_EMAILS (playwright.config.ts: owner-mcp-editor@e2e.test) may connect.

const MCP = `${base}/api/mcp`
/** Claude's real callback; the browser route below answers it locally (no network). */
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'
const PASSWORD = 'correct-horse-battery'

const homePage = {
  root: { props: { title: { en: 'Home' } } },
  content: [{ type: 'Heading', props: { id: 'h1', text: { en: 'Slow down' } } }],
}

/** Node's resolver doesn't know `*.localhost` (Chromium does): API calls from the test go to the same server. */
const viaNode = (url: string) => url.replace(/\/\/[a-z0-9.-]+\.localhost(?=[:/])/, '//localhost')

let rpcId = 0
const rpc = (request: APIRequestContext, token: string | null, method: string, params: unknown = {}) =>
  request.post(MCP, {
    headers: {
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    data: { jsonrpc: '2.0', id: ++rpcId, method, params },
  })

async function discover(request: APIRequestContext) {
  const challenge = await rpc(request, null, 'tools/list')
  expect(challenge.status()).toBe(401)
  const metaUrl = /resource_metadata="([^"]+)"/.exec(challenge.headers()['www-authenticate'] ?? '')?.[1]
  expect(metaUrl).toBe(`${base}/.well-known/oauth-protected-resource/api/mcp`)
  const resource = (await (await request.get(metaUrl!)).json()) as {
    resource: string
    authorization_servers: string[]
  }
  expect(resource.resource).toBe(MCP)
  const issuer = new URL(resource.authorization_servers[0]!)
  const asMeta = await request.get(
    viaNode(`${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname}`),
  )
  expect(asMeta.ok()).toBe(true)
  return (await asMeta.json()) as {
    authorization_endpoint: string
    token_endpoint: string
    registration_endpoint: string
    code_challenge_methods_supported: string[]
  }
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

const authorizeUrl = (endpoint: string, clientId: string, challenge: string) =>
  `${endpoint}?${new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CALLBACK,
    scope: 'openid offline_access sites:edit',
    state: 'xyz',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: MCP,
  })}`

/** Answers Claude's callback in the browser (no network) once the flow sends the browser back. */
const fakeClaudeCallback = (page: Page) =>
  page.route(`${CALLBACK}**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: 'back in Claude' }),
  )

test('Claude MCP connector: OAuth (DCR + PKCE + 2FA) → tools edit the draft → revoke', async ({
  page,
  browser,
  request,
}) => {
  const { slug, email } = await signUpOwner(page, { spa: 'Connector Spa', slug: 'mcp-editor' })
  await makeSiteAiEditor(slug)
  const seed = await seedCatalog(slug)
  const db = testDb()
  await db.transaction((tx) =>
    ensureSite(tx, seed.tenantId, {
      key: 'nordic',
      name: 'Nordic Clean',
      theme: { accent: '#5e7d6b' },
      pages: [{ slug: '', title: { en: 'Home' }, data: homePage }],
    }),
  )
  const [home] = await db.select().from(sitePages).where(eq(sitePages.tenantId, seed.tenantId))

  const as = await discover(request)
  expect(as.code_challenge_methods_supported).toContain('S256')
  const reg = await request.post(viaNode(as.registration_endpoint), {
    data: {
      client_name: 'Claude',
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  })
  expect(reg.status(), await reg.text()).toBeLessThan(300)
  const clientId = ((await reg.json()) as { client_id: string }).client_id

  // A fresh browser (as when Claude opens the sign-in window): sign-in + 2FA, then the flow resumes to consent.
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  const { verifier, challenge } = pkce()
  await fakeClaudeCallback(p)
  await p.goto(authorizeUrl(as.authorization_endpoint, clientId, challenge))
  // Hydrated forms only: a native (pre-hydration) submit would drop the signed authorization query.
  await p.waitForLoadState('networkidle')
  await p.getByLabel('Email').fill(email)
  await p.getByLabel('Password').fill(PASSWORD)
  await p.getByRole('button', { name: 'Sign in' }).click()
  await p.waitForURL(/\/two-factor\?.*sig=/)
  await p.waitForLoadState('networkidle')
  await passTwoFactor(p, email)
  await expect(p.getByRole('heading', { name: 'Connect Claude' })).toBeVisible()
  await expect(p.getByText('Claude wants to edit spa websites for you.')).toBeVisible()
  // Clicked again if the first click landed before hydration (dev server).
  await expect(async () => {
    if (!p.url().startsWith(CALLBACK)) await p.getByRole('button', { name: 'Allow' }).click({ timeout: 2000 })
    await p.waitForURL((u) => u.href.startsWith(CALLBACK), { timeout: 5000 })
  }).toPass({ timeout: 30_000 })
  const back = new URL(p.url())
  expect(back.searchParams.get('state')).toBe('xyz')

  const tokenRes = await request.post(viaNode(as.token_endpoint), {
    form: {
      grant_type: 'authorization_code',
      code: back.searchParams.get('code')!,
      redirect_uri: CALLBACK,
      client_id: clientId,
      code_verifier: verifier,
      resource: MCP,
    },
  })
  expect(tokenRes.ok()).toBe(true)
  const token = ((await tokenRes.json()) as { access_token: string }).access_token

  await test.step('MCP: initialize, tools, get_site, update_block → draft only', async () => {
    const init = await rpc(request, token, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'e2e', version: '1' },
    })
    expect(init.status()).toBe(200)
    const tools = (await (await rpc(request, token, 'tools/list')).json()) as {
      result: { tools: { name: string }[] }
    }
    const names = tools.result.tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['list_spas', 'get_site', 'update_block', 'preview_link']))
    expect(names.some((n) => n.includes('publish'))).toBe(false)
    const call = async (name: string, args: Record<string, unknown>) => {
      const res = await rpc(request, token, 'tools/call', { name, arguments: args })
      expect(res.status()).toBe(200)
      const body = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } }
      expect(body.result.isError ?? false).toBe(false)
      return JSON.parse(body.result.content[0]!.text)
    }
    const site = await call('get_site', { spa: slug })
    expect(JSON.stringify(site.pages[0].data)).toContain('"id":"h1"')
    const r = await call('update_block', {
      spa: slug,
      page: 'home',
      block_id: 'h1',
      props: { text: { en: 'Golden calm' } },
    })
    expect(r.saved).toBe(true)
    const versions = await db.select().from(pageVersions).where(eq(pageVersions.pageId, home!.id))
    expect(versions.every((v) => v.status === 'draft')).toBe(true)
    expect(JSON.stringify(versions[0]!.data)).toContain('Golden calm')
    const audited = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, seed.tenantId), eq(auditLog.action, 'site.mcp.update_block')))
    expect(audited[0]!.data).toMatchObject({ via: 'via Claude (MCP)' })
  })

  await test.step('console: Connect Claude card lists the client; Revoke cuts access at once', async () => {
    await p.goto(`${admin}/login`)
    await p.waitForLoadState('networkidle')
    await p.getByLabel('Email').fill(email)
    await p.getByLabel('Password').fill(PASSWORD)
    await p.getByRole('button', { name: 'Sign in' }).click()
    await p.waitForURL(/\/two-factor/)
    await p.waitForLoadState('networkidle')
    await passTwoFactor(p, email)
    await expect(p.getByRole('heading', { name: 'Overview' })).toBeVisible()
    await p.goto(`${admin}/websites`)
    const card = p.getByRole('region', { name: 'Connect Claude' })
    await expect(card.getByText(MCP)).toBeVisible()
    const clients = card.getByRole('list', { name: 'Connected clients' })
    await expect(clients).toContainText('Claude')
    await clients.getByRole('button', { name: 'Revoke' }).click()
    await expect(p.getByText('Disconnected')).toBeVisible()
    const after = await rpc(request, token, 'tools/list')
    expect(after.status()).toBe(401)
  })
  await ctx.close()
})

test('Claude MCP connector: a super-admin outside SITE_AI_EDITOR_EMAILS cannot authorize', async ({
  page,
  request,
}) => {
  const { slug } = await signUpOwner(page, { spa: 'Not Listed Spa' })
  await makeStudio(slug)
  const as = await discover(request)
  const reg = await request.post(viaNode(as.registration_endpoint), {
    data: { client_name: 'Claude', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' },
  })
  const clientId = ((await reg.json()) as { client_id: string }).client_id
  await page.goto(authorizeUrl(as.authorization_endpoint, clientId, pkce().challenge))
  await expect(page.getByText('Connecting Claude is not enabled for your account.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Allow' })).toHaveCount(0)
  // The consent API refuses too (server-side check in the auth hook).
  const status = await page.evaluate(async () => {
    const r = await fetch('/api/auth/oauth2/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accept: true }),
    })
    return r.status
  })
  expect(status).toBe(403)
})
