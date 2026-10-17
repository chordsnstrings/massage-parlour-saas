'use server'
// R33 Redirects (Website Studio, console — English): addresses of the spa's old website → pages of its site, live at
// once, so only the studio with `site.publish`. Every change is audited; revalidateStudio also clears the proxy's
// redirect cache (server/site-redirect.ts).
import { normalizeRedirectSource, normalizeRedirectTarget, parseRedirectLines, wwwPair } from '@spa/core'
import { domains, type Tx, withTenant } from '@spa/db'
import {
  deleteAllSiteRedirects,
  deleteSiteRedirects,
  type SiteRedirectSave,
  saveSiteRedirects,
} from '@spa/services'
import { z } from 'zod'
import { type ActionResult, fail, fromZod, ok } from '@/lib/action'
import { PATH_ROUTING } from '@/lib/paths'
import { type MemberContext, studioGuard } from '@/server/access'
import { audit } from '@/server/audit'
import { platformRoots } from '@/server/origin'
import { revalidateStudio } from '@/server/studio'

const auditAs = (ctx: MemberContext, action: string, entityId: string | undefined, data: unknown) =>
  audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action,
    entity: 'site_redirect',
    entityId,
    data,
  })

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const shown = (from: string, query: string) => (query ? `${from}?${query}` : from)
/** Other rows the save's chain shortening moved (X → B now X → C), for the audit. */
const movedSample = (r: SiteRedirectSave) =>
  r.moved.slice(0, 20).map((m) => ({ from: shown(m.from, m.query), before: m.before, after: m.after }))

/** The spa's public addresses a pasted full URL may be on: its domains (+ www twins) and its free address. */
async function addressesOf(tx: Tx, slug: string): Promise<string[]> {
  const hosts = (await tx.select({ hostname: domains.hostname }).from(domains)).map((d) => d.hostname)
  return [
    ...hosts.flatMap((h) => [h, wwwPair(h) ?? h]),
    ...platformRoots().map((root) => {
      const bare = root.replace(/:\d+$/, '')
      return PATH_ROUTING ? `${bare}/s/${slug}` : `${slug}.${bare}`
    }),
  ]
}

/** "3 redirects added, 1 updated, 1 chain shortened, 2 skipped". */
function summary(r: SiteRedirectSave, skipped: number): string {
  return [
    r.added || !(r.updated || r.unchanged) ? `${plural(r.added, 'redirect', 'redirects')} added` : null,
    r.updated ? `${r.updated} updated` : null,
    r.unchanged ? `${r.unchanged} unchanged` : null,
    r.flattened ? `${plural(r.flattened, 'chain', 'chains')} shortened` : null,
    skipped ? `${skipped} skipped` : null,
  ]
    .filter(Boolean)
    .join(', ')
}

/** The new address field: a page from the list, or the typed path when "Other path…" is picked. */
const targetOf = (fd: FormData) => {
  const picked = String(fd.get('target') ?? '')
  return picked === 'other'
    ? { to: String(fd.get('toOther') ?? ''), field: 'toOther' }
    : { to: picked, field: 'target' }
}

const addSchema = z.object({
  from: z.string().trim().min(1, 'Enter the old address').max(2000, 'That address is too long'),
  to: z.string().trim().min(1, 'Pick the new address').max(2000, 'That address is too long'),
})

/** "Add redirect": one old address → a page (a new target replaces an existing redirect's). */
export async function addRedirectAction(
  slug: string,
  _prev: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.publish')
  if (error) return fail(error)
  const target = targetOf(fd)
  const parsed = addSchema.safeParse({ from: fd.get('from') ?? '', to: target.to })
  if (!parsed.success) {
    const r = fromZod(parsed.error, { english: true })
    const errors = r && !r.ok ? r.fieldErrors : undefined
    return fail('errors.checkFields', {
      ...(errors?.from ? { from: errors.from } : {}),
      ...(errors?.to ? { [target.field]: errors.to } : {}),
    })
  }
  const tenantId = ctx.tenant.id
  const outcome = await withTenant(tenantId, async (tx) => {
    const addresses = await addressesOf(tx, ctx.tenant.slug)
    const source = normalizeRedirectSource(parsed.data.from, { addresses })
    if ('error' in source) return { field: 'from', error: source.error }
    const to = normalizeRedirectTarget(parsed.data.to, { addresses })
    if ('error' in to) return { field: target.field, error: to.error }
    return saveSiteRedirects(tx, tenantId, [{ from: source.path, query: source.query, to: to.to }], {
      userId: ctx.user.id,
      source: 'manual',
    })
  })
  if ('error' in outcome) return fail(outcome.error, { [outcome.field]: outcome.error })
  const [skip] = outcome.skipped
  if (skip) return fail(skip.reason, { from: skip.reason })
  const [row] = outcome.saved
  if (!row || outcome.unchanged) return ok('That redirect is already there.')
  await auditAs(ctx, 'site.redirect.added', row.id, {
    from: shown(row.from, row.query),
    to: row.to,
    updated: outcome.updated > 0,
    flattened: outcome.flattened,
    moved: movedSample(outcome),
  })
  revalidateStudio(slug)
  return ok(
    `${outcome.updated ? 'Redirect updated' : 'Redirect added'}${outcome.flattened ? ` (${plural(outcome.flattened, 'chain', 'chains')} shortened)` : ''}`,
  )
}

