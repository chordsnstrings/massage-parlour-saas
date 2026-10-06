// Domain purchases via Namecheap: spa searches + requests, super-admin approves, the platform registers the
// domain, points its DNS at the platform and connects www.<domain> as the spa's custom domain.
import {
  branches,
  type Db,
  type DbOrTx,
  domainOrders,
  members,
  platformDb,
  platformSettings,
  roles,
  tenants,
  user,
} from '@spa/db'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { addDomain, cnameTarget, type DomainRun, tenantDomainRun } from './domains'
import { DomainError } from './errors'
import {
  type Contact,
  checkDomains,
  type NamecheapConfig,
  NamecheapError,
  namecheapConfig,
  platformRecords,
  registerDomain,
  registerPrices,
  setHosts,
  splitDomain,
} from './integrations/namecheap'

/** AED is pegged to the USD. Spas are billed the registrar cost, rounded up to whole dirhams. */
export const USD_TO_AED = 3.6725
export const aedFromUsd = (usd: number) => Math.ceil(usd * USD_TO_AED)
/** Extensions offered in search (Namecheap doesn't sell .ae; those go through a UAE registrar). */
export const SEARCH_TLDS = ['com', 'co', 'net', 'spa', 'salon', 'beauty', 'massage', 'shop'] as const
export const MAX_OPEN_ORDERS = 3

type Deps = {
  cfg?: NamecheapConfig | null
  fetch?: typeof fetch
  /** Platform-role DB (defaults to platformDb()). */
  db?: Db
  /** App-role DB for the tenant-scoped domain insert (defaults to appDb()). */
  app?: Db
  env?: Record<string, string | undefined>
}

/** Turns "Serenity Spa" or "serenityspa.com" into domains to check. */
export function domainCandidates(query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  if (q.includes('.')) {
    const { sld, tld } = splitDomain(
      q
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split('/')[0]!,
    )
    return [`${sld}.${tld}`, ...SEARCH_TLDS.filter((t) => t !== tld).map((t) => `${sld}.${t}`)]
  }
  const sld = q
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
  if (!sld) throw new DomainError('Use letters and numbers, e.g. “serenity spa”')
  return SEARCH_TLDS.map((t) => `${sld}.${t}`)
}

const priceCache = new Map<string, { usd: number; at: number }>()
async function tldPrices(cfg: NamecheapConfig, tlds: string[], fetchImpl?: typeof fetch) {
  const fresh = (t: string) => {
    const c = priceCache.get(t)
    return c && Date.now() - c.at < 6 * 3600_000 ? c.usd : null
  }
  const missing = tlds.filter((t) => fresh(t) === null)
  if (missing.length) {
    const got = await registerPrices(cfg, missing, fetchImpl)
    for (const [t, usd] of Object.entries(got)) priceCache.set(t, { usd, at: Date.now() })
  }
  return Object.fromEntries(tlds.map((t) => [t, fresh(t)]))
}

export type DomainOffer = {
  domain: string
  available: boolean
  premium: boolean
  priceUsd: number | null
  priceAed: number | null
  note: string | null
}

export async function searchDomains(
  query: string,
  deps: Deps = {},
): Promise<{ configured: boolean; offers: DomainOffer[] }> {
  const cfg = deps.cfg === undefined ? namecheapConfig() : deps.cfg
  if (!cfg) return { configured: false, offers: [] }
  const list = domainCandidates(query).slice(0, 10)
  const checked = await checkDomains(cfg, list, deps.fetch)
  const prices = await tldPrices(cfg, [...new Set(list.map((d) => splitDomain(d).tld))], deps.fetch)
  const offers = list.map<DomainOffer>((d) => {
    const c = checked.find((x) => x.domain === d)
    const usd = c?.premium ? c.premiumPriceUsd : (prices[splitDomain(d).tld] ?? null)
    return {
      domain: d,
      available: Boolean(c?.available && usd),
      premium: Boolean(c?.premium),
      priceUsd: usd,
      priceAed: usd ? aedFromUsd(usd) : null,
      note: c?.error ?? (c?.available && !usd ? 'Price unavailable' : null),
    }
  })
  return { configured: true, offers: offers.sort((a, b) => Number(b.available) - Number(a.available)) }
}

