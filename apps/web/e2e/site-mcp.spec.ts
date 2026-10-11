import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import {
  auditLog,
  mediaAssets,
  oauthClient,
  oauthConsent,
  pageVersions,
  sitePages,
  sites,
  storedFiles,
  user,
} from '@spa/db'
import { ensureSite, publishPage, saveStudioTemplate } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import sharp from 'sharp'
import {
  admin,
  base,
  makeSiteAiEditor,
  makeStudio,
  PNG,
  PORT,
  passTwoFactor,
  seedCatalog,
  signUpOwner,
  site,
  testDb,
} from './helpers'

// AI assistant connector (Claude + ChatGPT, R25), end to end against the real server: discovery (RFC 9728 / 8414)
// → dynamic client registration → authorize (sign-in + 2FA resumes the flow) → consent → code + PKCE → token → MCP
// tools → console revoke. Only SITE_AI_EDITOR_EMAILS (playwright.config.ts: owner-mcp-editor@e2e.test,
// owner-gpt-editor@e2e.test) may connect.

const MCP = `${base}/api/mcp`
/** Claude's real callback; the browser route below answers it locally (no network). */
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'
/** ChatGPT's callbacks (OpenAI Apps SDK auth): the stable one and the per-connector fallback. */
const CHATGPT_STABLE = 'https://chatgpt.com/connector_platform_oauth_redirect'
const PASSWORD = 'correct-horse-battery'

const homePage = {
  root: { props: { title: { en: 'Home' } } },
  content: [
    {
      type: 'Heading',
      props: { id: 'h1', eyebrow: { en: '' }, text: { en: 'Slow down' }, level: 'h2', size: 'lg' },
    },
  ],
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

/** One tools/call: the parsed JSON result and whether it is an error. */
async function tool(request: APIRequestContext, token: string, name: string, args: Record<string, unknown>) {
  const res = await rpc(request, token, 'tools/call', { name, arguments: args })
  expect(res.status()).toBe(200)
  const body = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } }
  return { isError: Boolean(body.result.isError), data: JSON.parse(body.result.content[0]!.text) }
}

type AsMeta = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint: string
  code_challenge_methods_supported: string[]
  token_endpoint_auth_methods_supported: string[]
  authorization_response_iss_parameter_supported?: boolean
  scopes_supported: string[]
}

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
  const as = (await asMeta.json()) as AsMeta
  // ChatGPT (and the MCP spec) require the issuer to match the resource metadata exactly.
  expect(as.issuer).toBe(resource.authorization_servers[0])
  return as
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

