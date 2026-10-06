// Site templates beyond the built-ins (docs/PLAN.md §11.2): template studio rows (platform table), sanitising a
// spa's site into a template, JSON export/import, AI copy slots and a structural check for preset trees.
import { type Db, pageVersions, sitePages, siteTemplates, type Tx } from '@spa/db'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { DomainError } from './errors'
import type { PuckNode } from './site-kit/tree'
import {
  getEditablePage,
  getSite,
  listPages,
  PAGE_SLUG,
  type PageData,
  type SiteTemplate,
  type SiteText,
  saveDraft,
} from './sites'

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

/* ------------------------------------------------------------------ AI copy slots */

/**
 * Template nodes that hold the spa's own words carry a copy slot at the end of their id (`…--hero`). The AI
 * site writer fills these; everything else (layout, smart blocks) is left alone.
 */
export const COPY_SLOT = /--((?:hero|about|faq|cta)|usp-[1-3]-(?:title|text))$/
export const slotOf = (id: unknown) => (typeof id === 'string' ? (COPY_SLOT.exec(id)?.[1] ?? null) : null)

export type SiteCopy = {
  hero: { headline: SiteText; sub: SiteText }
  about: SiteText
  usps: { title: SiteText; text: SiteText }[]
  faqs: { q: SiteText; a: SiteText }[]
  cta: { title: SiteText; text: SiteText }
}

function fillNode(node: PuckNode, copy: SiteCopy): PuckNode | null {
  const slot = slotOf(node.props.id)
  if (!slot) return null
  const p = node.props
  if (slot === 'hero' && node.type === 'Hero')
    return { ...node, props: { ...p, title: copy.hero.headline, subtitle: copy.hero.sub } }
  if (slot === 'about' && node.type === 'RichText') return { ...node, props: { ...p, text: copy.about } }
  if (slot === 'faq' && node.type === 'FAQ' && copy.faqs.length)
    return { ...node, props: { ...p, items: copy.faqs.map((f) => ({ q: f.q, a: f.a })) } }
  if (slot === 'cta' && node.type === 'BookingCTA')
    return { ...node, props: { ...p, title: copy.cta.title, text: copy.cta.text } }
  const usp = /^usp-([1-3])-(title|text)$/.exec(slot)
  const item = usp ? copy.usps[Number(usp[1]) - 1] : undefined
  if (usp && item) {
    if (usp[2] === 'title' && node.type === 'Heading') return { ...node, props: { ...p, text: item.title } }
    if (usp[2] === 'text' && node.type === 'RichText') return { ...node, props: { ...p, text: item.text } }
  }
  return null
}

/** One page's data with AI copy written into its slotted nodes (input untouched), and how many nodes changed. */
export function fillPageCopy(data: PageData, copy: SiteCopy): { data: PageData; filled: number } {
  let filled = 0
  const out = mapNodes(structuredClone(data), (node) => {
    const next = fillNode(node, copy)
    if (!next) return node
    filled++
    return next
  })
  return { data: out, filled }
}

/** The template with AI copy written into its slotted nodes (input untouched). Returns how many nodes changed. */
export function applySiteCopy(
  template: SiteTemplate,
  copy: SiteCopy,
): { template: SiteTemplate; filled: number } {
  let filled = 0
  const pages = template.pages.map((p) => {
    const r = fillPageCopy(p.data, copy)
    filled += r.filled
    return { ...p, data: r.data }
  })
  return { template: { ...template, pages }, filled }
}

/** Whether any of these pages has AI copy slots (sites made before slots existed have none). */
export const hasCopySlots = (pages: { data: PageData }[]) =>
  pages.some((p) => listNodes(p.data).some((n) => slotOf(n.props.id) !== null))

/**
 * Writes AI copy into the spa's own pages, in place: only slotted text changes, so layout, images, added
 * sections and the theme stay. Saved as drafts (never published). Returns how many nodes / pages changed.
 */
export async function applySiteCopyToPages(
  tx: Tx,
  tenantId: string,
  copy: SiteCopy,
  userId?: string,
): Promise<{ filled: number; pages: number }> {
  let filled = 0
  let pages = 0
  for (const p of await listPages(tx, tenantId)) {
    const current = await getEditablePage(tx, tenantId, p.id)
    if (!current) continue
    const r = fillPageCopy(current.data, copy)
    if (!r.filled) continue
    await saveDraft(tx, { tenantId, pageId: p.id, data: r.data, userId })
    filled += r.filled
    pages++
  }
  return { filled, pages }
}

const EMPTY: SiteText = { en: '' }

/** The copy currently in a page set's slots (first occurrence wins) — the "before" side of the AI preview. */
export function extractSiteCopy(pages: { data: PageData }[]): SiteCopy {
  const copy: SiteCopy = {
    hero: { headline: EMPTY, sub: EMPTY },
    about: EMPTY,
    usps: [0, 1, 2].map(() => ({ title: EMPTY, text: EMPTY })),
    faqs: [],
    cta: { title: EMPTY, text: EMPTY },
  }
  const seen = new Set<string>()
  const text = (v: unknown): SiteText => (v && typeof v === 'object' && 'en' in v ? (v as SiteText) : EMPTY)
  for (const p of pages) {
    for (const node of listNodes(p.data)) {
      const slot = slotOf(node.props.id)
      if (!slot || seen.has(slot)) continue
      seen.add(slot)
      const pr = node.props
      if (slot === 'hero') copy.hero = { headline: text(pr.title), sub: text(pr.subtitle) }
      else if (slot === 'about') copy.about = text(pr.text)
      else if (slot === 'faq')
        copy.faqs = Array.isArray(pr.items)
          ? (pr.items as { q?: unknown; a?: unknown }[]).map((i) => ({ q: text(i.q), a: text(i.a) }))
          : []
      else if (slot === 'cta') copy.cta = { title: text(pr.title), text: text(pr.text) }
      else {
        const [, n, part] = /^usp-([1-3])-(title|text)$/.exec(slot) ?? []
        const item = copy.usps[Number(n) - 1]
        if (item && part === 'title') item.title = text(pr.text)
        if (item && part === 'text') item.text = text(pr.text)
      }
    }
  }
  return copy
}

/* ------------------------------------------------------------------ Sanitising a spa's site into a template */

const IMAGE_KEYS = new Set(['src', 'image', 'bgImage'])

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
    if (IMAGE_KEYS.has(k) && typeof v === 'string') out[k] = ''
    // Links to other sites (the spa's Instagram, booking partners…) are the spa's own, not the template's.
    else if (k === 'target' && obj.action === 'url') out[k] = ''
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
  patch: { name?: string; description?: string | null; sort?: number; active?: boolean },
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
