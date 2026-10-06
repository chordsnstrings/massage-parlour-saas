import { platformDb } from '@spa/db'
import {
  exportStudioTemplate,
  getStudioTemplate,
  TEMPLATE_FORMAT,
  type TemplateExport,
  type TemplatePage,
} from '@spa/services'
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
