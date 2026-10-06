// Custom domains (PLAN §1.1, §3.3). A spa connects one hostname it owns (e.g. www.theirspa.ae):
//   pending   → added; waiting for the TXT record _spamanagement.<host> = verification token (proves ownership)
//   verifying → ownership proven; waiting for the CNAME (→ CF_CNAME_TARGET, or the APP_URL host without
//               Cloudflare) and, when Cloudflare for SaaS is configured, for its hostname + certificate
//   active    → served by resolveSiteTenant(); the first activation makes it the primary address
//   failed    → Cloudflare gave up, the DNS moved away from us, automatic checks gave up after 7 days,
//               or support deactivated it. "Check now" re-runs the checks from any state.
import { randomBytes } from 'node:crypto'
import { Resolver } from 'node:dns/promises'
import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'
import { type Db, type DbOrTx, domains, withTenant } from '@spa/db'
import { and, eq, ne } from 'drizzle-orm'
import { DomainError, pgCode } from './errors'
import {
  type CfConfig,
  type CfHostname,
  CloudflareError,
  cfCreateHostname,
  cfDeleteHostname,
  cfGetHostname,
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
/** Automatic checks stop (status → failed) when a domain hasn't connected within this time. */
export const GIVE_UP_AFTER_MS = 7 * 86_400_000

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

const stripHost = (h: string) => h.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.+$/, '')
const notIp = () => new DomainError('Enter a domain name (like www.yourspa.ae), not an IP address')

/**
 * Turns what an owner typed ("https://WWW.TheirSpa.ae/booking", "مثال.امارات") into a bare ASCII hostname.
 * Rejects IPs, localhost/reserved names, our own root domain and its subdomains, and malformed names.
 */
