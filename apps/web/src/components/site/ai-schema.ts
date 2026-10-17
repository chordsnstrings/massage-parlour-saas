import type { Field } from '@puckeditor/core'
import type { PropSpec, SiteEditSchema } from '@spa/services/site-kit'
import { siteConfig } from './config'
import type { AiFieldMeta } from './field-defs'
import { SECTION_PRESETS } from './presets'
import { BACKDROPS, EMBLEMS, HEADING_FACES } from './theme'

/** Puck field → AI prop spec; null = not editable by AI (custom CSS, schedules, unknown custom fields). */
function spec(f: Field): PropSpec | null {
  switch (f.type) {
    case 'text':
    case 'textarea':
      return { kind: 'text' }
    case 'number':
      return { kind: 'number', min: f.min, max: f.max }
    case 'select':
    case 'radio':
      return { kind: 'enum', options: f.options.map((o) => o.value as string | number | boolean) }
    case 'slot':
      return { kind: 'slot', allow: f.allow, disallow: f.disallow }
    case 'array': {
      const item = specs(f.arrayFields as Record<string, Field>)
      return { kind: 'array', item, max: f.max }
    }
    case 'object':
      return { kind: 'object', fields: specs(f.objectFields as Record<string, Field>) }
    case 'custom': {
      const ai = (f as Field & { ai?: AiFieldMeta }).ai
      return ai ?? null
    }
    default:
      return null
  }
}

function specs(fields: Record<string, Field> | undefined) {
  const out: Record<string, PropSpec> = {}
  for (const [k, f] of Object.entries(fields ?? {})) {
    const s = spec(f)
    if (s && !(s.kind === 'object' && !Object.keys(s.fields).length)) out[k] = s
  }
  return out
}

const enumOf = (...options: (string | number)[]): PropSpec => ({ kind: 'enum', options })
const COLOR: PropSpec = { kind: 'color' }

/** Theme tokens the AI may set (mirrors `normalizeTheme`, which re-checks them on save). */
const THEME_SPEC: Record<string, PropSpec> = {
  bg: COLOR,
  surface: COLOR,
  subtle: COLOR,
  border: COLOR,
  fg: COLOR,
  muted: COLOR,
  accent: COLOR,
  accentFg: COLOR,
  accentSoft: COLOR,
  inverseBg: COLOR,
  inverseFg: COLOR,
  headingFont: enumOf('serif', 'sans'),
  bodyFont: enumOf('serif', 'sans'),
  headingWeight: { kind: 'number', min: 300, max: 700 },
  headingCase: enumOf('none', 'uppercase'),
  headingTracking: { kind: 'number', min: -0.05, max: 0.3 },
  radius: enumOf('none', 'soft', 'round'),
  buttonShape: enumOf('square', 'rounded', 'pill'),
  density: enumOf('compact', 'comfortable', 'airy'),
  motion: enumOf('none', 'subtle', 'expressive'),
  pattern: enumOf('none', 'lattice', 'arabesque', 'leaf'),
  arabicFont: enumOf('naskh', 'kufi', 'sans', 'amiri'),
  imageShape: enumOf('theme', 'arch', 'organic'),
  headingFace: enumOf(...Object.keys(HEADING_FACES)),
  backdrop: enumOf(...BACKDROPS),
  emblem: enumOf(...EMBLEMS),
  emphasis: enumOf('italic', 'muted', 'underline'),
}

let cached: SiteEditSchema | null = null

/**
 * R16: the vocabulary AI edits are checked against, built from the real Puck config (blocks, props, option
 * values, slot rules, defaults), the section presets and the theme tokens. Hidden blocks (GlobalSection) are out.
 */
export function siteEditSchema(): SiteEditSchema {
  if (cached) return cached
  const hidden = new Set(
    Object.values(siteConfig.categories ?? {})
      .filter((c) => c.visible === false)
      .flatMap((c) => c.components ?? []),
  )
  const blocks: SiteEditSchema['blocks'] = {}
  const categoryOf = new Map(
    Object.entries(siteConfig.categories ?? {}).flatMap(([cat, c]) =>
      (c.components ?? []).map((n) => [n, cat]),
    ),
  )
  for (const [type, c] of Object.entries(siteConfig.components)) {
    if (hidden.has(type)) continue
    blocks[type] = {
      label: c.label ?? type,
      category: categoryOf.get(type),
      props: specs(c.fields as Record<string, Field>),
      defaults: (c.defaultProps ?? {}) as Record<string, unknown>,
    }
  }
  cached = {
    blocks,
    root: specs(siteConfig.root?.fields as Record<string, Field>),
    theme: THEME_SPEC,
    presets: SECTION_PRESETS.filter((p) => blocks[p.node.type]).map((p) => ({
      key: p.key,
      name: p.name,
      category: p.category,
      description: p.description,
      node: p.node,
    })),
  }
  return cached
}
