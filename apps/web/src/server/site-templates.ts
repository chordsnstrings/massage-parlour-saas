import { platformDb } from '@spa/db'
import { listStudioTemplates, type SiteTemplate, studioToSiteTemplate } from '@spa/services'
import { cache } from 'react'
import { isTemplateKey, TEMPLATE_KEYS, TEMPLATES } from '@/components/site/templates'

export type CatalogTemplate = SiteTemplate & { feel: string; source: 'builtin' | 'studio' }

/**
 * The template catalogue spas choose from: the 8 built-ins plus active template-studio rows (PLAN §11.2).
 * Studio rows override a built-in with the same key. `site_templates` is a platform table (invisible to the
 * tenant role), so the catalogue is read with the platform connection — it holds no tenant data.
 */
export const templateCatalog = cache(async (): Promise<CatalogTemplate[]> => {
  const rows = await listStudioTemplates(platformDb(), { activeOnly: true })
  const studio = new Map(rows.map((r) => [r.key, r]))
  const out: CatalogTemplate[] = TEMPLATE_KEYS.map((key) => {
    const row = studio.get(key)
    return row
      ? { ...studioToSiteTemplate(row), feel: row.description ?? TEMPLATES[key].feel, source: 'studio' }
      : { ...TEMPLATES[key], source: 'builtin' }
  })
  for (const row of rows) {
    if (!isTemplateKey(row.key))
      out.push({ ...studioToSiteTemplate(row), feel: row.description ?? '', source: 'studio' })
  }
  return out
})

export async function resolveTemplate(key: string | undefined | null) {
  if (!key) return null
  return (await templateCatalog()).find((t) => t.key === key) ?? null
}
