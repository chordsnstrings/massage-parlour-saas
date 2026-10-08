'use server'
import { withTenant } from '@spa/db'
import {
  addDomain,
  cancelDomainOrder,
  checkDomain,
  DomainError,
  type DomainOffer,
  MANUAL_CHECK_COOLDOWN_MS,
  NamecheapError,
  normaliseHostname,
  removeDomain,
  requestDomain,
  searchDomains,
  setPrimaryDomain,
  tenantDomainRun,
} from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { domainErrorRef } from '@/i18n/domain-errors'
import { getT } from '@/i18n/server'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { guard, type MemberContext } from '@/server/access'
import { audit } from '@/server/audit'
import { invalidateSiteHost } from '@/server/sites'

/** A service message as a field error: its `errors.domain.*` key when it has no parameters, else the text. */
const fieldText = (message: string) => {
  const ref = domainErrorRef(message)
  return ref && !ref.params ? ref.key : message
}

const hostnameField = z
  .string()
  .max(300, 'settings.domains.result.tooLong')
  .transform((value, zctx) => {
    try {
      return normaliseHostname(value)
    } catch (error) {
      zctx.addIssue({ code: 'custom', message: fieldText((error as Error).message) })
      return z.NEVER
    }
  })
const domainId = z.uuid()

const record = (ctx: MemberContext, action: string, entityId: string, data: unknown) =>
  audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action,
    entity: 'domain',
    entityId,
    data,
  })

const refresh = (slug: string) => revalidatePath(`/dashboard/${slug}`, 'layout')

const domainFail = (error: unknown): ActionResult => {
  if (error instanceof DomainError) return failDomain(error)
  throw error
}

export async function addDomainAction(
  slug: string,
  _prev: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'settings.manage')
  if (error) return fail(error)
  const parsed = z.object({ hostname: hostnameField }).safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  try {
    const d = await addDomain(
      tenantDomainRun(ctx.tenant.id),
      ctx.tenant.id,
      parsed.data.hostname,
      undefined,
      {
        // An abandoned claim by another spa was freed for this one: audited on the spa that lost it.
        onRelease: async (claim) => {
          invalidateSiteHost(claim.hostname)
          await audit({
            tenantId: claim.tenantId,
            actorUserId: ctx.user.id,
            action: 'domain.claim_released',
            entity: 'domain',
            entityId: claim.id,
            data: { hostname: claim.hostname, status: claim.status, toTenantId: ctx.tenant.id },
          })
        },
      },
    )
    await record(ctx, 'domain.added', d.id, { hostname: d.hostname })
    refresh(slug)
    return ok({ key: 'settings.domains.result.added', params: { host: d.hostname } })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e, { hostname: e.i18n?.key ?? fieldText(e.message) })
    throw e
  }
}

export async function checkDomainAction(slug: string, id: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'settings.manage')
  if (error) return fail(error)
  if (!domainId.safeParse(id).success) return fail('settings.domains.result.notFound')
  try {
    const run = tenantDomainRun(ctx.tenant.id)
    const before = await run((db) => db.query.domains.findFirst({ where: (d, { eq }) => eq(d.id, id) }))
    const d = await checkDomain(run, id, { cooldownMs: MANUAL_CHECK_COOLDOWN_MS })
    invalidateSiteHost(d.hostname)
    if (before?.status !== d.status)
      await record(ctx, 'domain.status_changed', d.id, {
        hostname: d.hostname,
        from: before?.status,
        to: d.status,
      })
    refresh(slug)
    if (d.status === 'active') return ok({ key: 'settings.domains.result.connected', params: { host: d.hostname } })
    return d.lastError
      ? failDomain({ message: d.lastError })
      : fail('settings.domains.result.notConnected')
  } catch (e) {
    return domainFail(e)
  }
}

