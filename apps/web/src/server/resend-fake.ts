// E2E only (RESEND_E2E_FAKE, set by playwright.config.ts, never in deploy env): an in-memory Resend domains API
// behind the real client (`resendDomains`), so CI never calls Resend. Keys containing "SendOnly" act as
// sending-access keys. Verify sets pending (as Resend does); the next read finds it verified (real Resend: minutes).
type FakeDomain = { id: string; name: string; region: string; status: string; created_at: string }
const g = globalThis as { __resendFakeDomains?: Map<string, FakeDomain> }

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const view = (d: FakeDomain) => {
  const status = d.status === 'verified' ? 'verified' : 'not_started'
  return {
    object: 'domain',
    ...d,
    records: [
      {
        record: 'SPF',
        name: 'send',
        type: 'MX',
        ttl: 'Auto',
        status,
        value: `feedback-smtp.${d.region}.amazonses.com`,
        priority: 10,
      },
      {
        record: 'SPF',
        name: 'send',
        type: 'TXT',
        ttl: 'Auto',
        status,
        value: '"v=spf1 include:amazonses.com ~all"',
      },
      // Full name on purpose: the console must show Namecheap's relative host.
      {
        record: 'DKIM',
        name: `resend._domainkey.${d.name}`,
        type: 'TXT',
        ttl: 'Auto',
        status,
        value: `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC${'x'.repeat(180)}IDAQAB`,
      },
    ],
  }
}

export async function fakeResendFetch(url: string, init: RequestInit): Promise<Response> {
  g.__resendFakeDomains ??= new Map()
  const domains = g.__resendFakeDomains
  const key = new Headers(init.headers).get('Authorization')?.replace(/^Bearer /, '') ?? ''
  if (!key.startsWith('re_'))
    return json(401, {
      statusCode: 401,
      name: 'missing_api_key',
      message: 'Missing API key in the authorization header',
    })
  if (key.includes('SendOnly'))
    return json(401, {
      statusCode: 401,
      name: 'restricted_api_key',
      message: 'This API key is restricted to only send emails',
    })
  const { pathname } = new URL(url)
  const method = init.method ?? 'GET'
  // The "background" verification started by the last verify call is done.
  for (const d of domains.values()) if (d.status === 'pending') d.status = 'verified'
  if (pathname === '/domains' && method === 'GET')
    return json(200, { object: 'list', has_more: false, data: [...domains.values()] })
  if (pathname === '/domains' && method === 'POST') {
    const { name, region } = JSON.parse(String(init.body)) as { name: string; region?: string }
    const d = {
      id: crypto.randomUUID(),
      name,
      region: region ?? 'us-east-1',
      status: 'not_started',
      created_at: new Date().toISOString(),
    }
    domains.set(d.id, d)
    return json(200, view(d))
  }
  const m = pathname.match(/^\/domains\/([^/]+)(\/verify)?$/)
  const d = m?.[1] ? domains.get(m[1]) : undefined
  if (!d) return json(404, { statusCode: 404, name: 'not_found', message: 'Domain not found' })
  if (m?.[2] && method === 'POST') {
    d.status = 'pending'
    return json(200, { object: 'domain', id: d.id })
  }
  return json(200, view(d))
}