const authorizeUrl = (
  endpoint: string,
  clientId: string,
  challenge: string,
  redirect = CALLBACK,
  scope = 'openid offline_access sites:edit',
) =>
  `${endpoint}?${new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirect,
    scope,
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
  // Only Claude's callback can be registered: nobody can register "Claude" with their own redirect and phish consent.
  const evil = await request.post(viaNode(as.registration_endpoint), {
    data: {
      client_name: 'Claude',
      redirect_uris: ['https://evil.example/cb'],
      token_endpoint_auth_method: 'none',
    },
  })
  expect(evil.status()).toBe(400)
  expect(await evil.text()).toContain('invalid_redirect_uri')

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
  await expect(p.getByRole('heading', { name: 'Connect your AI assistant' })).toBeVisible()
  await expect(p.getByText('Claude wants to edit spa websites for you.')).toBeVisible()
  // Where the code goes is shown, not only the name the client picked.
  await expect(p.getByTestId('oauth-redirect-host')).toHaveText('Approving sends access to claude.ai.')
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
  // The grant itself is audited (the console revoke is too).
  const granted = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, 'platform.mcp.client_authorized'))
  expect(granted.find((g) => (g.data as { clientId?: string }).clientId === clientId)?.data).toMatchObject({
    redirectHost: 'claude.ai',
    client: 'Claude',
  })

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
    expect(audited[0]!.data).toMatchObject({ via: 'via AI assistant (MCP)' })
  })

  await test.step('R24: templates, HTML designs and add_image change drafts only', async () => {
    test.setTimeout(240_000)
    const ok = async (name: string, args: Record<string, unknown>) => {
      const r = await tool(request, token, name, { spa: slug, ...args })
      expect(r.isError, JSON.stringify(r.data)).toBe(false)
      return r.data
    }
    // The live site: the home page as published now.
    await db.transaction((tx) => publishPage(tx, { tenantId: seed.tenantId, pageId: home!.id }))
    const liveHome = async () => {
      await page.goto(`${site(slug)}/`)
      await expect(page.getByRole('heading', { name: 'Golden calm' })).toBeVisible()
    }
    await liveHome()
    const publishedCount = async () =>
      (
        await db
          .select({ id: pageVersions.id })
          .from(pageVersions)
          .where(and(eq(pageVersions.tenantId, seed.tenantId), eq(pageVersions.status, 'published')))
      ).length
    expect(await publishedCount()).toBe(1)

    // list_templates: the built-ins and an uploaded HTML design template.
    await saveStudioTemplate(db, {
      key: 'mcp-sand-silk',
      name: 'Sand Silk',
      description: 'Uploaded HTML design',
      theme: { accent: '#d4b483' },
      active: true,
      pages: [
        {
          slug: '',
          title: { en: 'Home' },
          data: {
            root: { props: { htmlDesign: true } },
            content: [
              {
                type: 'HtmlDesign',
                props: { id: 'sand-html-design', html: '<!doctype html><h1>Sand</h1>', phoneFixes: false },
              },
            ],
          },
        },
      ],
    })
    const list = await ok('list_templates', {})
    expect(list.current).toBe('nordic')
    const byKey = new Map(list.templates.map((t: { key: string }) => [t.key, t]))
    expect(byKey.get('zen')).toMatchObject({ kind: 'classic', source: 'builtin' })
    expect(byKey.get('mcp-sand-silk')).toMatchObject({ kind: 'html', source: 'studio' })
    expect(list.templates.length).toBeGreaterThanOrEqual(24)

    // apply_template: dry run, then the switch as drafts; the live site keeps its page and theme.
    const themeBefore = (await db.select().from(sites).where(eq(sites.tenantId, seed.tenantId)))[0]!.theme
    const dry = await ok('apply_template', { template: 'zen', dry_run: true })
    expect(dry.saved).toBe(false)
    expect((await db.select().from(sites).where(eq(sites.tenantId, seed.tenantId)))[0]!.templateKey).toBe(
      'nordic',
    )
    const applied = await ok('apply_template', { template: 'zen' })
    expect(applied).toMatchObject({ saved: true, theme: 'draft' })
    const [after] = await db.select().from(sites).where(eq(sites.tenantId, seed.tenantId))
    expect(after).toMatchObject({ templateKey: 'zen', theme: themeBefore })
    expect(after!.themeDraft).not.toBeNull()
    expect(await publishedCount()).toBe(1)
    await liveHome()
    const homePreview = await ok('preview_link', { page: 'home', days: 1 })
    expect((await page.goto(homePreview.url))?.status()).toBe(200)
    await expect(page.locator('body')).not.toContainText('Golden calm')

    // set_html_design → get_html_design (exactly as sent, embedded image still data:) → patch_html_design → preview.
    await ok('add_page', { slug: 'story', title_en: 'Story' })
    const img = await sharp(randomBytes(64 * 64 * 3), { raw: { width: 64, height: 64, channels: 3 } })
      .png()
      .toBuffer()
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Story</title></head><body><h1 id="t">Our story</h1><p>Calm hands.</p><p>Calm hands.</p><img id="i" src="data:image/png;base64,${img.toString('base64')}" width="64" height="64" alt=""></body></html>`
    const set = await ok('set_html_design', { page: 'story', html })
    expect(set.html_designs[0]).toMatchObject({
      page: 'story',
      stored: 'exactly as sent',
      phone_fixes: false,
    })
    const got = await ok('get_html_design', { page: 'story', search: 'Calm hands.' })
    expect(got.html).toBe(html)
    expect(got.match_count).toBe(2)
    const ambiguous = await tool(request, token, 'patch_html_design', {
      spa: slug,
      page: 'story',
      edits: [{ find: 'Calm hands.', replace: 'Warm hands.' }],
    })
    expect(ambiguous.isError).toBe(true)
    expect(ambiguous.data.error).toMatch(/matches 2 times/)
    await ok('patch_html_design', { page: 'story', edits: [{ find: 'Our story', replace: 'Our journey' }] })
    const storyPreview = await ok('preview_link', { page: 'story', days: 1 })
    await page.goto(storyPreview.url)
    const frame = page.frameLocator('iframe.site-html-design')
    await expect(frame.getByRole('heading', { name: 'Our journey' })).toBeVisible()
    await expect
      .poll(() => frame.locator('#i').evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBe(64)
    const [designFile] = await db
      .select()
      .from(storedFiles)
      .where(and(eq(storedFiles.tenantId, seed.tenantId), eq(storedFiles.purpose, 'html_design_doc')))
    expect(designFile).toMatchObject({ isPublic: false, contentType: 'text/html; charset=utf-8' })

    // add_image: from the fixture host (SITE_IMPORT_E2E_ALLOW) into the media library; private addresses refused.
    const fixture = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(PNG)
    })
    await new Promise<void>((r) => fixture.listen(PORT + 1, '127.0.0.1', r))
    try {
      const added = await ok('add_image', {
        url: `http://127.0.0.1:${PORT + 1}/stones.png`,
        alt_en: 'Stones',
      })
      expect(added.path).toBe(`/files/${added.file_id}`)
      const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, added.id))
      expect(asset).toMatchObject({ tenantId: seed.tenantId, url: added.path })
      expect(asset!.tags).toContain('ai-assistant')
    } finally {
      await new Promise<void>((r) => fixture.close(() => r()))
    }
    const blocked = await tool(request, token, 'add_image', {
      spa: slug,
      url: 'https://169.254.169.254/x.png',
    })
    expect(blocked.isError).toBe(true)
    expect(blocked.data.error).toMatch(/private network/)
    const plain = await tool(request, token, 'add_image', { spa: slug, url: 'http://example.com/x.png' })
    expect(plain.data.error).toMatch(/Only https:\/\//)

    // Throughout: nothing was published; the live site is the old one and the new page isn't public.
    expect(await publishedCount()).toBe(1)
    await liveHome()
    const story = await page.goto(`${site(slug)}/story`)
    expect(story?.status()).toBe(404)
    const audited = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.tenantId, seed.tenantId))
    for (const t of [
      'apply_template',
      'set_html_design',
      'patch_html_design',
      'get_html_design',
      'add_image',
    ])
      expect(
        audited.some((a) => a.action === `site.mcp.${t}`),
        t,
      ).toBe(true)
  })

  await test.step('console: Connect Claude or ChatGPT card lists the client; Revoke cuts access', async () => {
    await p.goto(`${admin}/login`)
    await p.waitForLoadState('networkidle')
    await p.getByLabel('Email').fill(email)
    await p.getByLabel('Password').fill(PASSWORD)
    await p.getByRole('button', { name: 'Sign in' }).click()
    await p.waitForURL(/\/two-factor/)
    await p.waitForLoadState('networkidle')
    await passTwoFactor(p, email)
    await expect(p.getByRole('heading', { name: 'Overview' })).toBeVisible()
    // A connected client registered without client_name is listed by where its access goes, never as "Claude".
    const nameless = `nameless-${randomBytes(6).toString('hex')}`
    const [me] = await testDb().select({ id: user.id }).from(user).where(eq(user.email, email))
    await testDb()
      .insert(oauthClient)
      .values({ id: nameless, clientId: nameless, redirectUris: [CHATGPT_STABLE], createdAt: new Date() })
    await testDb()
      .insert(oauthConsent)
      .values({ id: nameless, clientId: nameless, userId: me!.id, scopes: ['sites:edit'] })
    await p.goto(`${admin}/websites`)
    const card = p.getByRole('region', { name: 'Connect Claude or ChatGPT' })
    await expect(card.getByText(MCP)).toBeVisible()
    const clients = card.getByRole('list', { name: 'Connected clients' })
    const item = (text: string) => clients.getByRole('listitem').filter({ hasText: text })
    await expect(item('chatgpt.com')).toHaveCount(1)
    await expect(item('Claude')).toHaveCount(1)
    await item('Claude').getByRole('button', { name: 'Revoke' }).click()
    await expect(p.getByText('Disconnected')).toBeVisible()
    const after = await rpc(request, token, 'tools/list')
    expect(after.status()).toBe(401)
  })
  await ctx.close()
})

