// Namecheap XML API client (domain search, pricing, registration, DNS). Calls must come from an IP whitelisted
// in the Namecheap account (the production droplet's IPv4). Env: NAMECHEAP_API_USER, NAMECHEAP_API_KEY,
// NAMECHEAP_CLIENT_IP (the whitelisted IP), optional NAMECHEAP_USERNAME (defaults to the API user) and
// NAMECHEAP_SANDBOX=1 for api.sandbox.namecheap.com.

export type NamecheapConfig = {
  apiUser: string
  apiKey: string
  userName: string
  clientIp: string
  sandbox: boolean
}

export function namecheapConfig(
  env: Record<string, string | undefined> = process.env,
): NamecheapConfig | null {
  const {
    NAMECHEAP_API_USER,
    NAMECHEAP_API_KEY,
    NAMECHEAP_CLIENT_IP,
    NAMECHEAP_USERNAME,
    NAMECHEAP_SANDBOX,
  } = env
  if (!NAMECHEAP_API_USER || !NAMECHEAP_API_KEY || !NAMECHEAP_CLIENT_IP) return null
  return {
    apiUser: NAMECHEAP_API_USER,
    apiKey: NAMECHEAP_API_KEY,
    userName: NAMECHEAP_USERNAME || NAMECHEAP_API_USER,
    clientIp: NAMECHEAP_CLIENT_IP,
    sandbox: NAMECHEAP_SANDBOX === '1' || NAMECHEAP_SANDBOX === 'true',
  }
}

export class NamecheapError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

// --- minimal XML helpers (Namecheap responses are flat, attribute-based) ---------------------------------
const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')

export function attrs(tagSource: string): Record<string, string> {
  const out: Record<string, string> = {}
  // Names start after whitespace (XML attributes are space-separated), so a long name-like run is scanned once.
  for (const m of ` ${tagSource}`.matchAll(/\s([A-Za-z_][\w.-]*)="([^"]*)"/g)) out[m[1]!] = decode(m[2]!)
  return out
}

/** All occurrences of <Tag ...> (self-closing or not) as attribute maps. */
export function tags(xml: string, name: string): Record<string, string>[] {
  return [...xml.matchAll(new RegExp(`<${name}\\b([^>]*?)\\/?>`, 'g'))].map((m) => attrs(m[1] ?? ''))
}

export function parseResponse(xml: string, partialTag?: string) {
  const status = /<ApiResponse\b[^>]*Status="(\w+)"/.exec(xml)?.[1]
  // Some commands (domains.check) report per-item errors as a failed response that still carries the good items.
  if (status !== 'OK' && !(partialTag && xml.includes(`<${partialTag}`))) {
    // Tag and text can't hold "<" in well-formed XML; excluding it keeps every scan linear.
    const err = /<Error\b([^<>]*)>([^<]*)<\/Error>/.exec(xml)
    throw new NamecheapError(
      err ? decode(err[2]!.trim()) : 'Namecheap request failed',
      err ? attrs(err[1]!).Number : undefined,
    )
  }
  return xml
}