export async function setPrimaryDomainAction(slug: string, id: string | null): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'settings.manage')
  if (error) return fail(error)
  if (id !== null && !domainId.safeParse(id).success) return fail('settings.domains.result.notFound')
  try {
    await setPrimaryDomain(tenantDomainRun(ctx.tenant.id), ctx.tenant.id, id)
    await record(ctx, 'domain.primary_set', id ?? ctx.tenant.id, { domainId: id, subdomain: id === null })
    refresh(slug)
    return ok(id ? 'settings.domains.result.primaryUpdated' : 'settings.domains.result.freePrimary')
  } catch (e) {
    return domainFail(e)
  }
}

export async function removeDomainAction(slug: string, id: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'settings.manage')
  if (error) return fail(error)
  if (!domainId.safeParse(id).success) return fail('settings.domains.result.notFound')
  try {
    const d = await removeDomain(tenantDomainRun(ctx.tenant.id), id)
    invalidateSiteHost(d.hostname)
    await record(ctx, 'domain.removed', d.id, { hostname: d.hostname, cfHostnameId: d.cfHostnameId })
    refresh(slug)
    return ok({ key: 'settings.domains.result.removed', params: { host: d.hostname } })
  } catch (e) {
    return domainFail(e)
  }
}

// --- Buying a domain (Namecheap; the super-admin approves every purchase) -----------------------------

/** Each search costs registrar API calls: keep it to 20 per spa per 10 minutes. */
const searches = new Map<string, number[]>()
function searchAllowed(tenantId: string) {
  const now = Date.now()
  const recent = (searches.get(tenantId) ?? []).filter((t) => now - t < 10 * 60_000)
  if (recent.length >= 20) return false
  searches.set(tenantId, [...recent, now])
  return true
}

export type DomainSearchResult =
  | { ok: true; configured: boolean; offers: DomainOffer[] }
  | { ok: false; error: string }

export async function searchDomainsAction(slug: string, query: string): Promise<DomainSearchResult> {
  const { ctx, error } = await guard(slug, 'settings.manage')
  if (error) return { ok: false, error }
  const q = String(query ?? '').trim()
  const t = await getT()
  if (q.length < 2 || q.length > 80) return { ok: false, error: t('settings.domains.result.searchShort') }
  if (!searchAllowed(ctx.tenant.id)) return { ok: false, error: t('settings.domains.result.searchLimit') }
  try {
    return { ok: true, ...(await searchDomains(q)) }
  } catch (e) {
    if (e instanceof DomainError) {
      const ref = e.i18n ?? domainErrorRef(e.message)
      return { ok: false, error: ref ? t(ref.key, ref.params) : e.message }
    }
    if (e instanceof NamecheapError) return { ok: false, error: e.message }
    throw e
  }
}

export async function requestDomainAction(slug: string, domain: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'settings.manage')
  if (error) return fail(error)
  if (typeof domain !== 'string' || domain.length > 253) return fail('settings.domains.result.pick')
  try {
    const order = await requestDomain(tenantDomainRun(ctx.tenant.id), {
      tenantId: ctx.tenant.id,
      domain,
      userId: ctx.user.id,
    })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
      action: 'domain_order.requested',
      entity: 'domain_order',
      entityId: order.id,
      data: { domain: order.domain, priceAed: order.priceAed },
    })
    refresh(slug)
    return ok({ key: 'settings.domains.result.requested', params: { domain: order.domain } })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    if (e instanceof NamecheapError) return fail(e.message)
    throw e
  }
}

export async function cancelDomainOrderAction(slug: string, id: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'settings.manage')
  if (error) return fail(error)
  if (!domainId.safeParse(id).success) return fail('settings.domains.result.requestNotFound')
  try {
    const order = await withTenant(ctx.tenant.id, (tx) => cancelDomainOrder(tx, id))
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
      action: 'domain_order.cancelled',
      entity: 'domain_order',
      entityId: order.id,
      data: { domain: order.domain },
    })
    refresh(slug)
    return ok({ key: 'settings.domains.result.cancelled', params: { domain: order.domain } })
  } catch (e) {
    return domainFail(e)
  }
}