/** A spa asks for a domain; the price is re-checked live and stored on the request. */
/** `run` scopes DB work to the spa (tenantDomainRun); registrar calls happen outside any transaction. */
export async function requestDomain(
  run: DomainRun,
  r: { tenantId: string; domain: string; userId: string; years?: number },
  deps: Deps = {},
) {
  const cfg = deps.cfg === undefined ? namecheapConfig() : deps.cfg
  if (!cfg) throw new DomainError('Domain purchases aren’t set up yet — ask support.')
  const { sld, tld } = splitDomain(r.domain)
  const domain = `${sld}.${tld}`
  const openOrders = () =>
    run((db) =>
      db
        .select({ id: domainOrders.id })
        .from(domainOrders)
        .where(
          and(
            eq(domainOrders.tenantId, r.tenantId),
            inArray(domainOrders.status, ['requested', 'purchasing']),
          ),
        ),
    )
  if ((await openOrders()).length >= MAX_OPEN_ORDERS)
    throw new DomainError('You already have three open requests — wait for them first.')
  const [check] = await checkDomains(cfg, [domain], deps.fetch)
  if (!check?.available) throw new DomainError(check?.error ?? `${domain} is not available`)
  const usd = check.premium ? check.premiumPriceUsd : (await tldPrices(cfg, [tld], deps.fetch))[tld]
  if (!usd) throw new DomainError('Could not get a price for that domain — try again shortly.')
  const years = Math.min(Math.max(Math.round(r.years ?? 1), 1), 5)
  try {
    const [order] = await run((db) =>
      db
        .insert(domainOrders)
        .values({
          tenantId: r.tenantId,
          domain,
          years,
          priceUsd: (usd * years).toFixed(2),
          priceAed: (aedFromUsd(usd) * years).toFixed(2),
          premium: check.premium,
          requestedBy: r.userId,
        })
        .returning(),
    )
    return order!
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } }
    if ((e.cause?.code ?? e.code) === '23505')
      throw new DomainError('Someone has already requested that domain.')
    throw error
  }
}

export async function cancelDomainOrder(tx: DbOrTx, orderId: string) {
  const [row] = await tx
    .update(domainOrders)
    .set({ status: 'cancelled' })
    .where(and(eq(domainOrders.id, orderId), eq(domainOrders.status, 'requested')))
    .returning()
  if (!row) throw new DomainError('Only open requests can be cancelled')
  return row
}

/** Splits "Aisha Al Mansoori" into first/last for registrar contacts. */
export function splitName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: 'Spa', lastName: 'Owner' }
  if (parts.length === 1) return { firstName: parts[0]!, lastName: parts[0]! }
  return { firstName: parts[0]!, lastName: parts.slice(1).join(' ') }
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

/** Registrant = the spa (owner + spa's legal name + branch address); admin/tech/billing = the platform operator. */
async function contactsFor(db: Db, tenantId: string) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId))
  if (!tenant) throw new DomainError('Spa not found', 'not_found')
  const [owner] = await db
    .select({ name: user.name, email: user.email })
    .from(members)
    .innerJoin(roles, eq(roles.id, members.roleId))
    .innerJoin(user, eq(user.id, members.userId))
    .where(and(eq(members.tenantId, tenantId), eq(roles.key, 'owner'), eq(members.status, 'active')))
    .limit(1)
  const [branch] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), eq(branches.isDefault, true)))
    .limit(1)
  const [platform] = await db.select().from(platformSettings).limit(1)
  const phone = digits(branch?.whatsappE164) || digits(branch?.phone) || digits(platform?.phone)
  if (!owner) throw new DomainError('The spa has no active owner to register the domain to')
  if (phone.length < 9)
    throw new DomainError('Add a phone number to the spa (Settings) or the platform company details first')
  const base = { city: 'Dubai', stateProvince: 'Dubai', postalCode: '00000', country: 'AE' }
  const registrant: Contact = {
    ...splitName(owner.name),
    organization: tenant.legalName || tenant.name,
    address1: (branch?.address || platform?.address || 'Dubai').slice(0, 120),
    ...base,
    phoneE164: phone.startsWith('971') || phone.length > 10 ? phone : `971${phone.replace(/^0/, '')}`,
    email: owner.email,
  }
  const platformPhone = digits(platform?.phone) || registrant.phoneE164
  const admin: Contact = {
    ...splitName(platform?.legalName || platform?.companyName || 'Spa Management'),
    organization: platform?.legalName || platform?.companyName || 'spamanagement.ae',
    address1: (platform?.address || registrant.address1).slice(0, 120),
    ...base,
    phoneE164: platformPhone,
    email: platform?.email || owner.email,
  }
  return { registrant, admin }
}

