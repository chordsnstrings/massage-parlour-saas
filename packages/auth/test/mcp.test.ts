// AI assistant MCP connector (R25: Claude + ChatGPT). Which callbacks may receive a code (isAllowedMcpRedirectUri),
// and what OpenAI's Apps SDK auth guide needs from the authorization server, checked with real requests against the
// Better Auth handler (test database): RFC 9728 resource metadata ↔ RFC 8414 issuer (exact), S256, DCR as a public
// client (`none`), `iss` in authorize responses (RFC 9207, advertised), audience-bound tokens.
import { createHash, randomBytes } from 'node:crypto'
import { closeAllDbs, oauthClient, platformDb } from '@spa/db'
import { resetTestDatabase, testUrls } from '@spa/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ORIGIN = 'https://app.spamanagement.test'
const env = process.env as Record<string, string | undefined>
const KEYS = [
  'NODE_ENV',
  'DATABASE_URL_PLATFORM',
  'BETTER_AUTH_SECRET',
  'ROOT_DOMAIN',
  'APP_URL',
  'MCP_REDIRECT_URIS',
]
const saved = Object.fromEntries(KEYS.map((k) => [k, env[k]]))

type Mod = typeof import('../src')
let m: Mod
beforeAll(async () => {
  await resetTestDatabase()
  Object.assign(env, {
    DATABASE_URL_PLATFORM: testUrls.platform,
    BETTER_AUTH_SECRET: 'mcp-test-secret-mcp-test-secret-mcp',
    ROOT_DOMAIN: 'spamanagement.test',
    APP_URL: ORIGIN,
    RESEND_API_KEY: '',
  })
  delete env.MCP_REDIRECT_URIS
  m = await import('../src')
})
afterAll(async () => {
  for (const k of KEYS)
    if (saved[k] === undefined) delete env[k]
    else env[k] = saved[k]
  await closeAllDbs()
})

const STABLE = 'https://chatgpt.com/connector_platform_oauth_redirect'
const PER_CONNECTOR = 'https://chatgpt.com/connector/oauth/Ab_9-xYz'

