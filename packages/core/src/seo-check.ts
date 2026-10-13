// R30 (owner 2026-10-13): the weekly search check of a spa's LIVE site. What search engines see on each published
// page — its title and search description (block pages: the page's root props; HTML designs: the spa's page texts
// `title` / `meta-description` over the design's own, as the live page renders them), image alt texts and whether
// sitemap.xml lists the page. Pure; linear in the size of the pages (one pass per design, no backtracking regexes).
import { htmlContentParts } from './html-content'
import { attributesOf, listHtmlDesignTexts, tagEnd } from './html-design'

export const SEO_TITLE_MAX = 60
export const SEO_DESCRIPTION_MIN = 50
export const SEO_DESCRIPTION_MAX = 160
/** At most this many findings are kept per check (the counts cover all of them). */
export const MAX_SEO_FINDINGS = 300

export const SEO_FINDING_CODES = [
  'title_missing',
  'title_long',
  'title_duplicate',
  'description_missing',
  'description_short',
  'description_long',
  'description_duplicate',
  'image_alt_missing',
  'not_in_sitemap',
] as const
export type SeoFindingCode = (typeof SEO_FINDING_CODES)[number]
export type SeoSeverity = 'high' | 'medium'
export type SeoLocale = 'en' | 'ar'

/** What "Draft fixes" (Write texts, search scope) can write: titles and descriptions. */
export const seoFixable = (code: string) => code.startsWith('title_') || code.startsWith('description_')

/** Missing things are high; length, duplicates and alt texts medium. */
export const seoSeverity = (code: SeoFindingCode): SeoSeverity =>
  code === 'title_missing' || code === 'description_missing' || code === 'not_in_sitemap' ? 'high' : 'medium'

export type SeoFinding = {
  code: SeoFindingCode
  severity: SeoSeverity
  /** The page's path on the site: '/' (home) or '/{slug}'; Arabic is the same page with `?lang=ar`. */
  path: string
  locale: SeoLocale
  /** Console English. */
  detail: string
}
export type SeoCounts = { high: number; medium: number }

export type SeoCheckPage = {
  /** Page slug ('' = home). */
  slug: string
  /** The page's live (published) Puck data. */
  data: unknown
  /** An HTML-design page: its design source (the page JSON only references the file); null = the file is missing. */
  html?: string | null
}
export type SeoCheckInput = {
  spaName: string
  /** The site has an Arabic version (`?lang=ar` of every page). */
  arabic: boolean
  pages: SeoCheckPage[]
  /** Page slugs sitemap.xml lists ('' = home). */
  sitemap: readonly string[]
}

type Obj = Record<string, unknown>
type Node = { type?: unknown; props?: Obj }
/** A page's value per language; ar '' = the Arabic page falls back to the English one. */
type Pair = { en: string; ar: string }

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')
const chars = (s: string) => {
  let n = 0
  for (const _ of s) n++
  return n
}
const pathOf = (slug: string) => (slug ? `/${slug}` : '/')

/** A bilingual prop as the public site reads it (`tr`): `{name}` = the spa's name. */
function biPair(v: unknown, spaName: string): Pair {
  const fill = (s: unknown) => clean(clean(s).replaceAll('{name}', spaName))
  if (typeof v === 'string') return { en: fill(v), ar: '' }
  return isObj(v) ? { en: fill(v.en), ar: fill(v.ar) } : { en: '', ar: '' }
}

const designNode = (data: unknown): Node | undefined => {
  const content = (data as { content?: unknown } | null)?.content
  return Array.isArray(content)
    ? (content as Node[]).find((n) => isObj(n) && n.type === 'HtmlDesign' && isObj(n.props))
    : undefined
}

/**
 * Title + description of one live page per language, as the public site renders them. Block pages: the root
 * props. HTML designs: the spa's page text (same src guard as the render) over the design's own `<title>` / meta
 * description when the design is the live document itself (Phone fixes off), else over the page's root props
 * (a framed design: the page's metadata); `{{spa_name}}` filled.
 */
