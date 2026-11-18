// Custom domains (PLAN §1.1, §3.3). A spa connects one hostname it owns (e.g. www.theirspa.ae):
//   pending   → added; waiting for the TXT record _spamanagement.<host> = verification token (proves ownership)
//   verifying → ownership proven; waiting for the CNAME (→ CF_CNAME_TARGET, or the APP_URL host without
//               Cloudflare) and, when Cloudflare for SaaS is configured, for its hostname + certificate
//   active    → served by resolveSiteTenant(); the first activation makes it the primary address
//   failed    → Cloudflare gave up, the DNS moved away from us, automatic checks gave up after 7 days on a
//               domain that never connected, or support deactivated it. "Check now" re-runs the checks from
//               any state (and asks Cloudflare to retry a hostname it gave up on).
// Ownership, once proven (verified_at), is kept. A claim that never connected within the give-up time — or one
// left by a cancelled spa — is released when another spa adds the same hostname (support can also remove it).
import { randomBytes } from 'node:crypto'
import { Resolver } from 'node:dns/promises'
import { BlockList, isIP, isIPv4 } from 'node:net'
import { domainToASCII } from 'node:url'
import { parseRoots, trimTrailing } from '@spa/core'
import { type Db, type DbOrTx, domains, platformDb, tenants, withTenant } from '@spa/db'
import { and, eq, ne, sql } from 'drizzle-orm'
import { DomainError, pgCode } from './errors'
import {
  type CfConfig,
  type CfHostname,
  CloudflareError,
  cfCreateHostname,
  cfDeleteHostname,
  cfGetHostname,
  cfRetryHostname,
  cloudflareConfig,
} from './integrations/cloudflare'

type Env = Record<string, string | undefined>
export type DomainRow = typeof domains.$inferSelect
export type DomainStatus = DomainRow['status']

/** Runs a query either inside withTenant() (tenant code) or on platformDb() (super-admin, worker lookups). */
export type DomainRun = <T>(fn: (db: DbOrTx) => Promise<T>) => Promise<T>
export const tenantDomainRun =
  (tenantId: string, db?: Db): DomainRun =>
  (fn) =>
    withTenant(tenantId, fn, db)

export const TXT_LABEL = '_spamanagement'
export const MAX_CUSTOM_DOMAINS = 1
/** Automatic checks stop (status → failed) when a never-verified domain hasn't connected within this time. */
export const GIVE_UP_AFTER_MS = 7 * 86_400_000
/** Manual "Check now" presses closer together than this are refused (DNS + the shared Cloudflare quota). */
export const MANUAL_CHECK_COOLDOWN_MS = 30_000

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// ---------------------------------------------------------------------------
// Hostnames
// ---------------------------------------------------------------------------

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/
const RESERVED_TLDS = new Set([
  'localhost',
  'local',
  'internal',
  'invalid',
  'test',
  'example',
  'onion',
  'arpa',
])
/** Second-level registries (theirspa.co.ae, x.com.au) so apex detection and relative record names work. */
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'ac', 'gov', 'sch', 'mil', 'edu'])

const stripHost = (h: string) => trimTrailing(h.trim().toLowerCase().replace(/:\d+$/, ''), '.')
const notIp = () => new DomainError('Enter a domain name (like www.yourspa.ae), not an IP address')

/**
 * Turns what an owner typed ("https://WWW.TheirSpa.ae/booking", "مثال.امارات") into a bare ASCII hostname.
 * Rejects IPs, localhost/reserved names, our own platform domains and their subdomains, and malformed names.
 */
