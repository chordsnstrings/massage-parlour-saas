import { contrastRatio, MIN_TEXT_CONTRAST } from './contrast'
import { scopeSectionCss } from './css'
import { imageSrc, withImageSrc } from './image'
import { type DataPath, GLOBAL_SECTION, isNode, isNodeArray, type PuckNode, walkNodes } from './tree'

/**
 * Preflight before publish (PLAN §11.5): content checks run in the publish dialog (with "Go to block" and
 * one-click fixes) and again on the server. Errors block publishing; warnings don't.
 */
export type PreflightRule =
  | 'insecure-image'
  | 'alt'
  | 'contrast'
  | 'heading-length'
  | 'empty'
  | 'arabic'
  | 'link'
  | 'global'
  | 'css'

export type PreflightFix =
  /** Replace the value at `path`. */
  | { kind: 'set'; label: string; value: unknown }
  /** Remove the block at `path`. */
  | { kind: 'remove'; label: string }
  /** Fill `{ en, ar }` at `path` with an AI translation of `text` (never a copy of the English). */
  | { kind: 'translate'; label: string; text: string }

export type PreflightIssue = {
  id: string
  rule: PreflightRule
  severity: 'error' | 'warning'
  message: string
  /** Puck id of the block to select ("Go to block"); null for page settings. */
  blockId: string | null
  blockType: string
  /** Prop that holds the problem (for field labels). */
  field?: string
  /** Where the offending value lives in the page data. */
  path: DataPath
  fix?: PreflightFix
}

/** Theme colour tokens (see the site theme). */
export type PreflightColors = {
  bg: string
  surface: string
  subtle: string
  fg: string
  accent: string
  accentFg: string
  accentSoft: string
  inverseBg: string
  inverseFg: string
}

export type PreflightContext = {
  colors: PreflightColors
  /** Every page of the site with its state. */
  pages: { slug: string; visible: boolean; published: boolean }[]
  /** Slug of the page being published (counts as published). */
  currentSlug: string
  /** Ids of the tenant's global sections; omit to skip the check. */
  globalIds?: Set<string>
}

export const MAX_HEADING_CHARS = 60
const IMAGE_KEYS = new Set(['src', 'image', 'bgImage', 'imageUrl', 'photo', 'photoUrl', 'poster', 'logo'])
const ALT_FOR: Record<string, string> = { src: 'alt', image: 'imageAlt' }

/** Section background → [text token, background token]; images have their own overlay. */
const BAND: Record<string, [keyof PreflightColors, keyof PreflightColors]> = {
  none: ['fg', 'bg'],
  surface: ['fg', 'surface'],
  subtle: ['fg', 'subtle'],
  soft: ['fg', 'accentSoft'],
  inverse: ['inverseFg', 'inverseBg'],
  accent: ['accentFg', 'accent'],
}
const BAND_NAMES: Record<string, string> = {
  none: 'page',
  surface: 'surface',
  subtle: 'subtle',
  soft: 'accent tint',
  inverse: 'dark band',
  accent: 'accent band',
}

type Bi = { en: string; ar?: string }
const isBi = (v: unknown): v is Bi =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  typeof (v as Bi).en === 'string' &&
  Object.keys(v).every((k) => k === 'en' || k === 'ar')

const isHeading = (type: string, key: string) =>
  (type === 'Heading' && key === 'text') || (key === 'title' && type !== 'Page')

/** `/media/x.jpg` is same-origin (served over https in production); `//cdn…` and `http:` are not. */
const secureUrl = (url: string) => /^https:\/\//i.test(url) || (url.startsWith('/') && !url.startsWith('//'))

/** How many columns a Columns block shows for its ratio ("1-2" → 2). */
const columnCount = (ratio: unknown) => (typeof ratio === 'string' ? ratio.split('-').length : 2)

