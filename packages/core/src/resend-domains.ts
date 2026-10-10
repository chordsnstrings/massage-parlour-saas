// Resend domains API for the console's "Sending domain" section (R18): find or add the From domain and read back the
// DNS records to copy into Namecheap → Advanced DNS. Pure: fetch + base URL are injectable for tests only (the base
// URL is never read from env). Checked against Resend's docs on 2026-10-10:
//   https://resend.com/docs/api-reference/domains/create-domain  POST /domains {name, region}; regions us-east-1
//     (default), eu-west-1, sa-east-1, ap-northeast-1; https://resend.com/docs/dashboard/domains/regions: fixed later
//   https://resend.com/docs/api-reference/domains/list-domains   GET /domains?limit=1..100&after=<id> → {data, has_more}
//   https://resend.com/docs/api-reference/domains/get-domain     GET /domains/{id} → records [{record, name, type,
//     value, ttl: "Auto", status, priority (MX only)}]; name is usually relative ("send"), sometimes the full name
//   https://resend.com/docs/api-reference/domains/verify-domain  POST /domains/{id}/verify (async; pending meanwhile)
//   https://resend.com/docs/dashboard/domains/manage-domains     domain statuses (RESEND_DOMAIN_STATUSES)
//   https://resend.com/docs/api-reference/errors                 {statusCode, name, message}; 401 restricted_api_key =
//     "restricted to only send emails" (sending-access key), 403 restricted_api_key = key not active
//   https://resend.com/docs/api-reference/introduction           User-Agent required; 10 requests/s per team
//   https://resend.com/docs/api-reference/api-keys/create-api-key  full_access vs sending_access ("can only send")
import { PLATFORM_NAME } from './email'

const RESEND_API = 'https://api.resend.com'
/** Region for a newly added domain (Ireland, the nearest of Resend's four to the UAE). Ignored for an existing one. */
export const RESEND_DOMAIN_REGION = 'eu-west-1'
export const RESEND_DOMAIN_STATUSES = [
  'not_started',
  'pending',
  'verified',
  'partially_verified',
  'partially_failed',
  'failed',
  'temporary_failure',
] as const

export type SendingDomainRecord = {
  /** Resend's purpose label (SPF, DKIM, …). */
  purpose: string
  type: string
  /** Namecheap "Host": relative to the domain ("send", "resend._domainkey"; "@" = the domain itself). */
  host: string
  value: string
  priority: number | null
  status: string
}
export type SendingDomain = {
  name: string
  status: string
  region: string | null
  records: SendingDomainRecord[]
}

type RawRecord = {
  record?: string
  name?: string
  type?: string
  value?: string
  status?: string
  priority?: number
}
type RawDomain = { id: string; name: string; status?: string; region?: string; records?: RawRecord[] }
type Fetch = (url: string, init: RequestInit) => Promise<Response>

export type ResendDomainErrorCode =
  | 'restricted_key'
  | 'invalid_key'
  | 'rate_limited'
  | 'unreachable'
  | 'domain_taken'
  | 'not_set_up'
  | 'failed'

/** Plain console text; never contains the key or Resend's raw answer (only its scrubbed message for `failed`). */
export class ResendDomainError extends Error {
  constructor(
    readonly code: ResendDomainErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ResendDomainError'
  }
}

const MESSAGES: Record<Exclude<ResendDomainErrorCode, 'failed'>, string> = {
  restricted_key:
    'This Resend key has sending access only; setting up the domain needs a full-access key. Paste one in "Full-access key for setup" (used for this request only, never stored).',
  invalid_key: 'Resend refused the API key (invalid, revoked or not active). Check it in Resend → API Keys.',
  rate_limited: 'Resend is rate-limiting requests. Wait a few seconds and try again.',
  unreachable: 'Resend could not be reached or had a problem. Try again in a minute.',
  domain_taken:
    'This domain is already registered in another Resend account. Use a key from that account, or remove the domain there first.',
  not_set_up: 'This domain is not in Resend yet. Click "Set up sending domain" first.',
}
const err = (code: Exclude<ResendDomainErrorCode, 'failed'>) => new ResendDomainError(code, MESSAGES[code])