export function normaliseHostname(
  input: string,
  roots: string | readonly string[] = parseRoots(process.env.ROOT_DOMAIN, process.env.EXTRA_ROOT_DOMAINS),
): string {
  let host = input.trim().toLowerCase()
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  host = (host.split(/[/?#\\\s]/)[0] ?? '').replace(/^.*@/, '')
  if (host.startsWith('[') || isIP(host)) throw notIp()
  host = trimTrailing(host.replace(/:\d*$/, ''), '.')
  if (!host) throw new DomainError('Enter your domain, e.g. www.yourspa.ae')
  if (isIP(host)) throw notIp()
  const ascii = domainToASCII(host)
  if (!ascii) throw new DomainError("That doesn't look like a valid domain name")
  if (isIP(ascii)) throw notIp()
  if (ascii.length > 253) throw new DomainError('That domain name is too long')
  const labels = ascii.split('.')
  if (RESERVED_TLDS.has(labels.at(-1)!))
    throw new DomainError("That name can't be used on the public internet")
  if (labels.length < 2) throw new DomainError('Enter the full domain, e.g. www.yourspa.ae')
  if (!labels.every((l) => LABEL.test(l)) || !TLD.test(labels.at(-1)!))
    throw new DomainError("That doesn't look like a valid domain name")
  for (const root of (typeof roots === 'string' ? [roots] : roots).map(stripHost).filter(Boolean))
    if (ascii === root || ascii.endsWith(`.${root}`))
      throw new DomainError(`${root} addresses are already included — add a domain you own`)
  return ascii
}

/** Registrable domain of a hostname (www.theirspa.co.ae → theirspa.co.ae). */
export function apexOf(hostname: string): string {
  const l = hostname.split('.')
  const n = l.length >= 3 && SECOND_LEVEL.has(l.at(-2)!) && l.at(-1)!.length === 2 ? 3 : 2
  return l.slice(-n).join('.')
}

export const isApexHostname = (hostname: string) => apexOf(hostname) === hostname

/** Record name as most DNS panels want it: relative to the zone ("www", "_spamanagement.www", "@"). */
export function relativeName(fqdn: string, apex: string): string {
  return fqdn === apex ? '@' : fqdn.endsWith(`.${apex}`) ? fqdn.slice(0, -(apex.length + 1)) : fqdn
}

/** Advice shown next to the DNS records: apex domains vs the www + forwarding pair. */
export function domainPairNote(hostname: string): { kind: 'apex' | 'www' | 'other'; apex: string } {
  const apex = apexOf(hostname)
  if (hostname === apex) return { kind: 'apex', apex }
  if (hostname === `www.${apex}`) return { kind: 'www', apex }
  return { kind: 'other', apex }
}

export const newVerificationToken = () => `spamanagement-verify=${randomBytes(12).toString('hex')}`

/** Where customers point their CNAME: CF_CNAME_TARGET, or the app host when Cloudflare isn't set up. */
export function cnameTarget(env: Env = process.env): string {
  const explicit = env.CF_CNAME_TARGET?.trim()
  if (explicit) return stripHost(explicit)
  try {
    return stripHost(new URL(env.APP_URL ?? 'http://app.localhost:3000').hostname)
  } catch {
    return 'localhost'
  }
}

export type DnsRecord = {
  type: 'TXT' | 'CNAME'
  /** Fully-qualified name. */
  name: string
  /** Name relative to the zone, as most registrars ask for it. */
  host: string
  value: string
}

/** The two records the owner adds at their DNS provider. */
export function dnsRecordsFor(
  d: Pick<DomainRow, 'hostname' | 'verificationToken'>,
  env: Env = process.env,
): DnsRecord[] {
  const apex = apexOf(d.hostname)
  const txt = `${TXT_LABEL}.${d.hostname}`
  return [
    { type: 'TXT', name: txt, host: relativeName(txt, apex), value: d.verificationToken ?? '' },
    { type: 'CNAME', name: d.hostname, host: relativeName(d.hostname, apex), value: cnameTarget(env) },
  ]
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export type DnsLookup = {
  txt: (name: string) => Promise<string[][]>
  cname: (name: string) => Promise<string[]>
  a: (name: string) => Promise<string[]>
  /** IPv6 addresses. Optional so simple fakes can leave it out (then only IPv4 is compared). */
  aaaa?: (name: string) => Promise<string[]>
}

/**
 * What verificationDns attaches to an answer (the array, or the thrown "missing" error): `partial` = a source failed
 * (timeout, SERVFAIL…), so a negative result may be incomplete; `zone` = what the zone's own nameservers said (their
 * values, or 'missing'), absent when they couldn't be asked or didn't answer. Plain answers (test fakes) carry none and
 * count as complete answers straight from the zone.
 */
export type DnsMeta = { partial: boolean; zone?: unknown[] | 'missing' }
type WithMeta = { meta?: DnsMeta }

/** Public resolvers asked directly for verification lookups (never the host's own resolver chain). */
export const VERIFY_RESOLVERS: readonly string[] = ['1.1.1.1', '8.8.8.8']
/** Each source gets this long; a late one counts as a timeout (the others' answers still count). */
export const DNS_SOURCE_DEADLINE_MS = 4000

/** The resolver calls verificationDns needs: node:dns/promises' Resolver, or a fake in tests. */
export type RawResolver = Pick<
  Resolver,
  'resolveTxt' | 'resolveCname' | 'resolve4' | 'resolve6' | 'resolveNs'
>
/** One resolver per server: a multi-server c-ares channel never moves on after a SERVFAIL/REFUSED. */
export type ResolverFactory = (server: string, opts: { tries: number }) => RawResolver

const MISSING_CODES = new Set(['ENODATA', 'ENOTFOUND'])
/** No authoritative nameservers could be found: that source simply isn't there (not a failure). */
const NO_AUTHORITY = 'ENOAUTHORITY'
const dnsCode = (error: unknown) => (error as { code?: string }).code ?? 'ERROR'
const dnsFailure = (code: string, meta?: DnsMeta) =>
  Object.assign(new Error(`DNS ${code}`), { code }, meta ? { meta } : {})
const unique = <T>(values: T[]) => [...new Map(values.map((v) => [JSON.stringify(v), v])).values()]

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(dnsFailure('ETIMEOUT')), ms)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

type Ask<T> = { authoritative: boolean; run: () => Promise<T[]> }
/**
 * Asks every source at once and merges: any answer wins. "Missing" (ENODATA/ENOTFOUND) only when no source failed —
 * or, with `authorityDecides`, when the zone's own nameservers say so. Otherwise the first failure's code is thrown,
 * which the checks treat as "try again later". The result (or the "missing" error) carries DnsMeta.
 */
export async function askAll<T>(
  asks: Ask<T>[],
  opts: { authorityDecides?: boolean } = {},
): Promise<T[] & WithMeta> {
  const settled = await Promise.allSettled(asks.map((a) => a.run()))
  const found: T[] = []
  const missingCodes: string[] = []
  const errorCodes: string[] = []
  let zone: DnsMeta['zone']
  settled.forEach((r, i) => {
    const authoritative = asks[i]!.authoritative
    if (r.status === 'fulfilled' && r.value.length) {
      found.push(...r.value)
      if (authoritative) zone = r.value
      return
    }
    // c-ares answers a name that is only a CNAME with an empty list: no record of this type.
    const code = r.status === 'fulfilled' ? 'ENODATA' : dnsCode(r.reason)
    if (code === NO_AUTHORITY) return
    if (MISSING_CODES.has(code)) {
      missingCodes.push(code)
      if (authoritative && zone === undefined) zone = 'missing'
    } else errorCodes.push(code)
  })
  const meta: DnsMeta = { partial: errorCodes.length > 0, ...(zone === undefined ? {} : { zone }) }
  if (found.length) return Object.assign(unique(found), { meta })
  if (missingCodes.length && (!meta.partial || (opts.authorityDecides && zone === 'missing')))
    throw dnsFailure(missingCodes[0]!, meta)
  throw dnsFailure(errorCodes[0] ?? 'ERROR', meta)
}

/** Answers from the zone's nameservers (one source): any answer wins; "missing" once one of them says so. */
async function askZone<T>(
  resolvers: RawResolver[],
  call: (r: RawResolver) => Promise<T[]>,
  deadlineMs: number,
): Promise<T[]> {
  if (!resolvers.length) throw dnsFailure(NO_AUTHORITY)
  const settled = await Promise.allSettled(resolvers.map((r) => withDeadline(call(r), deadlineMs)))
  const found = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  if (found.length) return unique(found)
  const codes = settled.map((r) => (r.status === 'fulfilled' ? 'ENODATA' : dnsCode(r.reason)))
  throw dnsFailure(codes.find((c) => MISSING_CODES.has(c)) ?? codes[0] ?? 'ERROR')
}

// Nameserver addresses we never send queries to (a spa's own zone picks its NS records): private, loopback,
// link-local, shared, documentation, benchmarking, multicast and reserved ranges.
const NOT_PUBLIC = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  NOT_PUBLIC.addSubnet(net, bits, 'ipv4')
export const isPublicIpv4 = (ip: string) => isIPv4(ip) && !NOT_PUBLIC.check(ip, 'ipv4')

const nodeResolvers =
  (timeoutMs: number): ResolverFactory =>
  (server, { tries }) => {
    const r = new Resolver({ timeout: timeoutMs, tries })
    r.setServers([server])
    return r
  }

/**
 * DNS for the domain checks. Each lookup asks, in parallel, the zone's own nameservers (no cache at all) and the public
 * resolvers (VERIFY_RESOLVERS, each on its own), never the server's resolver (Docker → the droplet's provider): after a
 * check that ran before the owner added a record, a resolver may keep "no such record" for as long as the zone's SOA
 * says (often a day), and public caches can still hold an old A record. A record any source returns counts; a TXT is
 * "missing" once the zone's own nameservers say so (everything else only when no source failed). Every source has
 * DNS_SOURCE_DEADLINE_MS; nameserver addresses outside public IPv4 are never asked.
 */
export function verificationDns(
  opts: {
    servers?: readonly string[]
    timeoutMs?: number
    deadlineMs?: number
    resolvers?: ResolverFactory
  } = {},
): DnsLookup {
  const make = opts.resolvers ?? nodeResolvers(opts.timeoutMs ?? 1500)
  const deadline = opts.deadlineMs ?? DNS_SOURCE_DEADLINE_MS
  const publics = (opts.servers ?? VERIFY_RESOLVERS).map((s) => make(s, { tries: 2 }))
  const askPublic = <T>(call: (r: RawResolver) => Promise<T[]>) =>
    askAll<T>(publics.map((r) => ({ authoritative: false, run: () => withDeadline(call(r), deadline) })))
  // Found nameservers are kept for this lookup instance (one check, or one worker run); a failed search is retried.
  const zones = new Map<string, Promise<RawResolver[]>>()
  const authority = (zone: string) => {
    let found = zones.get(zone)
    if (!found) {
      found = (async () => {
        const ns = await askPublic((r) => r.resolveNs(zone))
        const ips = await Promise.allSettled(ns.slice(0, 4).map((host) => askPublic((r) => r.resolve4(host))))
        const list = unique(ips.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])))
        return list
          .filter(isPublicIpv4)
          .slice(0, 4)
          .map((ip) => make(ip, { tries: 1 }))
      })().catch(() => [])
      found.then((list) => {
        if (!list.length) zones.delete(zone)
      })
      zones.set(zone, found)
    }
    return found
  }
  const query =
    <T>(call: (r: RawResolver, name: string) => Promise<T[]>, authorityDecides = false) =>
    (name: string) => {
      const zone = authority(apexOf(name))
      return askAll<T>(
        [
          { authoritative: true, run: async () => askZone(await zone, (r) => call(r, name), deadline) },
          ...publics.map((r) => ({
            authoritative: false,
            run: () => withDeadline(call(r, name), deadline),
          })),
        ],
        { authorityDecides },
      )
    }
  return {
    // An out-of-zone CNAME leaves the zone's own servers without the final A/AAAA, so only TXT lets them decide.
    txt: query((r, n) => r.resolveTxt(n), true),
    cname: query((r, n) => r.resolveCname(n)),
    a: query((r, n) => r.resolve4(n)),
    aaaa: query((r, n) => r.resolve6(n)),
  }
}

