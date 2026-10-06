import { platformDb } from '@spa/db'
import {
  type BlockSpec,
  checkNodes,
  exportStudioTemplate,
  getStudioTemplate,
  TEMPLATE_FORMAT,
  type TemplateExport,
  type TemplatePage,
} from '@spa/services'
import { siteConfig } from '@/components/site/config'
import { isTemplateKey, TEMPLATES } from '@/components/site/templates'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A studio row (by id) or a built-in template (by key), in export shape. Super-admin code paths only. */
export async function loadAdminTemplate(id: string): Promise<TemplateExport | null> {
  if (UUID.test(id)) {
    const row = await getStudioTemplate(platformDb(), { id })
    return row ? exportStudioTemplate(row) : null
  }
  if (!isTemplateKey(id)) return null
  const t = TEMPLATES[id]
  return {
    format: TEMPLATE_FORMAT,
    version: 1,
    key: t.key,
    name: t.name,
    description: t.feel,
    theme: t.theme,
    pages: t.pages as TemplatePage[],
  }
}

/**
 * The block catalogue as a structural spec. `requireProps` also demands every prop a block has a default for
 * (imported files); a spa's live pages are only checked for known blocks and slot shape, since they already
 * render on its site.
 */
function blockSpec(requireProps: boolean): BlockSpec {
  return Object.fromEntries(
    Object.entries(siteConfig.components).map(([name, c]) => [
      name,
      {
        required: requireProps ? Object.keys(c.defaultProps ?? {}) : [],
        slots: Object.entries(c.fields ?? {})
          .filter(([, f]) => (f as { type: string }).type === 'slot')
          .map(([k]) => k),
      },
    ]),
  )
}

/** First problem in a template's pages against the block catalogue, or null when every page is valid. */
export function templateProblem(pages: TemplatePage[], opts: { requireProps: boolean }): string | null {
  const spec = blockSpec(opts.requireProps)
  for (const p of pages) {
    const content = (p.data as { content?: unknown }).content
    const problems = checkNodes(Array.isArray(content) ? content : [], spec)
    if (problems.length) return `Page "${p.slug || 'home'}": ${problems[0]}`
  }
  return null
}

/** Neutral stand-ins for blocks that hold a spa's own customers' words (sanitising a site into a template). */
export const templateSamples = (): Record<string, Record<string, unknown>> => ({
  Testimonials: { items: siteConfig.components.Testimonials?.defaultProps?.items ?? [] },
})
