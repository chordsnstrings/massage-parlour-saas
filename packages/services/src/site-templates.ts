// Site templates beyond the built-ins (docs/PLAN.md §11.2): template studio rows (platform table), sanitising a
// spa's site into a template, JSON export/import, copy slots and a structural check for preset trees.
import { type Db, pageVersions, sitePages, siteTemplates, type Tx } from '@spa/db'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { DomainError } from './errors'
import { isImageValue } from './site-kit/image'
import type { PuckNode } from './site-kit/tree'
import { getSite, PAGE_SLUG, type PageData, type SiteTemplate, type SiteText } from './sites'

export type StudioTemplateRow = typeof siteTemplates.$inferSelect
export type TemplatePage = SiteTemplate['pages'][number]

/** Puck component node: `{ type, props: { id, …, slotName: Node[] } }`. */

const isNode = (v: unknown): v is PuckNode =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as PuckNode).type === 'string' &&
  typeof (v as PuckNode).props === 'object' &&
  (v as PuckNode).props !== null
const isNodeList = (v: unknown): v is PuckNode[] => Array.isArray(v) && v.length > 0 && v.every(isNode)

/** Deep-maps every component node of a page (top-level content and nested slots), children first. */
export function mapNodes(data: PageData, fn: (node: PuckNode) => PuckNode): PageData {
  const visit = (node: PuckNode): PuckNode => {
    const props: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node.props)) props[k] = isNodeList(v) ? v.map(visit) : v
    return fn({ type: node.type, props })
  }
  const content = Array.isArray(data.content) ? (data.content as unknown[]).filter(isNode).map(visit) : []
  return { ...data, content }
}

/** Every component node of a page, depth-first. */
export function listNodes(data: PageData): PuckNode[] {
  const out: PuckNode[] = []
  mapNodes(data, (n) => {
    out.push(n)
    return n
  })
  return out
}

/* ------------------------------------------------------------------ Copy slots */

/**
 * Template nodes that hold the spa's own words carry a copy slot at the end of their id (`…--hero`), kept when a
 * site is sanitised into a template.
 */
export const COPY_SLOT = /--((?:hero|about|faq|cta)|usp-[1-3]-(?:title|text))$/
export const slotOf = (id: unknown) => (typeof id === 'string' ? (COPY_SLOT.exec(id)?.[1] ?? null) : null)

/* ------------------------------------------------------------------ Sanitising a spa's site into a template */

const IMAGE_KEYS = new Set(['src', 'image', 'bgImage', 'poster'])

/** Blocks holding the spa's own customers' words: reset to neutral sample content, never copied across spas. */
const CUSTOMER_VOICE: Record<string, string[]> = { Testimonials: ['items'] }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const URL_TEXT = /\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi
const PHONE_LIKE = /\+?\d[\d\s().-]{6,}\d/g

/** Removes the spa's name (whole words → `{name}`), email addresses, links and phone numbers from copy. */
function scrubText(value: string, name: RegExp | null): string {
  let out = value
    .replace(EMAIL, '')
    .replace(URL_TEXT, '')
    // 9+ digits: a phone number (UAE landlines have 9), not a year range or a price.
    .replace(PHONE_LIKE, (m) => ((m.match(/\d/g)?.length ?? 0) >= 9 ? '' : m))
  if (name) out = out.replace(name, '{name}')
  return out === value ? value : out.replace(/[ \t]{2,}/g, ' ').trim()
}

const isBilingual = (v: object): v is Record<string, unknown> & SiteText =>
  typeof (v as SiteText).en === 'string' &&
  Object.entries(v).every(
    ([k, x]) => (k === 'en' || k === 'ar') && (typeof x === 'string' || x === undefined),
  )

/**
 * Only bilingual copy (`{ en, ar }`) is rewritten: block types, ids, enum props, colours and slugs are left
 * alone. Uploaded images and outside link targets are the spa's own and are removed.
 */
function scrub(value: unknown, name: RegExp | null): unknown {
  if (Array.isArray(value)) return value.map((v) => scrub(v, name))
  if (!value || typeof value !== 'object') return value
  if (isBilingual(value)) {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(value)) if (typeof v === 'string') out[k] = scrubText(v, name)
    return out
  }
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (IMAGE_KEYS.has(k) && (typeof v === 'string' || isImageValue(v))) out[k] = ''
    // Links to other sites (the spa's Instagram, booking partners…) are the spa's own, not the template's.
    else if (k === 'target' && obj.action === 'url') out[k] = ''
    // F15 Video block: the spa's own YouTube / Vimeo link or uploaded clip.
    else if (k === 'url' && typeof v === 'string') out[k] = ''
    else out[k] = scrub(v, name)
  }
  return out
}

/**
 * Makes a spa's pages reusable by any spa: fresh ids (copy slots kept), the spa's name → `{name}`, contact
 * details, uploaded images and external link targets removed, and customer quotes replaced by `samples`
 * (block type → neutral props, e.g. the Testimonials block's defaults). Smart blocks keep reading each spa's
 * own live data.
 */