/**
 * Whether custom domains get HTTPS automatically: Cloudflare for SaaS, or a server that issues certificates on first
 * visit (CUSTOM_DOMAIN_TLS=on-demand: the droplet's Caddy, deploy/droplet/Caddyfile on_demand_tls).
 */
export function customDomainTlsAutomatic(env: Env = process.env): boolean {
  return env.CUSTOM_DOMAIN_TLS?.trim() === 'on-demand' || cloudflareConfig(env) !== null
}

export type DomainDeps = { dns: DnsLookup; cf: CfConfig | null; now: () => Date; env: Env }

export function domainDeps(over: Partial<DomainDeps> = {}): DomainDeps {
  const env = over.env ?? process.env
  return {
    env,
    dns: over.dns ?? verificationDns(),
    cf: over.cf !== undefined ? over.cf : cloudflareConfig(env),
    now: over.now ?? (() => new Date()),
  }
}

type Lookup<T> =
  | { ok: true; value: T; meta?: DnsMeta }
  | { ok: false; missing: boolean; code: string; meta?: DnsMeta }
async function lookup<T>(fn: () => Promise<T>): Promise<Lookup<T>> {
  try {
    const value = await fn()
    return { ok: true, value, meta: (value as WithMeta).meta }
  } catch (error) {
    const code = dnsCode(error)
    return { ok: false, missing: MISSING_CODES.has(code), code, meta: (error as WithMeta).meta }
  }
}
/** The zone's own nameservers answered this lookup (a plain answer without DnsMeta counts as theirs). */
const fromZone = (l: Lookup<unknown>) => (l.ok || l.missing) && (!l.meta || l.meta.zone !== undefined)
/** Addresses the zone's own nameservers gave (plain answers without DnsMeta are theirs). */
const zoneAddresses = (l: Lookup<string[]>) =>
  !l.ok ? [] : !l.meta ? l.value : Array.isArray(l.meta.zone) ? (l.meta.zone as string[]) : []