export async function call(
  cfg: NamecheapConfig,
  command: string,
  params: Record<string, string | number> = {},
  fetchImpl: typeof fetch = fetch,
  partialTag?: string,
) {
  const url = cfg.sandbox
    ? 'https://api.sandbox.namecheap.com/xml.response'
    : 'https://api.namecheap.com/xml.response'
  const body = new URLSearchParams({
    ApiUser: cfg.apiUser,
    ApiKey: cfg.apiKey,
    UserName: cfg.userName,
    ClientIp: cfg.clientIp,
    Command: command,
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  })
  const res = await fetchImpl(url, { method: 'POST', body, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new NamecheapError(`Namecheap HTTP ${res.status}`)
  return parseResponse(await res.text(), partialTag)
}

// --- domain helpers -------------------------------------------------------------------------------------
const MULTI_LEVEL = ['com.ae', 'net.ae', 'org.ae', 'co.uk', 'org.uk', 'com.au', 'co.in', 'com.sa']

export function splitDomain(domain: string) {
  const d = domain.toLowerCase().replace(/\.$/, '')
  const tld = MULTI_LEVEL.find((t) => d.endsWith(`.${t}`)) ?? d.slice(d.lastIndexOf('.') + 1)
  const sld = d.slice(0, d.length - tld.length - 1)
  if (!sld || sld.includes('.') || !/^[a-z0-9-]{1,63}$/.test(sld) || sld.startsWith('-') || sld.endsWith('-'))
    throw new NamecheapError('Enter a domain like serenityspa.com')
  return { sld, tld }
}

export type Availability = {
  domain: string
  available: boolean
  premium: boolean
  premiumPriceUsd: number | null
  error: string | null
}

export async function checkDomains(cfg: NamecheapConfig, domains: string[], fetchImpl?: typeof fetch) {
  const xml = await call(
    cfg,
    'namecheap.domains.check',
    { DomainList: domains.join(',') },
    fetchImpl,
    'DomainCheckResult',
  )
  const errors = [...xml.matchAll(/<Error\b[^>]*>([\s\S]*?)<\/Error>/g)].map((m) => decode(m[1]!.trim()))
  const found = tags(xml, 'DomainCheckResult').map<Availability>((a) => ({
    domain: (a.Domain ?? '').toLowerCase(),
    available: a.Available === 'true',
    premium: a.IsPremiumName === 'true',
    premiumPriceUsd: a.IsPremiumName === 'true' ? Number(a.PremiumRegistrationPrice) || null : null,
    error: a.ErrorNo && a.ErrorNo !== '0' ? a.Description || `Error ${a.ErrorNo}` : null,
  }))
  // Domains Namecheap rejected outright (e.g. unsupported TLDs such as .ae) come back as errors, not results.
  const missing = domains
    .map((d) => d.toLowerCase())
    .filter((d) => !found.some((f) => f.domain === d))
    .map<Availability>((d) => ({
      domain: d,
      available: false,
      premium: false,
      premiumPriceUsd: null,
      error: errors.find((e) => e.toLowerCase().includes(d)) ?? 'Not available through Namecheap',
    }))
  return [...found, ...missing]
}

/** One-year registration price (your price) per TLD in USD. */
export async function registerPrices(cfg: NamecheapConfig, tlds: string[], fetchImpl?: typeof fetch) {
  const out = new Map<string, number>() // a Map: a TLD can't name a prototype key
  for (const tld of tlds) {
    const xml = await call(
      cfg,
      'namecheap.users.getPricing',
      {
        ProductType: 'DOMAIN',
        ProductCategory: 'DOMAINS',
        ActionName: 'REGISTER',
        ProductName: tld.toUpperCase(),
      },
      fetchImpl,
    )
    const oneYear = tags(xml, 'Price').find(
      (p) => p.Duration === '1' && (p.DurationType ?? 'YEAR').toUpperCase() === 'YEAR',
    )
    const price = Number(oneYear?.YourPrice ?? oneYear?.Price)
    if (price > 0) out.set(tld, price)
  }
  return Object.fromEntries(out)
}

export type Contact = {
  firstName: string
  lastName: string
  organization?: string
  address1: string
  city: string
  stateProvince: string
  postalCode: string
  /** ISO 3166-1 alpha-2, e.g. AE */
  country: string
  /** E.164 digits, e.g. 971501234567 */
  phoneE164: string
  email: string
}

/** Namecheap phone format: +NNN.NNNNNNNNNN */
export const namecheapPhone = (e164: string) => {
  const d = e164.replace(/\D/g, '')
  return d.startsWith('971') ? `+971.${d.slice(3)}` : `+${d.slice(0, d.length - 9)}.${d.slice(-9)}`
}

function contactParams(prefix: string, c: Contact) {
  return {
    [`${prefix}FirstName`]: c.firstName,
    [`${prefix}LastName`]: c.lastName,
    ...(c.organization ? { [`${prefix}OrganizationName`]: c.organization } : {}),
    [`${prefix}Address1`]: c.address1,
    [`${prefix}City`]: c.city,
    [`${prefix}StateProvince`]: c.stateProvince,
    [`${prefix}PostalCode`]: c.postalCode,
    [`${prefix}Country`]: c.country,
    [`${prefix}Phone`]: namecheapPhone(c.phoneE164),
    [`${prefix}EmailAddress`]: c.email,
  }
}

export async function registerDomain(
  cfg: NamecheapConfig,
  r: { domain: string; years: number; registrant: Contact; admin: Contact; premiumPriceUsd?: number | null },
  fetchImpl?: typeof fetch,
) {
  const xml = await call(
    cfg,
    'namecheap.domains.create',
    {
      DomainName: r.domain,
      Years: r.years,
      ...contactParams('Registrant', r.registrant),
      ...contactParams('Tech', r.admin),
      ...contactParams('Admin', r.admin),
      ...contactParams('AuxBilling', r.admin),
      AddFreeWhoisguard: 'yes',
      WGEnabled: 'yes',
      ...(r.premiumPriceUsd ? { IsPremiumDomain: 'true', PremiumPrice: r.premiumPriceUsd } : {}),
    },
    fetchImpl,
  )
  const [res] = tags(xml, 'DomainCreateResult')
  if (res?.Registered !== 'true') throw new NamecheapError(`Registration of ${r.domain} did not complete`)
  return {
    domain: res.Domain ?? r.domain,
    chargedUsd: Number(res.ChargedAmount) || 0,
    domainId: res.DomainID ?? null,
    orderId: res.OrderID ?? null,
    transactionId: res.TransactionID ?? null,
  }
}

export type HostRecord = { host: string; type: 'A' | 'CNAME' | 'TXT' | 'URL301'; value: string; ttl?: number }

/** Replaces ALL host records of a domain using Namecheap DNS (namecheap.domains.dns.setHosts). */
export async function setHosts(
  cfg: NamecheapConfig,
  domain: string,
  records: HostRecord[],
  fetchImpl?: typeof fetch,
) {
  const { sld, tld } = splitDomain(domain)
  const params: Record<string, string | number> = { SLD: sld, TLD: tld }
  records.forEach((r, i) => {
    const n = i + 1
    params[`HostName${n}`] = r.host
    params[`RecordType${n}`] = r.type
    params[`Address${n}`] = r.value
    params[`TTL${n}`] = r.ttl ?? 1800
  })
  const xml = await call(cfg, 'namecheap.domains.dns.setHosts', params, fetchImpl)
  return tags(xml, 'DomainDNSSetHostsResult')[0]?.IsSuccess === 'true'
}

/** Records that point a spa's new domain at the platform: www → CNAME target, apex → 301 to www, TXT proof. */
export function platformRecords(
  domain: string,
  target: { cname: string; verificationToken: string },
): HostRecord[] {
  return [
    { host: 'www', type: 'CNAME', value: target.cname.endsWith('.') ? target.cname : `${target.cname}.` },
    { host: '@', type: 'URL301', value: `https://www.${domain}` },
    { host: '_spamanagement.www', type: 'TXT', value: target.verificationToken },
  ]
}

/** Account funds (namecheap.users.getBalances) — purchases are charged to the available balance. */
export async function getBalance(cfg: NamecheapConfig, fetchImpl?: typeof fetch) {
  const xml = await call(cfg, 'namecheap.users.getBalances', {}, fetchImpl)
  const [b] = tags(xml, 'UserGetBalancesResult')
  return { currency: b?.Currency ?? 'USD', availableUsd: Number(b?.AvailableBalance) || 0 }
}

/** Whether Namecheap sells a TLD (namecheap.domains.getTldList). */
export async function supportedTlds(cfg: NamecheapConfig, fetchImpl?: typeof fetch) {
  const xml = await call(cfg, 'namecheap.domains.getTldList', {}, fetchImpl)
  return new Set(
    tags(xml, 'Tld')
      .filter((t) => t.IsApiRegisterable === 'true')
      .map((t) => (t.Name ?? '').toLowerCase()),
  )
}