export type RedirectPreview = {
  /** Rows the import would add or change (old → new, after chains are shortened). */
  rows: { line?: number; from: string; to: string; status: 'new' | 'updated' | 'unchanged' }[]
  errors: { line: number; text: string; error: string }[]
  /** How many redirects "Add" would add or change. */
  changes: number
  summary: string
}

const importSchema = z.object({
  // Not trimmed: the import numbers the lines as pasted.
  lines: z
    .string()
    .max(400_000, 'That list is too long')
    .refine((s) => s.trim() !== '', 'Paste at least one address'),
  intent: z.enum(['preview', 'add']),
})

/**
 * "Import list": the Search Console 404 export (full URLs, one per line; a header line and its date column are
 * ignored) or `old new` pairs. One-column lines go to the form's new address. Preview = a dry run (the parsed rows
 * and every line's problem); Add saves the same.
 */
export async function importRedirectsAction(
  slug: string,
  _prev: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.publish')
  if (error) return fail(error)
  const target = targetOf(fd)
  const parsed = importSchema.safeParse({
    lines: fd.get('lines') ?? '',
    intent: fd.get('intent') ?? 'preview',
  })
  if (!parsed.success) return fromZod(parsed.error, { english: true })
  const dryRun = parsed.data.intent === 'preview'
  const tenantId = ctx.tenant.id
  const outcome = await withTenant(tenantId, async (tx) => {
    const addresses = await addressesOf(tx, ctx.tenant.slug)
    const fallback = target.to.trim() ? normalizeRedirectTarget(target.to, { addresses }) : null
    if (fallback && 'error' in fallback) return { problem: { field: target.field, error: fallback.error } }
    const { rows, errors } = parseRedirectLines(parsed.data.lines, {
      addresses,
      defaultTarget: fallback?.to ?? '',
    })
    if (errors[0]?.line === 0) return { problem: { field: 'lines', error: errors[0].error } }
    const saved = await saveSiteRedirects(tx, tenantId, rows, {
      userId: ctx.user.id,
      source: 'import',
      dryRun,
    })
    return { saved, errors }
  })
  if (outcome.problem) return fail(outcome.problem.error, { [outcome.problem.field]: outcome.problem.error })
  const { saved, errors } = outcome
  const skipped = errors.length + saved.skipped.length
  const changes = saved.added + saved.updated
  if (dryRun) {
    const preview: RedirectPreview = {
      rows: saved.saved.slice(0, 200).map((s) => ({
        line: s.line,
        from: shown(s.from, s.query),
        to: s.to,
        status: s.status,
      })),
      errors: [
        ...errors,
        ...saved.skipped.map((s) => ({ line: s.line ?? 0, text: s.from, error: s.reason })),
      ].sort((a, b) => a.line - b.line),
      changes,
      summary: [
        `${plural(changes, 'redirect', 'redirects')} to add or change`,
        saved.unchanged ? `${saved.unchanged} already there` : null,
        saved.flattened ? `${plural(saved.flattened, 'chain', 'chains')} shortened` : null,
        skipped ? `${plural(skipped, 'line', 'lines')} skipped` : null,
      ]
        .filter(Boolean)
        .join(', '),
    }
    return ok(undefined, { preview })
  }
  if (!changes)
    return fail(
      errors.length || saved.skipped.length
        ? 'Nothing to add — check the lines.'
        : 'Those redirects are already there.',
    )
  await auditAs(ctx, 'site.redirects.imported', undefined, {
    added: saved.added,
    updated: saved.updated,
    flattened: saved.flattened,
    skipped,
    sample: saved.saved.slice(0, 20).map((s) => ({ from: shown(s.from, s.query), to: s.to })),
    moved: movedSample(saved),
  })
  revalidateStudio(slug)
  return ok(summary(saved, skipped))
}

export async function deleteRedirectAction(slug: string, id: string): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.publish')
  if (error) return fail(error)
  const parsed = z.uuid().safeParse(id)
  if (!parsed.success) return fail('errors.notFound')
  const [row] = await withTenant(ctx.tenant.id, (tx) => deleteSiteRedirects(tx, [parsed.data]))
  if (!row) return fail('errors.notFound')
  await auditAs(ctx, 'site.redirect.deleted', row.id, {
    from: shown(row.fromPath, row.fromQuery),
    to: row.toPath,
  })
  revalidateStudio(slug)
  return ok('Redirect deleted')
}

/** "Clear all". */
export async function clearRedirectsAction(slug: string): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.publish')
  if (error) return fail(error)
  const count = await withTenant(ctx.tenant.id, (tx) => deleteAllSiteRedirects(tx, ctx.tenant.id))
  await auditAs(ctx, 'site.redirects.cleared', undefined, { count })
  revalidateStudio(slug)
  return ok(count ? `${plural(count, 'redirect', 'redirects')} deleted` : 'No redirects to delete')
}