export function sanitizeTemplatePages(
  pages: TemplatePage[],
  opts: { key: string; tenantName?: string; samples?: Record<string, Record<string, unknown>> },
): TemplatePage[] {
  const raw = opts.tenantName?.trim() ?? ''
  const name =
    raw.length >= 3 ? new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(raw)}(?![\\p{L}\\p{N}])`, 'giu') : null
  let n = 0
  return pages.map((p) => {
    const data = scrub(p.data, name) as PageData
    return {
      slug: p.slug,
      title: scrub(p.title, name) as SiteText,
      data: mapNodes(data, (node) => {
        const slot = slotOf(node.props.id)
        const props: Record<string, unknown> = { ...node.props }
        for (const key of CUSTOMER_VOICE[node.type] ?? [])
          props[key] = structuredClone(opts.samples?.[node.type]?.[key] ?? [])
        props.id = `${opts.key}-${node.type.toLowerCase()}-${++n}${slot ? `--${slot}` : ''}`
        return { type: node.type, props }
      }),
    }
  })
}

/** Theme + live (published, visible) pages of a spa, ready to be sanitised into a template. */
export async function snapshotSite(
  tx: Tx,
  tenantId: string,
): Promise<{ theme: Record<string, unknown>; pages: TemplatePage[] }> {
  const site = await getSite(tx, tenantId)
  if (!site) throw new DomainError('This spa has no website yet', 'not_found')
  const pages = await tx
    .select()
    .from(sitePages)
    .where(and(eq(sitePages.tenantId, tenantId), eq(sitePages.visible, true)))
    .orderBy(asc(sitePages.sort), asc(sitePages.createdAt))
  const versions = pages.length
    ? await tx
        .select({ pageId: pageVersions.pageId, data: pageVersions.data })
        .from(pageVersions)
        .where(
          and(
            eq(pageVersions.status, 'published'),
            inArray(
              pageVersions.pageId,
              pages.map((p) => p.id),
            ),
          ),
        )
        .orderBy(desc(pageVersions.createdAt))
    : []
  const out: TemplatePage[] = []
  for (const p of pages) {
    const live = versions.find((v) => v.pageId === p.id)
    if (live) out.push({ slug: p.slug, title: p.title, data: live.data })
  }
  if (!out.some((p) => p.slug === ''))
    throw new DomainError('Publish the home page before saving this site as a template')
  return { theme: site.theme, pages: out }
}

/* ------------------------------------------------------------------ Studio rows */

export const templateKeyFrom = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'template'

export const TEMPLATE_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const studioToSiteTemplate = (
  row: Pick<StudioTemplateRow, 'key' | 'name' | 'theme' | 'pages'>,
): SiteTemplate => ({
  key: row.key,
  name: row.name,
  theme: row.theme as SiteTemplate['theme'],
  pages: row.pages as unknown as TemplatePage[],
})

export async function listStudioTemplates(db: Db, opts: { activeOnly?: boolean } = {}) {
  return db
    .select()
    .from(siteTemplates)
    .where(opts.activeOnly ? eq(siteTemplates.active, true) : undefined)
    .orderBy(asc(siteTemplates.sort), asc(siteTemplates.name))
}

export async function getStudioTemplate(db: Db, by: { id?: string; key?: string }) {
  if (!by.id && !by.key) return null
  const [row] = await db
    .select()
    .from(siteTemplates)
    .where(by.id ? eq(siteTemplates.id, by.id) : eq(siteTemplates.key, by.key!))
    .limit(1)
  return row ?? null
}

export type StudioTemplateInput = {
  key: string
  name: string
  description?: string | null
  theme: Record<string, unknown>
  pages: TemplatePage[]
  sort?: number
  active?: boolean
  createdBy?: string | null
}

/**
 * Creates a studio template, or replaces the one with the same key when `replace` is set (import). Saved
 * inactive unless `active` is set.
 */
export async function saveStudioTemplate(
  db: Db,
  input: StudioTemplateInput,
  opts: { replace?: boolean } = {},
) {
  if (!TEMPLATE_KEY.test(input.key))
    throw new DomainError('Use lowercase letters, numbers and dashes for the key')
  const values = {
    key: input.key,
    name: input.name,
    description: input.description ?? null,
    theme: input.theme,
    pages: input.pages as unknown as Record<string, unknown>[],
    sort: input.sort ?? 0,
    // Spas only see it once a platform admin has reviewed it and switched it on.
    active: input.active ?? false,
    createdBy: input.createdBy ?? null,
  }
  const query = db.insert(siteTemplates).values(values)
  const [row] = opts.replace
    ? await query
        .onConflictDoUpdate({
          target: siteTemplates.key,
          set: {
            name: values.name,
            description: values.description,
            theme: values.theme,
            pages: values.pages,
            active: values.active,
          },
        })
        .returning()
    : await query.onConflictDoNothing().returning()
  if (!row) throw new DomainError(`A template with the key "${input.key}" already exists`)
  return row
}

export async function updateStudioTemplate(
  db: Db,
  id: string,
  patch: {
    name?: string
    description?: string | null
    sort?: number
    active?: boolean
    pages?: TemplatePage[]
  },
) {
  const [row] = await db.update(siteTemplates).set(patch).where(eq(siteTemplates.id, id)).returning()
  if (!row) throw new DomainError('Template not found', 'not_found')
  return row
}

export async function deleteStudioTemplate(db: Db, id: string) {
  const [row] = await db
    .delete(siteTemplates)
    .where(eq(siteTemplates.id, id))
    .returning({ id: siteTemplates.id })
  if (!row) throw new DomainError('Template not found', 'not_found')
}

/* ------------------------------------------------------------------ Export / import */

export const TEMPLATE_FORMAT = 'spamanagement.site-template'
export const MAX_TEMPLATE_BYTES = 2 * 1024 * 1024

export type TemplateExport = {
  format: typeof TEMPLATE_FORMAT
  version: 1
  key: string
  name: string
  description: string | null
  theme: Record<string, unknown>
  pages: TemplatePage[]
}

export const exportStudioTemplate = (row: StudioTemplateRow): TemplateExport => ({
  format: TEMPLATE_FORMAT,
  version: 1,
  key: row.key,
  name: row.name,
  description: row.description,
  theme: row.theme,
  pages: row.pages as unknown as TemplatePage[],
})

const isText = (v: unknown): v is SiteText =>
  typeof v === 'object' && v !== null && typeof (v as SiteText).en === 'string'

/** Validates an uploaded template file. Theme tokens are normalised by the renderer, so only shape is checked here. */
export function parseTemplateJson(
  raw: string,
): { ok: true; template: TemplateExport } | { ok: false; error: string } {
  if (raw.length > MAX_TEMPLATE_BYTES) return { ok: false, error: 'This file is too large (2 MB max).' }
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'This is not a JSON file.' }
  }
  const t = v as Partial<TemplateExport>
  if (!t || typeof t !== 'object' || t.format !== TEMPLATE_FORMAT)
    return { ok: false, error: 'This is not a site template export.' }
  if (typeof t.key !== 'string' || !TEMPLATE_KEY.test(t.key))
    return { ok: false, error: 'The template key is invalid.' }
  if (typeof t.name !== 'string' || !t.name.trim() || t.name.length > 80)
    return { ok: false, error: 'The template needs a name.' }
  if (!t.theme || typeof t.theme !== 'object' || Array.isArray(t.theme))
    return { ok: false, error: 'The theme is missing.' }
  if (!Array.isArray(t.pages) || !t.pages.length || t.pages.length > 20)
    return { ok: false, error: 'The template needs 1–20 pages.' }
  const slugs = new Set<string>()
  for (const p of t.pages) {
    const data = p?.data as { root?: unknown; content?: unknown } | undefined
    if (typeof p?.slug !== 'string' || !PAGE_SLUG.test(p.slug) || slugs.has(p.slug))
      return { ok: false, error: `Page "${String(p?.slug)}" has an invalid or duplicate address.` }
    slugs.add(p.slug)
    if (!isText(p.title)) return { ok: false, error: `Page "${p.slug || 'home'}" needs a title.` }
    if (!data || typeof data.root !== 'object' || !Array.isArray(data.content))
      return { ok: false, error: `Page "${p.slug || 'home'}" is not valid page data.` }
  }
  if (!slugs.has('')) return { ok: false, error: 'The template needs a home page.' }
  return {
    ok: true,
    template: {
      format: TEMPLATE_FORMAT,
      version: 1,
      key: t.key,
      name: t.name.trim(),
      description: typeof t.description === 'string' ? t.description.slice(0, 300) : null,
      theme: t.theme as Record<string, unknown>,
      pages: t.pages.map((p) => ({ slug: p.slug, title: p.title, data: p.data })),
    },
  }
}

/* ------------------------------------------------------------------ Structural check for presets */

/** What a block needs: its required prop names and which props are nested slots. */
export type BlockSpec = Record<string, { required: string[]; slots: string[] }>

/**
 * Checks a preset / page tree against the block catalogue: every node's type exists, its required props are
 * present and slot props hold node lists. Returns readable problems (empty = valid).
 */
export function checkNodes(nodes: unknown[], spec: BlockSpec, path = 'content'): string[] {
  const problems: string[] = []
  nodes.forEach((raw, i) => {
    const at = `${path}[${i}]`
    if (!isNode(raw)) {
      problems.push(`${at}: not a block`)
      return
    }
    const block = spec[raw.type]
    if (!block) {
      problems.push(`${at}: unknown block "${raw.type}"`)
      return
    }
    for (const key of block.required) {
      if (raw.props[key] === undefined) problems.push(`${at} ${raw.type}: missing "${key}"`)
    }
    for (const key of block.slots) {
      const children = raw.props[key]
      if (children === undefined) continue
      if (!Array.isArray(children)) problems.push(`${at} ${raw.type}.${key}: slot must be a list`)
      else problems.push(...checkNodes(children, spec, `${at}.${key}`))
    }
  })
  return problems
}