/**
 * `confirmed`: the zone's own nameservers gave this negative answer (a record that is missing or points elsewhere),
 * not only caches. Only a confirmed "wrong" may end automatic checks or take a live site down.
 */
type Outcome =
  | { state: 'ok' }
  | { state: 'missing' | 'wrong' | 'error'; message: string; confirmed?: boolean }
const norm = (h: string) => h.toLowerCase().replace(/\.$/, '')
const dnsTrouble = (name: string, code: string) =>
  `We couldn't look up ${name} right now (DNS ${code}). We'll try again automatically.`

async function checkOwnership(dns: DnsLookup, hostname: string, token: string | null): Promise<Outcome> {
  const name = `${TXT_LABEL}.${hostname}`
  if (!token)
    return {
      state: 'wrong',
      confirmed: true,
      message: 'This domain has no verification code — remove it and add it again.',
    }
  const r = await lookup(() => dns.txt(name))
  if (!r.ok)
    return r.missing
      ? { state: 'missing', confirmed: fromZone(r), message: `We couldn't find the TXT record ${name} yet.` }
      : { state: 'error', message: dnsTrouble(name, r.code) }
  const values = r.value.map((chunks) => chunks.join('').trim())
  if (values.some((v) => v.includes(token))) return { state: 'ok' }
  return {
    state: 'wrong',
    confirmed: fromZone(r),
    message: `The TXT record ${name} exists but doesn't contain your verification code.`,
  }
}