export function normaliseHostname(input: string, rootDomain = process.env.ROOT_DOMAIN ?? ''): string {
  let host = input.trim().toLowerCase()
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  host = (host.split(/[/?#\\\s]/)[0] ?? '').replace(/^.*@/, '')
  if (host.startsWith('[') || isIP(host)) throw notIp()
  host = host.replace(/:\d*$/, '').replace(/\.+$/, '')
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
  const root = stripHost(rootDomain)
  if (root && (ascii === root || ascii.endsWith(`.${root}`)))
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
}

/** Node's resolver with short timeouts (a check never blocks a request for long). */
export function systemDns(timeoutMs = 2500): DnsLookup {
  const r = new Resolver({ timeout: timeoutMs, tries: 2 })
  return { txt: (n) => r.resolveTxt(n), cname: (n) => r.resolveCname(n), a: (n) => r.resolve4(n) }
}

export type DomainDeps = { dns: DnsLookup; cf: CfConfig | null; now: () => Date; env: Env }

export function domainDeps(over: Partial<DomainDeps> = {}): DomainDeps {
  const env = over.env ?? process.env
  return {
    env,
    dns: over.dns ?? systemDns(),
    cf: over.cf !== undefined ? over.cf : cloudflareConfig(env),
    now: over.now ?? (() => new Date()),
  }
}

type Lookup<T> = { ok: true; value: T } | { ok: false; missing: boolean; code: string }
async function lookup<T>(fn: () => Promise<T>): Promise<Lookup<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'ERROR'
    return { ok: false, missing: code === 'ENODATA' || code === 'ENOTFOUND', code }
  }
}

type Outcome = { state: 'ok' } | { state: 'missing' | 'wrong' | 'error'; message: string }
const norm = (h: string) => h.toLowerCase().replace(/\.$/, '')
const dnsTrouble = (name: string, code: string) =>
  `We couldn't look up ${name} right now (DNS ${code}). We'll try again automatically.`

async function checkOwnership(dns: DnsLookup, hostname: string, token: string | null): Promise<Outcome> {
  const name = `${TXT_LABEL}.${hostname}`
  if (!token)
    return { state: 'wrong', message: 'This domain has no verification code — remove it and add it again.' }
  const r = await lookup(() => dns.txt(name))
  if (!r.ok)
    return r.missing
      ? { state: 'missing', message: `We couldn't find the TXT record ${name} yet.` }
      : { state: 'error', message: dnsTrouble(name, r.code) }
  const values = r.value.map((chunks) => chunks.join('').trim())
  return values.some((v) => v.includes(token))
    ? { state: 'ok' }
    : { state: 'wrong', message: `The TXT record ${name} exists but doesn't contain your verification code.` }
}

async function checkRouting(dns: DnsLookup, hostname: string, target: string): Promise<Outcome> {
  const cname = await lookup(() => dns.cname(hostname))
  if (cname.ok && cname.value.map(norm).includes(target)) return { state: 'ok' }
  // Root domains with CNAME flattening / ALIAS records answer with the target's addresses instead.
  const a = await lookup(() => dns.a(hostname))
  if (a.ok) {
    const t = await lookup(() => dns.a(target))
    if (t.ok && a.value.some((ip) => t.value.includes(ip))) return { state: 'ok' }
  }
  if (cname.ok)
    return {
      state: 'wrong',
      message: `${hostname} points at ${norm(cname.value[0] ?? '')} instead of ${target}.`,
    }
  if (a.ok) return { state: 'wrong', message: `${hostname} doesn't point at ${target} yet.` }
  if (!cname.missing) return { state: 'error', message: dnsTrouble(hostname, cname.code) }
  if (!a.missing) return { state: 'error', message: dnsTrouble(hostname, a.code) }
  return { state: 'missing', message: `We couldn't find the CNAME record for ${hostname} yet.` }
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
 * `automatic` checks (the worker) give up after GIVE_UP_AFTER_MS; manual ones never do.
 */
export async function evaluateDomain(
  row: DomainRow,
  deps: DomainDeps,
  opts: { automatic?: boolean } = {},
): Promise<DomainPatch> {
  const now = deps.now()
  const wasActive = row.status === 'active'
  const stale = opts.automatic && now.getTime() - row.createdAt.getTime() > GIVE_UP_AFTER_MS
  const notYet = (status: 'pending' | 'verifying', message: string): DomainPatch =>
    stale
      ? {
          status: 'failed',
          lastError: `${message} We stopped checking automatically after 7 days — fix the records and press Check now.`,
        }
      : { status, lastError: message }

  // 1. Ownership — required until the first activation; an active domain keeps its proof.
  if (!wasActive) {
    const own = await checkOwnership(deps.dns, row.hostname, row.verificationToken)
    if (own.state !== 'ok') return { checkedAt: now, ...notYet('pending', own.message) }
  }

  // 2. Routing — the hostname must reach us.
  const routing = await checkRouting(deps.dns, row.hostname, cnameTarget(deps.env))

  // 3. Cloudflare for SaaS hostname + certificate (created once ownership is proven).
  let cf: CfHostname | null = null
  let cfError: string | null = null
  if (deps.cf) {
    try {
      cf = row.cfHostnameId ? await cfGetHostname(deps.cf, row.cfHostnameId) : null
      cf ??= await cfCreateHostname(deps.cf, row.hostname)
    } catch (error) {
      cfError = error instanceof CloudflareError ? error.message : 'Cloudflare request failed.'
    }
  }
  const base: DomainPatch = {
    checkedAt: now,
    cfHostnameId: cf?.id ?? row.cfHostnameId,
    sslStatus: deps.cf ? (cf?.sslStatus ?? row.sslStatus) : null,
  }

  if (wasActive) {
    // Only definitive answers take a live site down; timeouts and API hiccups just leave a note.
    if (routing.state === 'missing' || routing.state === 'wrong')
      return {
        ...base,
        status: 'failed',
        lastError: `${routing.message} Your site is no longer served on this domain — fix the record and press Check now.`,
      }
    if (cf?.failed) return { ...base, status: 'failed', lastError: cfFailed(cf) }
    const note =
      routing.state === 'error' ? routing.message : (cfError ?? (cf && !cf.active ? cfWaiting(cf) : null))
    return { ...base, status: 'active', lastError: note }
  }

  if (cf?.failed) return { ...base, status: 'failed', lastError: cfFailed(cf) }
  const problem =
    routing.state !== 'ok' ? routing.message : (cfError ?? (cf && !cf.active ? cfWaiting(cf) : null))
  if (problem) return { ...base, ...notYet('verifying', problem) }
  return { ...base, status: 'active', lastError: null, verifiedAt: row.verifiedAt ?? now }
}

/** Should the worker check this domain now? New domains every 10 min, hourly after a day, active ones daily. */
export function isDomainCheckDue(
  row: Pick<DomainRow, 'status' | 'createdAt' | 'checkedAt'>,
  now = new Date(),
) {
  if (row.status === 'failed') return false
  if (!row.checkedAt) return true
  const since = now.getTime() - row.checkedAt.getTime()
  const slack = MIN // the job itself runs every 10 minutes
  if (row.status === 'active') return since >= DAY - slack
  const young = now.getTime() - row.createdAt.getTime() < DAY
  return since >= (young ? 10 * MIN : HOUR) - slack
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

/** Adds a custom hostname for a spa (one for now) with a fresh verification token. */
export async function addDomain(run: DomainRun, tenantId: string, input: string, env: Env = process.env) {
  const hostname = normaliseHostname(input, env.ROOT_DOMAIN ?? '')
  try {
    return await run(async (db) => {
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
  } catch (error) {
    if (pgCode(error) === '23505')
      throw new DomainError(
        'That domain is already connected to another spa. Contact support if it is yours.',
      )
    throw error
  }
}

/** Re-runs the checks for one domain and stores the outcome. */
export async function checkDomain(
  run: DomainRun,
  id: string,
  opts: { deps?: DomainDeps; automatic?: boolean } = {},
): Promise<DomainRow> {
  const row = await findDomain(run, id)
  const patch = await evaluateDomain(row, opts.deps ?? domainDeps(), { automatic: opts.automatic })
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
 * Support override: activate without our DNS checks (Cloudflare hostname still created when configured)
 * or deactivate (status failed, the site stops answering on that host).
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
  if (deps.cf && !row.cfHostnameId) {
    try {
      const cf = await cfCreateHostname(deps.cf, row.hostname)
      patch.cfHostnameId = cf.id
      patch.sslStatus = cf.sslStatus
    } catch (error) {
      patch.lastError = error instanceof CloudflareError ? error.message : 'Cloudflare request failed.'
    }
  }
  return saveDomain(run, row, patch)
}