/**
 * Super-admin approval: locks the order, registers the domain (charges the Namecheap balance), connects
 * www.<domain> as the spa's custom domain and points DNS at the platform. Idempotent per order.
 */
export async function approveDomainOrder(orderId: string, adminUserId: string, deps: Deps = {}) {
  const cfg = deps.cfg === undefined ? namecheapConfig() : deps.cfg
  if (!cfg) throw new DomainError('Namecheap is not configured on this server')
  const db = deps.db ?? platformDb()
  const [order] = await db
    .update(domainOrders)
    .set({ status: 'purchasing', decidedBy: adminUserId, decidedAt: new Date(), error: null })
    .where(and(eq(domainOrders.id, orderId), inArray(domainOrders.status, ['requested', 'failed'])))
    .returning()
  if (!order) throw new DomainError('This request is no longer waiting for approval')

  let registered: Awaited<ReturnType<typeof registerDomain>>
  try {
    const { registrant, admin } = await contactsFor(db, order.tenantId)
    const [check] = await checkDomains(cfg, [order.domain], deps.fetch)
    if (!check?.available) throw new DomainError(`${order.domain} is no longer available`)
    registered = await registerDomain(
      cfg,
      {
        domain: order.domain,
        years: order.years,
        registrant,
        admin,
        premiumPriceUsd: check.premium ? check.premiumPriceUsd : null,
      },
      deps.fetch,
    )
  } catch (error) {
    const message =
      error instanceof DomainError || error instanceof NamecheapError ? error.message : 'Registration failed'
    await db
      .update(domainOrders)
      .set({ status: 'failed', error: message })
      .where(eq(domainOrders.id, order.id))
    throw error instanceof DomainError ? error : new DomainError(message)
  }

  // Registered (money spent) — from here on failures are recorded as notes, never as a failed order.
  const notes: string[] = []
  let domainId: string | null = null
  try {
    const row = await addDomain(
      tenantDomainRun(order.tenantId, deps.app),
      order.tenantId,
      `www.${order.domain}`,
      deps.env,
    )
    domainId = row.id
    const ok = await setHosts(
      cfg,
      order.domain,
      platformRecords(order.domain, {
        cname: cnameTarget(deps.env),
        verificationToken: row.verificationToken ?? '',
      }),
      deps.fetch,
    )
    if (!ok) notes.push('DNS records were not confirmed by Namecheap — set them from the spa’s domain page.')
  } catch (error) {
    notes.push(
      error instanceof DomainError || error instanceof NamecheapError
        ? `Registered, but connecting failed: ${error.message}`
        : 'Registered, but connecting the domain failed — connect it from the spa’s domain page.',
    )
  }
  const [done] = await db
    .update(domainOrders)
    .set({
      status: 'purchased',
      chargedUsd: registered.chargedUsd.toFixed(2),
      registrarOrderId: registered.orderId,
      registrarDomainId: registered.domainId,
      domainId,
      error: notes.join(' ') || null,
    })
    .where(eq(domainOrders.id, order.id))
    .returning()
  return done!
}

export async function rejectDomainOrder(
  orderId: string,
  adminUserId: string,
  note: string,
  db: Db = platformDb(),
) {
  const [row] = await db
    .update(domainOrders)
    .set({ status: 'rejected', decidedBy: adminUserId, decidedAt: new Date(), note: note.slice(0, 300) })
    .where(and(eq(domainOrders.id, orderId), eq(domainOrders.status, 'requested')))
    .returning()
  if (!row) throw new DomainError('This request is no longer waiting for approval')
  return row
}

/** Super-admin queue: open requests first, then recent decisions. */
export async function listDomainOrders(limit = 50, db: Db = platformDb()) {
  return db
    .select({ order: domainOrders, spa: tenants.name, slug: tenants.slug })
    .from(domainOrders)
    .innerJoin(tenants, eq(tenants.id, domainOrders.tenantId))
    .orderBy(sql`${domainOrders.status} = 'requested' desc`, desc(domainOrders.createdAt))
    .limit(limit)
}