const noIpv6 = () => Promise.reject(Object.assign(new Error('ENODATA'), { code: 'ENODATA' }))
const addresses = (...found: Lookup<string[]>[]) => found.flatMap((l) => (l.ok ? l.value : [])).map(norm)

/** Does the hostname reach us: a CNAME to the target, or A/AAAA records equal to the target's addresses? */
async function checkRouting(dns: DnsLookup, hostname: string, target: string): Promise<Outcome> {
  const v6 = dns.aaaa ?? noIpv6
  const [cname, a, aaaa, targetA, targetAaaa] = await Promise.all([
    lookup(() => dns.cname(hostname)),
    lookup(() => dns.a(hostname)),
    lookup(() => v6(hostname)),
    lookup(() => dns.a(target)),
    lookup(() => v6(target)),
  ])
  if (cname.ok && cname.value.map(norm).includes(target)) return { state: 'ok' }
  // A bare domain whose DNS host can't hold a CNAME (cPanel and most registrars): A/AAAA records equal to the
  // target's addresses, set by hand or by CNAME flattening / ALIAS records.
  const theirs = addresses(a, aaaa)
  const ours = new Set(addresses(targetA, targetAaaa))
  if (theirs.some((ip) => ours.has(ip))) {
    // Every address the zone itself lists must be ours: a leftover AAAA (cPanel adds one for its server) would send
    // IPv6 visitors — and the certificate check, which prefers IPv6 — to the old host.
    const stray = unique([...zoneAddresses(a), ...zoneAddresses(aaaa)].map(norm)).filter(
      (ip) => !ours.has(ip),
    )
    if (!stray.length) return { state: 'ok' }
    return {
      state: 'wrong',
      confirmed: true,
      message: `${hostname} also points at ${stray.join(', ')}. Delete ${stray.length > 1 ? 'those records' : 'that record'} so every visitor reaches your site.`,
    }
  }
  // Without the target's own addresses nothing can be compared: try again later (never "wrong" on a lookup hiccup).
  if (theirs.length && ours.size === 0)
    return { state: 'error', message: dnsTrouble(target, targetA.ok ? 'ENODATA' : targetA.code) }
  // No match. A failed lookup means the answer may be incomplete: try again later.
  const failed = [cname, a].find((l) => !l.ok && !l.missing)
  if (failed && !failed.ok) return { state: 'error', message: dnsTrouble(hostname, failed.code) }
  const confirmed = fromZone(cname) && fromZone(a)
  const either = `a CNAME to ${target}${ours.size ? ` or an A record to ${[...ours].join(', ')}` : ''}`
  if (cname.ok)
    return {
      state: 'wrong',
      confirmed,
      message: `${hostname} points at ${norm(cname.value[0] ?? '')} instead of ${target}.`,
    }
  if (theirs.length)
    return {
      state: 'wrong',
      confirmed,
      message: `${hostname} points at ${theirs.join(', ')}: it needs ${either}.`,
    }
  return {
    state: 'missing',
    confirmed,
    message: `We couldn't find the CNAME record for ${hostname} yet (${either}).`,
  }
}

/**
 * Whether a hostname reaches us right now (CNAME to the target, or A/AAAA equal to its addresses). The Caddy ask
 * endpoint uses it before allowing a certificate for a custom domain's www twin, so no certificate order is started
 * for a name that points elsewhere.
 */
export async function hostnameReachesUs(
  hostname: string,
  deps: Pick<DomainDeps, 'dns' | 'env'> = domainDeps(),
): Promise<boolean> {
  return (await checkRouting(deps.dns, hostname, cnameTarget(deps.env))).state === 'ok'
}

const cfWaiting = (cf: CfHostname) =>
  `Cloudflare is still setting up ${cf.hostname} (hostname ${cf.status}, certificate ${cf.sslStatus ?? 'not issued'}).${
    cf.errors[0] ? ` ${cf.errors[0]}` : ''
  }`
const cfFailed = (cf: CfHostname) =>
  `Cloudflare stopped serving ${cf.hostname} (hostname ${cf.status}, certificate ${cf.sslStatus ?? 'none'}).${
    cf.errors[0] ? ` ${cf.errors[0]}` : ''
  } Contact support.`

