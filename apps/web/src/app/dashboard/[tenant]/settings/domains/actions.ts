'use server'
import {
  addDomain,
  checkDomain,
  DomainError,
  MANUAL_CHECK_COOLDOWN_MS,
  normaliseHostname,
  removeDomain,
  setPrimaryDomain,
  tenantDomainRun,
} from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { guard, type MemberContext } from '@/server/access'
import { audit } from '@/server/audit'
import { invalidateSiteHost } from '@/server/sites'

const hostnameField = z
  .string()
  .max(300, 'That domain is too long')
  .transform((value, zctx) => {
    try {
      return normaliseHostname(value)
    } catch (error) {
      zctx.addIssue({ code: 'custom', message: (error as Error).message })
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
  if (error instanceof DomainError) return fail(error.message)
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
    return ok(`${d.hostname} added — now add the two DNS records`)
  } catch (e) {
    if (e instanceof DomainError) return fail(e.message, { hostname: e.message })
    throw e
  }
}

export async function checkDomainAction(slug: string, id: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'settings.manage')
  if (error) return fail(error)
  if (!domainId.safeParse(id).success) return fail('Domain not found')
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
    if (d.status === 'active') return ok(`${d.hostname} is connected`)
    return fail(d.lastError ?? 'Not connected yet — check the DNS records below.')
  } catch (e) {
    return domainFail(e)
  }
}

export async function setPrimaryDomainAction(slug: string, id: string | null): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'settings.manage')
  if (error) return fail(error)
  if (id !== null && !domainId.safeParse(id).success) return fail('Domain not found')
  try {
    await setPrimaryDomain(tenantDomainRun(ctx.tenant.id), ctx.tenant.id, id)
    await record(ctx, 'domain.primary_set', id ?? ctx.tenant.id, { domainId: id, subdomain: id === null })
    refresh(slug)
    return ok(id ? 'Primary address updated' : 'Your free address is primary again')
  } catch (e) {
    return domainFail(e)
  }
}

export async function removeDomainAction(slug: string, id: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'settings.manage')
  if (error) return fail(error)
  if (!domainId.safeParse(id).success) return fail('Domain not found')
  try {
    const d = await removeDomain(tenantDomainRun(ctx.tenant.id), id)
    invalidateSiteHost(d.hostname)
    await record(ctx, 'domain.removed', d.id, { hostname: d.hostname, cfHostnameId: d.cfHostnameId })
    refresh(slug)
    return ok(`${d.hostname} removed`)
  } catch (e) {
    return domainFail(e)
  }
}