test('ChatGPT MCP connector: DCR → PKCE + resource → consent → code at chatgpt.com → token → annotated tools', async ({
  page,
  browser,
  request,
}) => {
  const { slug, email } = await signUpOwner(page, { spa: 'GPT Spa', slug: 'gpt-editor' })
  await makeSiteAiEditor(slug)
  const connector = `https://chatgpt.com/connector/oauth/${randomBytes(9).toString('base64url')}`
  const as = await discover(request)
  // What ChatGPT relies on: S256, public clients (`none`), and `iss` in authorization responses (stable callback).
  expect(as.code_challenge_methods_supported).toContain('S256')
  expect(as.token_endpoint_auth_methods_supported).toContain('none')
  expect(as.authorization_response_iss_parameter_supported).toBe(true)
  const register = (redirect_uris: string[]) =>
    request.post(viaNode(as.registration_endpoint), {
      data: {
        client_name: 'ChatGPT',
        redirect_uris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      },
    })
  const reg = await register([CHATGPT_STABLE, connector])
  expect(reg.status(), await reg.text()).toBeLessThan(300)
  const clientId = ((await reg.json()) as { client_id: string }).client_id
  for (const bad of [
    'https://chatgpt.com.evil.com/connector/oauth/abc',
    `${connector}/x`,
    'http://chatgpt.com/x',
  ]) {
    const r = await register([bad])
    expect(r.status(), bad).toBe(400)
    expect(await r.text()).toContain('invalid_redirect_uri')
  }
  // Authorize with a callback that isn't this client's (a lookalike, another connector id): never sent there.
  for (const other of ['https://chatgpt.com.evil.com/connector/oauth/abc', `${connector}x`]) {
    const res = await request.get(
      viaNode(authorizeUrl(as.authorization_endpoint, clientId, pkce().challenge, other, 'nope')),
      { maxRedirects: 0 },
    )
    expect(res.headers().location ?? '').not.toContain('chatgpt.com')
    expect(await res.text()).not.toContain(other)
  }

  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  // ChatGPT's callbacks answered in the browser: the code is intercepted, never sent to chatgpt.com.
  await p.route('https://chatgpt.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: 'back in ChatGPT' }),
  )
  // ChatGPT asks for every advertised scope by default: each one must be grantable.
  const scope = as.scopes_supported.join(' ')
  const codeFor = async (redirect: string, signIn: boolean) => {
    const { verifier, challenge } = pkce()
    await p.goto(authorizeUrl(as.authorization_endpoint, clientId, challenge, redirect, scope))
    if (signIn) {
      await p.waitForLoadState('networkidle')
      await p.getByLabel('Email').fill(email)
      await p.getByLabel('Password').fill(PASSWORD)
      await p.getByRole('button', { name: 'Sign in' }).click()
      await p.waitForURL(/\/two-factor\?.*sig=/)
      await p.waitForLoadState('networkidle')
      await passTwoFactor(p, email)
      await expect(p.getByRole('heading', { name: 'Connect your AI assistant' })).toBeVisible()
      await expect(p.getByText('ChatGPT wants to edit spa websites for you.')).toBeVisible()
      await expect(p.getByTestId('oauth-redirect-host')).toHaveText('Approving sends access to chatgpt.com.')
    }
    await expect(async () => {
      if (!p.url().startsWith(redirect))
        await p.getByRole('button', { name: 'Allow' }).click({ timeout: 2000 })
      await p.waitForURL((u) => u.href.startsWith(`${redirect}?`), { timeout: 5000 })
    }).toPass({ timeout: 30_000 })
    const back = new URL(p.url())
    expect(`${back.origin}${back.pathname}`).toBe(redirect)
    expect(back.searchParams.get('state')).toBe('xyz')
    // RFC 9207: the issuer comes back with the code, equal to the advertised one.
    expect(back.searchParams.get('iss')).toBe(as.issuer)
    const res = await request.post(viaNode(as.token_endpoint), {
      form: {
        grant_type: 'authorization_code',
        code: back.searchParams.get('code')!,
        redirect_uri: redirect,
        client_id: clientId,
        code_verifier: verifier,
        resource: MCP,
      },
    })
    expect(res.ok(), await res.text()).toBe(true)
    return (await res.json()) as { access_token: string; refresh_token?: string; scope?: string }
  }

  const first = await codeFor(connector, true)
  expect(first.scope?.split(' ').sort()).toEqual([...as.scopes_supported].sort())
  // The access token is bound to the MCP resource, which /api/mcp verifies.
  const aud = JSON.parse(Buffer.from(first.access_token.split('.')[1]!, 'base64url').toString()).aud
  expect([aud].flat()).toContain(MCP)
  const [granted] = await testDb()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, 'platform.mcp.client_authorized'), eq(auditLog.entityId, clientId)))
  expect(granted?.data).toMatchObject({ redirectHost: 'chatgpt.com', client: 'ChatGPT' })
  // The grant row keeps the client through Revoke (pruneUnusedOAuthClients matches entity + entityId).
  expect(granted?.entity).toBe('oauth_client')

  const tools = await rpc(request, first.access_token, 'tools/list')
  expect(tools.status()).toBe(200)
  const list = (await tools.json()) as {
    result: { tools: { name: string; annotations?: Record<string, boolean> }[] }
  }
  const hints = Object.fromEntries(list.result.tools.map((t) => [t.name, t.annotations ?? {}]))
  for (const name of ['list_spas', 'get_site', 'list_block_types', 'preview_link'])
    expect(hints[name], name).toMatchObject({ readOnlyHint: true, openWorldHint: false })
  expect(hints.update_block).toMatchObject({
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  })
  expect(hints.add_block).toMatchObject({ readOnlyHint: false, destructiveHint: false })
  expect(hints.remove_block).toMatchObject({ readOnlyHint: false, destructiveHint: true })
  expect(Object.keys(hints).some((n) => n.includes('publish'))).toBe(false)
  const spas = await rpc(request, first.access_token, 'tools/call', {
    name: 'list_spas',
    arguments: { query: slug },
  })
  expect(JSON.stringify(await spas.json())).toContain(slug)

  // ChatGPT refreshes (offline_access) with the same resource; the new token works too.
  expect(first.refresh_token).toBeTruthy()
  const refreshed = await request.post(viaNode(as.token_endpoint), {
    form: {
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token!,
      client_id: clientId,
      resource: MCP,
    },
  })
  expect(refreshed.ok(), await refreshed.text()).toBe(true)
  const again = ((await refreshed.json()) as { access_token: string }).access_token
  expect((await rpc(request, again, 'tools/list')).status()).toBe(200)

  // The stable callback works the same way (already signed in; the consent is remembered or asked again).
  const stable = await codeFor(CHATGPT_STABLE, false)
  expect((await rpc(request, stable.access_token, 'tools/list')).status()).toBe(200)
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
  await expect(page.getByText('Connecting an AI assistant is not enabled for your account.')).toBeVisible()
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
  // The client admin API is off, and registering with a session needs a listed editor.
  const admin = await page.evaluate(async (cb) => {
    const post = (path: string, body: unknown) =>
      fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.status)
    return {
      create: await post('/api/auth/oauth2/create-client', {
        client_name: 'Claude',
        redirect_uris: ['https://evil.example/cb'],
      }),
      register: await post('/api/auth/oauth2/register', {
        client_name: 'Claude',
        redirect_uris: [cb],
        token_endpoint_auth_method: 'none',
      }),
    }
  }, CALLBACK)
  expect(admin).toEqual({ create: 404, register: 401 })
})

test('Claude MCP connector: authorize never redirects to a non-Claude callback (no open redirect)', async ({
  request,
}) => {
  // A client stored before registration was held to Claude's callbacks (or written some other way).
  const id = `legacy-${randomBytes(6).toString('hex')}`
  await testDb()
    .insert(oauthClient)
    .values({
      id,
      clientId: id,
      name: 'Claude',
      redirectUris: ['https://evil.example/cb'],
      tokenEndpointAuthMethod: 'none',
      grantTypes: ['authorization_code'],
      responseTypes: ['code'],
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  const as = await discover(request)
  // An invalid scope used to bounce straight to the registered URI, before any sign-in.
  const res = await request.get(
    viaNode(
      `${as.authorization_endpoint}?${new URLSearchParams({
        client_id: id,
        redirect_uri: 'https://evil.example/cb',
        response_type: 'code',
        scope: 'nope',
        state: 's',
      })}`,
    ),
    { maxRedirects: 0 },
  )
  expect(res.headers().location ?? '').not.toContain('evil.example')
  expect(await res.text()).not.toContain('evil.example/cb?')
})