export type DomainPatch = Partial<
  Pick<
    DomainRow,
    'status' | 'sslStatus' | 'lastError' | 'checkedAt' | 'verifiedAt' | 'cfHostnameId' | 'isPrimary'
  >
>

/**
 * Runs the DNS (+ Cloudflare) checks for one domain and returns the new state. No database access.
 * A record that can't be found yet, or a lookup that failed (SERVFAIL, timeout, "not found"), is always "try again
 * later" (owner 2026-10-16): never a permanent fail. `automatic` checks (the worker) give up on a never-verified
 * domain after GIVE_UP_AFTER_MS only on a confirmed wrong answer (a record the zone itself points elsewhere) or a
 * Cloudflare hostname still not ready; a live domain is taken down only on a confirmed wrong answer. Manual checks
 * never give up and ask Cloudflare to retry a hostname it gave up on.
 */
export async function evaluateDomain(
  row: DomainRow,
  deps: DomainDeps,
  opts: { automatic?: boolean } = {},
): Promise<DomainPatch> {
  const now = deps.now()
  const wasActive = row.status === 'active'
  const stale =
    opts.automatic && !row.verifiedAt && now.getTime() - row.createdAt.getTime() > GIVE_UP_AFTER_MS
  const notYet = (status: 'pending' | 'verifying', message: string, final: boolean): DomainPatch =>
    stale && final
      ? {
          status: 'failed',
          lastError: `${message} We stopped checking automatically after 7 days — fix the records and press Check now.`,
        }
      : { status, lastError: message }

  // 1. Ownership — required until the first activation; a verified domain keeps its proof.
  if (!wasActive && !row.verifiedAt) {
    const own = await checkOwnership(deps.dns, row.hostname, row.verificationToken)
    if (own.state !== 'ok')
      return {
        checkedAt: now,
        ...notYet('pending', own.message, own.state === 'wrong' && own.confirmed === true),
      }
  }

  // 2. Routing — the hostname must reach us.
  let routing = await checkRouting(deps.dns, row.hostname, cnameTarget(deps.env))

  // 3. Cloudflare for SaaS hostname + certificate (created once ownership is proven).
  let cf: CfHostname | null = null
  let cfError: string | null = null
  if (deps.cf) {
    try {
      cf = row.cfHostnameId ? await cfGetHostname(deps.cf, row.cfHostnameId) : null
      cf ??= await cfCreateHostname(deps.cf, row.hostname)
      if (cf.failed && !opts.automatic) cf = await cfRetryHostname(deps.cf, cf)
    } catch (error) {
      cfError = error instanceof CloudflareError ? error.message : 'Cloudflare request failed.'
    }
  }
  const base: DomainPatch = {
    checkedAt: now,
    cfHostnameId: cf?.id ?? row.cfHostnameId,
    sslStatus: deps.cf ? (cf?.sslStatus ?? row.sslStatus) : null,
  }
  // An active Cloudflare hostname passed HTTP validation, so traffic reaches us even when the records are
  // hidden behind the customer's own Cloudflare proxy (orange cloud answers with their anycast IPs).
  if (cf?.active) routing = { state: 'ok' }
  const confirmedWrong = routing.state === 'wrong' && routing.confirmed === true

  if (wasActive) {
    // Only a confirmed wrong answer takes a live site down; missing records, lookup failures and API hiccups just
    // leave a note (checked again tomorrow).
    if (confirmedWrong && routing.state !== 'ok')
      return {
        ...base,
        status: 'failed',
        lastError: `${routing.message} Your site is no longer served on this domain — fix the record and press Check now.`,
      }
    if (cf?.failed) return { ...base, status: 'failed', lastError: cfFailed(cf) }
    const note =
      routing.state !== 'ok' ? routing.message : (cfError ?? (cf && !cf.active ? cfWaiting(cf) : null))
    return { ...base, status: 'active', lastError: note }
  }

  if (cf?.failed) return { ...base, status: 'failed', lastError: cfFailed(cf) }
  const problem =
    routing.state !== 'ok' ? routing.message : (cfError ?? (cf && !cf.active ? cfWaiting(cf) : null))
  const final = routing.state === 'ok' ? cfError === null : confirmedWrong
  if (problem) return { ...base, ...notYet('verifying', problem, final) }
  return { ...base, status: 'active', lastError: null, verifiedAt: row.verifiedAt ?? now }
}

/**
 * Should the worker check this domain now? New domains every 10 min, hourly after a day, daily once a never-verified
 * domain is past the give-up time (missing records never fail it), active ones daily, failed ones never.
 */