function headOf(page: SeoCheckPage, spaName: string): { title: Pair; description: Pair } {
  const root = (page.data as { root?: { props?: Obj } } | null)?.root?.props ?? {}
  const rootTitle = biPair(root.title, spaName)
  const rootDescription = biPair(root.description, spaName)
  const node = designNode(page.data)
  if (!node?.props) return { title: rootTitle, description: rootDescription }
  const listed = listHtmlDesignTexts(page.html ?? '')
  const texts = htmlContentParts(node.props.content).texts
  const fill = (s: unknown) => clean(clean(s).replace(/\{\{\s*spa_name\s*\}\}/g, spaName))
  const own = (id: 'title' | 'meta-description') => {
    const design = listed.find((x) => x.id === id)
    const e = texts[id]
    const t = design && e && e.src === design.src ? e.t : undefined
    return { design, en: fill(t?.en), ar: fill(t?.ar) }
  }
  const exact = node.props.phoneFixes === false
  const title = own('title')
  const description = own('meta-description')
  if (!exact)
    return {
      title: { en: title.en || rootTitle.en, ar: title.ar || rootTitle.ar },
      description: { en: description.en || rootDescription.en, ar: description.ar || rootDescription.ar },
    }
  return {
    // The live document without a <title> of its own gets the page's (site-html route).
    title: { en: title.en || (title.design ? fill(title.design.text) : rootTitle.en), ar: title.ar },
    description: { en: description.en || fill(description.design?.text), ar: description.ar },
  }
}

const imageOf = (v: unknown) =>
  typeof v === 'string' ? v.trim() : isObj(v) && typeof v.src === 'string' ? v.src.trim() : ''
const altEmpty = (v: unknown) => !(typeof v === 'string' ? v : isObj(v) ? clean(v.en) : '').trim()

/**
 * Pictures of a block page without alt text (English; the Arabic page falls back to it): every object with a
 * shown image (`src` / `image`, or `{x}` beside an `{x}Alt`) and an empty `alt` / `{x}Alt`, in blocks, slots and
 * lists. Pictures without an alt field (backgrounds, a hero's photo) are decorative by design.
 */
function blockImagesWithoutAlt(data: unknown): number {
  let n = 0
  const visit = (v: unknown, depth: number) => {
    if (depth > 40) return
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1)
      return
    }
    if (!isObj(v)) return
    for (const [key, value] of Object.entries(v)) {
      if (key === 'alt') {
        if ((imageOf(v.src) || imageOf(v.image)) && altEmpty(value)) n++
      } else if (key.length > 3 && key.endsWith('Alt')) {
        if (imageOf(v[key.slice(0, -3)]) && altEmpty(value)) n++
      } else if (typeof value === 'object' && value !== null) visit(value, depth + 1)
    }
  }
  visit((data as { content?: unknown } | null)?.content, 0)
  return n
}

/** Elements whose content is never markup (an `<img` there is not a picture). */
const RAW_TEXT = new Set([
  'script',
  'style',
  'title',
  'textarea',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'noscript',
])
const nameChar = (c: number) =>
  (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 45 || c === 58

/**
 * `<img>` elements of a design without alt text (no `alt`, or a blank one) that aren't marked decorative
 * (`role="presentation"` / `role="none"`, `aria-hidden="true"`). One forward pass over the markup: comments and raw
 * text (scripts, styles …) are skipped, attributes are read with the design parser's own tokenizer.
 */
export function htmlImagesWithoutAlt(html: string): number {
  const len = html.length
  let n = 0
  let i = 0
  while (i < len) {
    const lt = html.indexOf('<', i)
    if (lt < 0) break
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4)
      i = close < 0 ? len : close + 3
      continue
    }
    // A tag starts with an ASCII letter (as in the HTML tokenizer): `5<10`, `</…`, `<!…` or a stray `<` is text.
    const c = html.charCodeAt(lt + 1) | 32
    if (c < 97 || c > 122) {
      i = lt + 1
      continue
    }
    let j = lt + 2
    while (j < len && nameChar(html.charCodeAt(j))) j++
    const name = html.slice(lt + 1, j).toLowerCase()
    const end = tagEnd(html, j)
    if (name === 'img') {
      const attrs = attributesOf(html, j)
      const value = (attr: string) => {
        const a = attrs.find((x) => x.name === attr)
        return a ? (a.start < 0 ? '' : html.slice(a.start, a.end).trim().toLowerCase()) : null
      }
      const role = value('role')
      const decorative = role === 'presentation' || role === 'none' || value('aria-hidden') === 'true'
      if (!decorative && !value('alt')) n++
    }
    i = end
    if (name === 'plaintext') break
    if (RAW_TEXT.has(name)) {
      const close = new RegExp(`</${name}(?=[\\t\\n\\f\\r />]|$)`, 'gi')
      close.lastIndex = end
      const m = close.exec(html)
      i = m ? m.index + 1 : len
    }
  }
  return n
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The check: findings per live page and language, in page order. English always; Arabic (when the site has it)
 * only where the Arabic page shows its own Arabic text — where it falls back to the English text, the English
 * finding covers both. Pictures and the sitemap are the same for both languages (reported once, in English).
 */