function resendError(status: number, body: Record<string, unknown> | null, apiKey: string) {
  const name = typeof body?.name === 'string' ? body.name : ''
  const message = typeof body?.message === 'string' ? body.message : ''
  if (
    (name === 'restricted_api_key' && (status === 401 || /only send/i.test(message))) ||
    name === 'invalid_permission'
  )
    return err('restricted_key')
  if (status === 401 || /^(invalid|missing|restricted|suspended)_api_key$|^invalid_access$/.test(name))
    return err('invalid_key')
  if (status === 429 || name === 'rate_limit_exceeded') return err('rate_limited')
  if (/registered already/i.test(message)) return err('domain_taken')
  if (status >= 500) return err('unreachable')
  const detail = message
    .split(apiKey)
    .join('…')
    .replace(/\bre_[A-Za-z0-9_-]+/g, 're_…')
    .slice(0, 200)
  const label = /^[a-z_]{1,40}$/.test(name) ? ` ${name}` : ''
  return new ResendDomainError(
    'failed',
    `Resend refused the request (${status}${label})${detail ? `: ${detail}` : ''}`,
  )
}

export type ResendDomainsClient = ReturnType<typeof resendDomains>

/** Thin client for the four domain calls the console needs. Every failure is a `ResendDomainError`. */
export function resendDomains(apiKey: string, opts: { fetch?: Fetch; baseUrl?: string } = {}) {
  const f: Fetch = opts.fetch ?? fetch
  const base = opts.baseUrl ?? RESEND_API
  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await f(base + path, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': PLATFORM_NAME,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    } catch {
      throw err('unreachable')
    }
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok) throw resendError(res.status, json, apiKey)
    if (!json) throw new ResendDomainError('failed', 'Resend sent an unreadable answer. Try again.')
    return json as T
  }
  return {
    /** Looks through every page of the account's domains (case-insensitive name match). */
    async find(name: string): Promise<RawDomain | null> {
      const want = name.toLowerCase()
      let after = ''
      for (let page = 0; page < 50; page++) {
        const r = await call<{ data?: RawDomain[]; has_more?: boolean }>(
          'GET',
          `/domains?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`,
        )
        const data = r.data ?? []
        const hit = data.find((d) => d.name?.toLowerCase() === want)
        if (hit) return hit
        const last = data.at(-1)?.id
        if (!r.has_more || !last) return null
        after = last
      }
      return null
    },
    create: (name: string, region: string) => call<RawDomain>('POST', '/domains', { name, region }),
    get: (id: string) => call<RawDomain>('GET', `/domains/${encodeURIComponent(id)}`),
    verify: (id: string) => call<{ id: string }>('POST', `/domains/${encodeURIComponent(id)}/verify`),
  }
}

/** Resend's record name → the Host Namecheap wants: relative to the domain, "@" for the domain itself. */
export function namecheapHost(name: string, domain: string): string {
  const n = name.trim().toLowerCase().replace(/\.$/, '')
  const d = domain.toLowerCase()
  if (!n || n === d) return '@'
  return n.endsWith(`.${d}`) ? n.slice(0, -(d.length + 1)) : n
}

export function sendingDomainView(d: RawDomain): SendingDomain {
  return {
    name: d.name,
    status: d.status ?? 'not_started',
    region: d.region ?? null,
    records: (d.records ?? []).map((r) => ({
      purpose: r.record ?? '',
      type: (r.type ?? '').toUpperCase(),
      host: namecheapHost(r.name ?? '', d.name),
      value: r.value ?? '',
      priority: typeof r.priority === 'number' ? r.priority : null,
      status: r.status ?? 'not_started',
    })),
  }
}

/** "Set up sending domain": the existing Resend domain, else a new one (region on create only), read back in full. */
export async function setUpSendingDomain(
  client: ResendDomainsClient,
  name: string,
  region = RESEND_DOMAIN_REGION,
): Promise<{ created: boolean; domain: SendingDomain }> {
  const found = await client.find(name)
  const id = found?.id ?? (await client.create(name, region)).id
  return { created: !found, domain: sendingDomainView(await client.get(id)) }
}

/**
 * "Check verification": asks Resend to verify (async — the answer may still say pending), then reads status +
 * records. Never adds the domain. An already verified domain is only read (nothing to verify).
 */
export async function checkSendingDomain(client: ResendDomainsClient, name: string): Promise<SendingDomain> {
  const found = await client.find(name)
  if (!found) throw err('not_set_up')
  if (found.status !== 'verified') await client.verify(found.id)
  return sendingDomainView(await client.get(found.id))
}