describe('isAllowedMcpRedirectUri', () => {
  it('accepts Claude’s and ChatGPT’s callbacks', () => {
    for (const uri of [
      'https://claude.ai/api/mcp/auth_callback',
      'https://claude.com/api/mcp/auth_callback',
      STABLE,
      PER_CONNECTOR,
      `https://chatgpt.com/connector/oauth/${'a'.repeat(128)}`,
    ])
      expect(m.isAllowedMcpRedirectUri(uri), uri).toBe(true)
  })

  it('refuses lookalikes, other schemes, extra parts and encoded tricks', () => {
    for (const uri of [
      'https://chatgpt.com.evil.com/connector/oauth/abc',
      'https://chatgpt.com.evil.com/connector_platform_oauth_redirect',
      'https://evilchatgpt.com/connector/oauth/abc',
      'https://chatgpt.com@evil.com/connector/oauth/abc',
      'https://user@chatgpt.com/connector/oauth/abc',
      'https://evil.com/?https://chatgpt.com/connector/oauth/abc',
      'http://chatgpt.com/connector/oauth/abc',
      'http://chatgpt.com/connector_platform_oauth_redirect',
      'https://chatgpt.com:443/connector/oauth/abc',
      'https://chatgpt.com:8443/connector/oauth/abc',
      'https://CHATGPT.COM/connector/oauth/abc',
      'https://www.chatgpt.com/connector/oauth/abc',
      'https://chatgpt.com/connector/oauth/',
      'https://chatgpt.com/connector/oauth/abc/extra',
      'https://chatgpt.com/connector/oauth/abc/',
      'https://chatgpt.com/connector/oauth/abc?x=1',
      'https://chatgpt.com/connector/oauth/abc#x',
      'https://chatgpt.com/connector/oauth/abc%2F..%2Fevil',
      'https://chatgpt.com/connector/oauth/%61bc',
      'https://chatgpt.com/connector/oauth/../oauth/abc',
      'https://chatgpt.com/connector/oauth/./abc',
      'https://chatgpt.com/connector/oauth/a.b',
      'https://chatgpt.com/connector/oauth/abc\n',
      ' https://chatgpt.com/connector/oauth/abc',
      `https://chatgpt.com/connector/oauth/${'a'.repeat(129)}`,
      'https://chatgpt.com/connector_platform_oauth_redirect/',
      'https://chatgpt.com/connector_platform_oauth_redirect?x=1',
      'https://chatgpt.com/connector/oauth',
      'https://chatgpt.com/',
      'https://claude.ai/api/mcp/auth_callback/../../evil',
      'http://localhost:6274/oauth/callback', // loopback only while APP_URL is http
      'javascript:alert(1)',
      '',
      null,
      ['https://chatgpt.com/connector/oauth/abc'],
    ])
      expect(m.isAllowedMcpRedirectUri(uri), String(uri)).toBe(false)
  })

  it('MCP_REDIRECT_URIS replaces every built-in callback, the ChatGPT per-connector pattern included', () => {
    env.MCP_REDIRECT_URIS = ' https://example.com/cb , https://chatgpt.com/connector/oauth/only-this '
    try {
      expect(m.mcpRedirectUris()).toEqual([
        'https://example.com/cb',
        'https://chatgpt.com/connector/oauth/only-this',
      ])
      expect(m.isAllowedMcpRedirectUri('https://example.com/cb')).toBe(true)
      expect(m.isAllowedMcpRedirectUri('https://chatgpt.com/connector/oauth/only-this')).toBe(true)
      expect(m.isAllowedMcpRedirectUri(PER_CONNECTOR)).toBe(false)
      expect(m.isAllowedMcpRedirectUri(STABLE)).toBe(false)
      expect(m.isAllowedMcpRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(false)
    } finally {
      delete env.MCP_REDIRECT_URIS
    }
    expect(m.mcpRedirectUris()).toContain(STABLE)
  })
})

const handler = (req: Request) => m.getAuth().handler(req)
const get = (path: string) => handler(new Request(`${ORIGIN}${path}`, { redirect: 'manual' }))
const register = (redirect_uris: unknown) =>
  handler(
    new Request(`${ORIGIN}/api/auth/oauth2/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'ChatGPT',
        redirect_uris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    }),
  )
const authorize = (params: Record<string, string>) =>
  get(`/api/auth/oauth2/authorize?${new URLSearchParams(params)}`)
const challenge = () => createHash('sha256').update(randomBytes(32).toString('base64url')).digest('base64url')

describe('OAuth discovery + registration for ChatGPT (real requests)', () => {
  type AsMeta = Record<string, unknown> & { issuer: string; scopes_supported: string[] }
  let as: AsMeta

  it('resource metadata names the MCP resource and an issuer whose metadata matches it exactly', async () => {
    const prm = await get('/.well-known/oauth-protected-resource/api/mcp')
    expect(prm.status).toBe(200)
    const resource = (await prm.json()) as {
      resource: string
      authorization_servers: string[]
      scopes_supported?: string[]
    }
    expect(resource.resource).toBe(`${ORIGIN}/api/mcp`)
    expect(resource.resource).toBe(m.mcpResourceUrl())
    expect(m.mcpResourceMetadataUrl()).toBe(`${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`)
    const issuer = resource.authorization_servers[0]!
    expect(issuer).toBe(`${ORIGIN}/api/auth`)
    const meta = await get(`/.well-known/oauth-authorization-server${new URL(issuer).pathname}`)
    expect(meta.status).toBe(200)
    as = (await meta.json()) as AsMeta
    expect(as.issuer).toBe(issuer)
    expect(resource.scopes_supported).toEqual([m.MCP_SCOPE])
    expect(as.scopes_supported).toEqual(expect.arrayContaining(resource.scopes_supported!))
  })

  it('advertises what ChatGPT needs, truthfully', () => {
    expect(as).toMatchObject({
      authorization_endpoint: `${ORIGIN}/api/auth/oauth2/authorize`,
      token_endpoint: `${ORIGIN}/api/auth/oauth2/token`,
      registration_endpoint: `${ORIGIN}/api/auth/oauth2/register`,
      response_types_supported: ['code'],
      authorization_response_iss_parameter_supported: true,
    })
    expect(as.code_challenge_methods_supported).toEqual(['S256'])
    expect(as.token_endpoint_auth_methods_supported).toContain('none')
    expect(as.grant_types_supported).toEqual(expect.arrayContaining(['authorization_code', 'refresh_token']))
    // No CIMD: ChatGPT registers with DCR (Better Auth's CIMD plugin needs an app-owned fetch transport).
    expect(as.client_id_metadata_document_supported).toBeUndefined()
  })

  it('DCR: a public ChatGPT client with the stable + per-connector callbacks; lookalikes are refused', async () => {
    const res = await register([STABLE, PER_CONNECTOR])
    expect(res.status, await res.clone().text()).toBeLessThan(300)
    const client = (await res.json()) as Record<string, unknown>
    expect(client.token_endpoint_auth_method).toBe('none')
    expect(client.client_secret).toBeUndefined()
    expect(client.redirect_uris).toEqual([STABLE, PER_CONNECTOR])
    for (const bad of [
      ['https://chatgpt.com.evil.com/connector/oauth/abc'],
      ['https://chatgpt.com@evil.com/connector/oauth/abc'],
      ['http://chatgpt.com/connector/oauth/abc'],
      ['https://chatgpt.com/connector/oauth/abc/extra'],
      ['https://chatgpt.com/connector/oauth/abc%2F..%2Fx'],
      [STABLE, 'https://evil.example/cb'],
      [],
    ]) {
      const r = await register(bad)
      expect(r.status, JSON.stringify(bad)).toBe(400)
      expect(await r.text()).toContain('invalid_redirect_uri')
    }
  })

  it('authorize: the sign-in page first; errors go back to the callback with iss; never to a lookalike', async () => {
    const { client_id } = (await (await register([PER_CONNECTOR])).json()) as { client_id: string }
    const base = {
      response_type: 'code',
      client_id,
      redirect_uri: PER_CONNECTOR,
      scope: as.scopes_supported.join(' '),
      state: 'st',
      code_challenge: challenge(),
      code_challenge_method: 'S256',
      resource: m.mcpResourceUrl(),
    }
    const signIn = await authorize(base)
    expect(signIn.status).toBe(302)
    expect(signIn.headers.get('location')).toMatch(/^\/login\?.*sig=/)
    // An error the client can act on goes to its own callback, with the issuer (RFC 9207).
    const bad = new URL((await authorize({ ...base, scope: 'nope' })).headers.get('location') ?? '')
    expect(`${bad.origin}${bad.pathname}`).toBe(PER_CONNECTOR)
    expect(bad.searchParams.get('error')).toBe('invalid_scope')
    expect(bad.searchParams.get('iss')).toBe(as.issuer)
    expect(bad.searchParams.get('state')).toBe('st')
    const plain = new URL(
      (await authorize({ ...base, code_challenge_method: 'plain' })).headers.get('location')!,
    )
    expect(plain.searchParams.get('iss')).toBe(as.issuer)
    // A registered client asking for a lookalike callback, or a stored client that has one: never sent there.
    const legacy = `legacy-${randomBytes(6).toString('hex')}`
    await platformDb()
      .insert(oauthClient)
      .values({
        id: legacy,
        clientId: legacy,
        name: 'ChatGPT',
        redirectUris: ['https://chatgpt.com.evil.com/connector/oauth/abc'],
        tokenEndpointAuthMethod: 'none',
        grantTypes: ['authorization_code'],
        responseTypes: ['code'],
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    for (const params of [
      { ...base, redirect_uri: 'https://chatgpt.com.evil.com/connector/oauth/abc' },
      { ...base, client_id: legacy, redirect_uri: 'https://chatgpt.com.evil.com/connector/oauth/abc' },
      {
        ...base,
        client_id: legacy,
        redirect_uri: 'https://chatgpt.com.evil.com/connector/oauth/abc',
        scope: 'x',
      },
    ]) {
      const r = await authorize(params)
      expect(r.headers.get('location') ?? '').not.toContain('evil.com')
      expect(await r.text()).not.toContain('evil.com/connector')
    }
  })

  it('tokens are audience-bound: only the MCP resource is accepted', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600
    const sign = async (aud: string | string[]) =>
      (
        (await m.getAuth().api.signJWT({
          body: { payload: { sub: 'user-1', azp: 'client-1', aud, exp, scope: m.MCP_SCOPE } },
        })) as { token: string }
      ).token
    expect(await m.verifyMcpAccessToken(await sign(m.mcpResourceUrl()))).toMatchObject({
      userId: 'user-1',
      clientId: 'client-1',
      scopes: [m.MCP_SCOPE],
    })
    expect(
      await m.verifyMcpAccessToken(await sign([m.mcpResourceUrl(), `${ORIGIN}/api/auth/oauth2/userinfo`])),
    ).not.toBeNull()
    expect(await m.verifyMcpAccessToken(await sign(`${ORIGIN}/api/auth/oauth2/userinfo`))).toBeNull()
    expect(await m.verifyMcpAccessToken(await sign('https://evil.example/api/mcp'))).toBeNull()
    expect(await m.verifyMcpAccessToken(await sign(`${ORIGIN}/api/mcp/`))).toBeNull()
  })
})