export function isDomainCheckDue(
  row: Pick<DomainRow, 'status' | 'createdAt' | 'checkedAt'> & { verifiedAt?: Date | null },
  now = new Date(),
) {
  if (row.status === 'failed') return false
  if (!row.checkedAt) return true
  const since = now.getTime() - row.checkedAt.getTime()
  const slack = MIN // the job itself runs every 10 minutes
  if (row.status === 'active') return since >= DAY - slack
  const age = now.getTime() - row.createdAt.getTime()
  if (!row.verifiedAt && age > GIVE_UP_AFTER_MS) return since >= DAY - slack
  return since >= (age < DAY ? 10 * MIN : HOUR) - slack
}

// ---------------------------------------------------------------------------
// Mutations (callers: tenant settings via tenantDomainRun, super-admin + worker)
// ---------------------------------------------------------------------------

async function findDomain(run: DomainRun, id: string): Promise<DomainRow> {
  const [row] = await run((db) => db.select().from(domains).where(eq(domains.id, id)).limit(1))
  if (row?.kind !== 'custom') throw new DomainError('Domain not found', 'not_found')
  return row
}

/** Writes a check result; the first activation makes the domain primary unless another one already is. */
async function saveDomain(run: DomainRun, row: DomainRow, patch: DomainPatch): Promise<DomainRow> {
  return run(async (db) => {
    let set = patch
    if (patch.status === 'active' && !row.verifiedAt) {
      const [other] = await db
        .select({ id: domains.id })
        .from(domains)
        .where(and(eq(domains.tenantId, row.tenantId), eq(domains.isPrimary, true), ne(domains.id, row.id)))
        .limit(1)
      if (!other) set = { ...patch, isPrimary: true }
    }
    const [updated] = await db.update(domains).set(set).where(eq(domains.id, row.id)).returning()
    if (!updated) throw new DomainError('Domain not found', 'not_found')
    return updated
  })
}

const TAKEN = 'That domain is already connected to another spa. Contact support if it is yours.'

export type ReleasedClaim = Pick<DomainRow, 'id' | 'tenantId' | 'hostname' | 'status'>

/**
 * Frees a hostname held by an abandoned claim so another spa can add it: the holding spa is cancelled, or the
 * claim never connected within GIVE_UP_AFTER_MS (so nobody can squat a hostname for longer). A platform
 * lookup (the claim belongs to another spa). Returns the released claim, or null when the hostname stays taken.
 */
export async function releaseAbandonedClaim(
  hostname: string,
  opts: { platform?: Db; deps?: Pick<DomainDeps, 'cf' | 'now'> } = {},
): Promise<ReleasedClaim | null> {
  const db = opts.platform ?? platformDb()
  const deps = opts.deps ?? domainDeps()
  const [claim] = await db
    .select({
      id: domains.id,
      tenantId: domains.tenantId,
      hostname: domains.hostname,
      status: domains.status,
      verifiedAt: domains.verifiedAt,
      createdAt: domains.createdAt,
      tenantStatus: tenants.status,
    })
    .from(domains)
    .innerJoin(tenants, eq(tenants.id, domains.tenantId))
    .where(and(eq(domains.hostname, hostname), eq(domains.kind, 'custom')))
    .limit(1)
  if (!claim) return null
  const abandoned =
    claim.tenantStatus === 'cancelled' ||
    (!claim.verifiedAt && deps.now().getTime() - claim.createdAt.getTime() > GIVE_UP_AFTER_MS)
  if (!abandoned) return null
  try {
    await removeDomain((fn) => fn(db), claim.id, deps)
  } catch {
    return null // Cloudflare unreachable: the claim stays until the next attempt
  }
  return { id: claim.id, tenantId: claim.tenantId, hostname: claim.hostname, status: claim.status }
}

/**
 * Adds a custom hostname for a spa (one for now) with a fresh verification token. A hostname another spa holds
 * is taken over only when that claim is abandoned (see releaseAbandonedClaim; `onRelease` can audit it).
 */
export async function addDomain(
  run: DomainRun,
  tenantId: string,
  input: string,
  env: Env = process.env,
  opts: {
    platform?: Db
    deps?: Pick<DomainDeps, 'cf' | 'now'>
    onRelease?: (claim: ReleasedClaim) => Promise<void>
  } = {},
) {
  const hostname = normaliseHostname(input, parseRoots(env.ROOT_DOMAIN, env.EXTRA_ROOT_DOMAINS))
  const insert = () =>
    run(async (db) => {
      // One add at a time per spa, so two quick submits can't both pass the one-domain limit.
      await db.execute(sql`select pg_advisory_xact_lock(hashtext('domains.add'), hashtext(${tenantId}))`)
      const existing = await db
        .select({ hostname: domains.hostname })
        .from(domains)
        .where(and(eq(domains.tenantId, tenantId), eq(domains.kind, 'custom')))
      if (existing.some((e) => e.hostname === hostname)) throw new DomainError('That domain is already added')
      if (existing.length >= MAX_CUSTOM_DOMAINS)
        throw new DomainError('You can connect one custom domain for now — remove the current one first.')
      const [row] = await db
        .insert(domains)
        .values({
          tenantId,
          hostname,
          kind: 'custom',
          status: 'pending',
          verificationToken: newVerificationToken(),
        })
        .returning()
      return row!
    })
  try {
    return await insert()
  } catch (error) {
    if (pgCode(error) !== '23505') throw error
  }
  const released = await releaseAbandonedClaim(hostname, opts)
  if (!released) throw new DomainError(TAKEN)
  await opts.onRelease?.(released)
  try {
    return await insert()
  } catch (error) {
    if (pgCode(error) === '23505') throw new DomainError(TAKEN)
    throw error
  }
}

