// Server-side site preflight shared by the editor and the website overview's "Publish all".
import type { Tx } from '@spa/db'
import {
  editingTheme,
  getEditablePage,
  getPublishedPage,
  getSite,
  globalSectionsFor,
  listPages,
  listSavedSections,
  type PageSummary,
  preflight,
  preflightErrors,
} from '@spa/services'
import { z } from 'zod'
import { preflightColors } from '@/components/site/editor/colors'
import { normalizeTheme } from '@/components/site/theme'

/** The editor's optimistic-concurrency stamp as it comes back from the client (services EditStamp). */
export const editStampSchema = z.object({
  page: z.string().min(1).max(200),
  site: z.string().min(1).max(100),
})

/**
 * Server-side preflight errors for `data` (plus the global sections it shows, whose content goes live with
 * it), as one message — or null when nothing blocks publishing. Warnings never block.
 */
export async function publishErrors(
  tx: Tx,
  tenantId: string,
  data: Record<string, unknown>,
  { currentSlug = '', verb = 'publishing' }: { currentSlug?: string; verb?: string } = {},
): Promise<string | null> {
  const [site, pages, sections, globals] = await Promise.all([
    getSite(tx, tenantId),
    listPages(tx, tenantId),
    listSavedSections(tx, tenantId),
    globalSectionsFor(tx, tenantId, data),
  ])
  const context = {
    colors: preflightColors(normalizeTheme(site ? editingTheme(site) : undefined)),
    currentSlug,
    pages: pages.map((p) => ({ slug: p.slug, visible: p.visible, published: Boolean(p.publishedAt) })),
    globalIds: new Set(sections.filter((s) => s.isGlobal).map((s) => s.id)),
  }
  const errors = [
    ...preflightErrors(preflight(data, context)),
    ...preflightErrors(preflight({ root: { props: {} }, content: Object.values(globals) }, context)).map(
      (i) => ({ ...i, message: `${i.message} (in a global section)` }),
    ),
  ]
  if (!errors.length) return null
  return `Fix ${errors.length === 1 ? 'the error' : `${errors.length} errors`} before ${verb}: ${errors[0]!.message}`
}

/**
 * With a draft theme waiting (Ask AI / Claude MCP), any publish takes it live on EVERY page: the pages' contrast
 * under it (warnings, as in the publish dialog — they don't block), as "<page>: <message>" lines. Live content is
 * checked; with `drafts` (Publish site) a page's draft instead, since it goes live too. `skip` = checked elsewhere.
 */
export async function themeDraftWarnings(
  tx: Tx,
  tenantId: string,
  { skip = () => false, drafts = false }: { skip?: (p: PageSummary) => boolean; drafts?: boolean } = {},
): Promise<string[]> {
  const site = await getSite(tx, tenantId)
  if (!site?.themeDraft) return []
  const pages = await listPages(tx, tenantId)
  const context = {
    colors: preflightColors(normalizeTheme(site.themeDraft)),
    pages: pages.map((p) => ({ slug: p.slug, visible: p.visible, published: Boolean(p.publishedAt) })),
    currentSlug: '',
  }
  const out: string[] = []
  for (const p of pages) {
    if (skip(p)) continue
    const data =
      drafts && p.hasDraft
        ? (await getEditablePage(tx, tenantId, p.id))?.data
        : p.publishedAt && p.visible
          ? (await getPublishedPage(tx, tenantId, p.slug))?.data
          : undefined
    if (!data) continue
    for (const i of preflight(data, { ...context, currentSlug: p.slug }))
      if (i.rule === 'contrast') out.push(`${p.title.en || 'Home'}: ${i.message}`)
  }
  return out
}

/** Preflight for every page with unpublished changes; the first blocking message, or null. */
export async function publishAllErrors(tx: Tx, tenantId: string): Promise<string | null> {
  for (const p of await listPages(tx, tenantId)) {
    if (!p.hasDraft) continue
    const editable = await getEditablePage(tx, tenantId, p.id)
    if (!editable) continue
    const blocked = await publishErrors(tx, tenantId, editable.data as Record<string, unknown>, {
      currentSlug: p.slug,
    })
    if (blocked) return `${p.title.en || 'Home'}: ${blocked}`
  }
  return null
}
