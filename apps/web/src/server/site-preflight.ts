// Server-side site preflight shared by the editor and the website overview's "Publish all".
import type { Tx } from '@spa/db'
import {
  getEditablePage,
  getSite,
  globalSectionsFor,
  listPages,
  listSavedSections,
  preflight,
  preflightErrors,
} from '@spa/services'
import { preflightColors } from '@/components/site/editor/colors'
import { normalizeTheme } from '@/components/site/theme'

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
    colors: preflightColors(normalizeTheme(site?.theme)),
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