/**
 * Re-runs the checks for one domain and stores the outcome. `cooldownMs` refuses a check when the last one
 * was more recent (tenant "Check now": each check costs DNS lookups and shared Cloudflare API quota).
 */
export async function checkDomain(
  run: DomainRun,
  id: string,
  opts: { deps?: DomainDeps; automatic?: boolean; cooldownMs?: number } = {},
): Promise<DomainRow> {
  const deps = opts.deps ?? domainDeps()
  const row = await findDomain(run, id)
  const since = row.checkedAt ? deps.now().getTime() - row.checkedAt.getTime() : Number.POSITIVE_INFINITY
  if (opts.cooldownMs && since < opts.cooldownMs)
    throw new DomainError(
      `Checked a moment ago — try again in ${Math.max(1, Math.ceil((opts.cooldownMs - since) / 1000))} seconds.`,
    )
  const patch = await evaluateDomain(row, deps, { automatic: opts.automatic })
  return saveDomain(run, row, patch)
}

/** Makes an active custom domain the primary address (or, with null, goes back to the free subdomain). */
export async function setPrimaryDomain(run: DomainRun, tenantId: string, id: string | null): Promise<void> {
  await run(async (db) => {
    if (id) {
      const [row] = await db
        .select({ status: domains.status, kind: domains.kind })
        .from(domains)
        .where(and(eq(domains.id, id), eq(domains.tenantId, tenantId)))
      if (row?.kind !== 'custom') throw new DomainError('Domain not found', 'not_found')
      if (row.status !== 'active') throw new DomainError('Only a connected domain can be the primary address')
    }
    await db
      .update(domains)
      .set({ isPrimary: false })
      .where(and(eq(domains.tenantId, tenantId), eq(domains.isPrimary, true)))
    if (id) await db.update(domains).set({ isPrimary: true }).where(eq(domains.id, id))
  })
}

/** Removes a domain, deleting its Cloudflare custom hostname first so nothing is left behind. */
export async function removeDomain(run: DomainRun, id: string, deps: Pick<DomainDeps, 'cf'> = domainDeps()) {
  const row = await findDomain(run, id)
  if (row.cfHostnameId && deps.cf) {
    try {
      await cfDeleteHostname(deps.cf, row.cfHostnameId)
    } catch (error) {
      const why = error instanceof CloudflareError ? error.message : 'Cloudflare request failed.'
      throw new DomainError(`Couldn't remove the domain from Cloudflare (${why}). Please try again.`)
    }
  }
  await run((db) => db.delete(domains).where(eq(domains.id, id)))
  return row
}

/**
 * Support override: activate without our DNS checks (the Cloudflare hostname is still created, or refreshed
 * and retried when Cloudflare gave up on it) or deactivate (status failed, the site stops answering on it).
 */
export async function forceDomainStatus(
  run: DomainRun,
  id: string,
  action: 'activate' | 'deactivate',
  opts: { deps?: DomainDeps; reason?: string | null } = {},
): Promise<DomainRow> {
  const deps = opts.deps ?? domainDeps()
  const row = await findDomain(run, id)
  const now = deps.now()
  if (action === 'deactivate')
    return saveDomain(run, row, {
      status: 'failed',
      checkedAt: now,
      lastError: opts.reason?.trim() || 'Deactivated by support.',
    })
  const patch: DomainPatch = {
    status: 'active',
    checkedAt: now,
    lastError: null,
    verifiedAt: row.verifiedAt ?? now,
  }
  if (deps.cf) {
    try {
      let cf = row.cfHostnameId ? await cfGetHostname(deps.cf, row.cfHostnameId) : null
      cf ??= await cfCreateHostname(deps.cf, row.hostname)
      cf = await cfRetryHostname(deps.cf, cf)
      patch.cfHostnameId = cf.id
      patch.sslStatus = cf.sslStatus
      if (cf.failed) patch.lastError = cfFailed(cf)
    } catch (error) {
      patch.lastError = error instanceof CloudflareError ? error.message : 'Cloudflare request failed.'
    }
  }
  return saveDomain(run, row, patch)
}