export function seoCheck(input: SeoCheckInput): { findings: SeoFinding[]; counts: SeoCounts } {
  const findings: SeoFinding[] = []
  const add = (code: SeoFindingCode, slug: string, locale: SeoLocale, detail: string) =>
    findings.push({ code, severity: seoSeverity(code), path: pathOf(slug), locale, detail })
  const pages = input.pages.map((p) => ({ page: p, head: headOf(p, input.spaName) }))
  const locales: SeoLocale[] = input.arabic ? ['en', 'ar'] : ['en']
  // Duplicates per language and field: lower-cased value → the pages using it (in page order).
  const same = (field: 'title' | 'description', locale: SeoLocale) => {
    const by = new Map<string, string[]>()
    for (const { page, head } of pages) {
      const v = head[field][locale].toLowerCase()
      if (!v) continue
      const list = by.get(v)
      if (list) list.push(page.slug)
      else by.set(v, [page.slug])
    }
    return by
  }
  const dup = {
    en: { title: same('title', 'en'), description: same('description', 'en') },
    ar: { title: same('title', 'ar'), description: same('description', 'ar') },
  }
  /** "/about, /contact and 3 more" — the other pages with the same value (none: ''). */
  const others = (slug: string, locale: SeoLocale, field: 'title' | 'description', v: string) => {
    const list = dup[locale][field].get(v.toLowerCase()) ?? []
    if (list.length < 2) return ''
    const shown: string[] = []
    for (const s of list) {
      if (shown.length === 3) break
      if (s !== slug) shown.push(pathOf(s))
    }
    const more = list.length - 1 - shown.length
    return `${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`
  }
  const sitemap = new Set(input.sitemap)
  for (const { page, head } of pages) {
    for (const locale of locales) {
      const title = head.title[locale]
      const description = head.description[locale]
      const sameTitle = title ? others(page.slug, locale, 'title', title) : ''
      const sameDescription = description ? others(page.slug, locale, 'description', description) : ''
      if (locale === 'en' && !title)
        add('title_missing', page.slug, locale, 'No page title — search results show only the spa name.')
      if (title && chars(title) > SEO_TITLE_MAX)
        add(
          'title_long',
          page.slug,
          locale,
          `The title is ${chars(title)} characters (keep it to ${SEO_TITLE_MAX}).`,
        )
      if (sameTitle) add('title_duplicate', page.slug, locale, `Same title as ${sameTitle}.`)
      if (locale === 'en' && !description)
        add('description_missing', page.slug, locale, 'No search description.')
      if (description && chars(description) < SEO_DESCRIPTION_MIN)
        add(
          'description_short',
          page.slug,
          locale,
          `The description is ${chars(description)} characters (aim for ${SEO_DESCRIPTION_MIN}–${SEO_DESCRIPTION_MAX}).`,
        )
      if (description && chars(description) > SEO_DESCRIPTION_MAX)
        add(
          'description_long',
          page.slug,
          locale,
          `The description is ${chars(description)} characters (aim for ${SEO_DESCRIPTION_MIN}–${SEO_DESCRIPTION_MAX}).`,
        )
      if (sameDescription)
        add('description_duplicate', page.slug, locale, `Same description as ${sameDescription}.`)
    }
    const node = designNode(page.data)
    const noAlt = node ? htmlImagesWithoutAlt(page.html ?? '') : blockImagesWithoutAlt(page.data)
    if (noAlt)
      add('image_alt_missing', page.slug, 'en', `${plural(noAlt, 'image has', 'images have')} no alt text.`)
    if (!sitemap.has(page.slug))
      add('not_in_sitemap', page.slug, 'en', 'Live, but sitemap.xml doesn’t list it.')
  }
  const counts: SeoCounts = { high: 0, medium: 0 }
  for (const f of findings) counts[f.severity]++
  return { findings: findings.slice(0, MAX_SEO_FINDINGS), counts }
}