export function preflight(data: unknown, ctx: PreflightContext): PreflightIssue[] {
  const issues: PreflightIssue[] = []
  const add = (issue: Omit<PreflightIssue, 'id'>) =>
    issues.push({ ...issue, id: `${issue.rule}:${issue.path.join('.')}` })
  const pages = new Map(ctx.pages.map((p) => [p.slug, p]))

  const checkObject = (
    obj: Record<string, unknown>,
    path: DataPath,
    block: { id: string | null; type: string },
    field?: string,
  ) => {
    const base = { blockId: block.id, blockType: block.type }
    for (const [key, value] of Object.entries(obj)) {
      const at = [...path, key]
      const f = field ?? key
      if (isBi(value)) {
        const en = value.en.trim()
        const ar = value.ar?.trim() ?? ''
        if (en && !ar)
          add({
            ...base,
            rule: 'arabic',
            severity: 'warning',
            field: f,
            path: at,
            message: `“${en.slice(0, 48)}${en.length > 48 ? '…' : ''}” has no Arabic text`,
            fix: { kind: 'translate', label: 'Translate with AI', text: value.en },
          })
        if (isHeading(block.type, key)) {
          const longest = Math.max(en.length, ar.length)
          if (longest > MAX_HEADING_CHARS)
            add({
              ...base,
              rule: 'heading-length',
              severity: 'warning',
              field: f,
              path: at,
              message: `Heading is ${longest} characters — keep it under ${MAX_HEADING_CHARS} so it fits on phones`,
            })
        }
      } else if (IMAGE_KEYS.has(key) && imageSrc(value).trim()) {
        const url = imageSrc(value).trim()
        if (!secureUrl(url))
          add({
            ...base,
            rule: 'insecure-image',
            severity: 'error',
            field: f,
            path: at,
            message: 'Image address must start with https://',
            fix: /^http:\/\//i.test(url)
              ? {
                  kind: 'set',
                  label: 'Use https',
                  value: withImageSrc(value, url.replace(/^http:/i, 'https:')),
                }
              : undefined,
          })
        const altKey = ALT_FOR[key]
        if (altKey && altKey in obj) {
          const alt = obj[altKey]
          if (!isBi(alt) || !alt.en.trim()) {
            const caption = obj.caption
            add({
              ...base,
              rule: 'alt',
              severity: 'warning',
              field: field ?? altKey,
              path: [...path, altKey],
              message: 'Image has no alt text (describe it for screen readers and search)',
              fix:
                isBi(caption) && caption.en.trim()
                  ? { kind: 'set', label: 'Use caption as alt text', value: { ...caption } }
                  : undefined,
            })
          }
        }
      } else if (Array.isArray(value) && !isNodeArray(value)) {
        value.forEach((item, i) => {
          if (item && typeof item === 'object' && !Array.isArray(item) && !isNode(item))
            checkObject(item as Record<string, unknown>, [...at, i], block, f)
        })
      }
    }
    if (obj.action === 'page') {
      const slug = String(obj.target ?? '')
        .trim()
        .replace(/^\/+|\/+$/g, '')
        .toLowerCase()
      const page = pages.get(slug)
      const problem = !page
        ? 'a page that doesn’t exist'
        : !page.visible
          ? 'a hidden page'
          : !page.published && slug !== ctx.currentSlug
            ? 'a page that isn’t published yet'
            : null
      if (problem)
        add({
          ...base,
          rule: 'link',
          severity: 'warning',
          field,
          path: [...path, 'target'],
          message: `Link goes to ${problem}${slug ? ` (/${slug})` : ''}`,
        })
    }
  }

  const checkNode = (node: PuckNode, path: DataPath) => {
    const id = typeof node.props.id === 'string' ? node.props.id : null
    const block = { id, type: node.type }
    const base = { blockId: id, blockType: node.type }
    checkObject(node.props, [...path, 'props'], block)

    const empty = (label: string, at: DataPath, removable: boolean) =>
      add({
        ...base,
        rule: 'empty',
        severity: 'warning',
        path: at,
        message: label,
        fix: removable ? { kind: 'remove', label: 'Remove block' } : undefined,
      })
    const slot = (key: string) => {
      const v = node.props[key]
      return Array.isArray(v) ? v.length : 0
    }
    if (node.type === 'Section' && slot('content') === 0) empty('Section is empty', path, true)
    if (node.type === 'Stack' && slot('items') === 0) empty('Stack is empty', path, true)
    if (node.type === 'Columns') {
      const n = columnCount(node.props.ratio)
      const keys = ['col1', 'col2', 'col3', 'col4'].slice(0, n)
      const blank = keys.filter((k) => slot(k) === 0)
      if (blank.length === n) empty('All columns are empty', path, true)
      else
        for (const k of blank)
          add({
            ...base,
            rule: 'empty',
            severity: 'warning',
            field: k,
            path: [...path, 'props', k],
            message: `Column ${k.slice(3)} is empty`,
          })
    }
    if (node.type === GLOBAL_SECTION && ctx.globalIds) {
      const sectionId = String(node.props.sectionId ?? '')
      if (!ctx.globalIds.has(sectionId)) empty('This global section was deleted from the library', path, true)
    }

    const band = typeof node.props.background === 'string' ? BAND[node.props.background] : undefined
    if (band) {
      const ratio = contrastRatio(ctx.colors[band[0]], ctx.colors[band[1]])
      if (ratio !== null && ratio < MIN_TEXT_CONTRAST)
        add({
          ...base,
          rule: 'contrast',
          severity: 'warning',
          field: 'background',
          path: [...path, 'props', 'background'],
          message: `Text on the ${BAND_NAMES[node.props.background as string]} background has a contrast of ${ratio.toFixed(1)}:1 (needs ${MIN_TEXT_CONTRAST}:1)`,
        })
    }

    const customCss = (node.props.advanced as { customCss?: unknown } | undefined)?.customCss
    if (typeof customCss === 'string' && customCss.trim()) {
      const scoped = scopeSectionCss(customCss, id ?? 'x')
      if (scoped.removed.length)
        add({
          ...base,
          rule: 'css',
          severity: 'warning',
          field: 'advanced',
          path: [...path, 'props', 'advanced', 'customCss'],
          message: scoped.tooLarge
            ? 'Custom CSS is over 4 KB and isn’t applied'
            : `Some custom CSS is ignored: ${scoped.removed.join(', ')}`,
        })
    }
  }

  const root = (data as { root?: { props?: Record<string, unknown> } } | null)?.root?.props
  if (root) checkObject(root, ['root', 'props'], { id: null, type: 'Page' })
  walkNodes(data, (node, path) => {
    checkNode(node, path)
  })
  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
}

export const preflightErrors = (issues: PreflightIssue[]) => issues.filter((i) => i.severity === 'error')
