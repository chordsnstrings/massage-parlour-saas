import {
  describeSchedule,
  type SectionSchedule,
  safeSectionId,
  scheduleState,
  scopeSectionCss,
} from '@spa/services/site-kit'
import type { CSSProperties } from 'react'
import type { Responsive } from './types'

/** Advanced band props (PLAN §11.3 layer 6, owner/designer only): scoped custom CSS + show-between dates. */
export type AdvancedProps = { customCss?: string; schedule?: SectionSchedule }

/**
 * Compiles a band's advanced props: sanitised CSS scoped to `[data-section-id]` and whether the schedule shows
 * it right now (Asia/Dubai). Pure, so the editor canvas and the server render agree.
 */
export function advancedStyle(id: string, advanced: AdvancedProps | undefined, now = new Date()) {
  const state = scheduleState(advanced?.schedule, now)
  return {
    sectionId: safeSectionId(id),
    css: advanced?.customCss ? scopeSectionCss(advanced.customCss, id).css : '',
    state,
    visible: state === 'always' || state === 'live',
    label: describeSchedule(advanced?.schedule),
  }
}

/**
 * Responsive style props compile to CSS variables (base / md / lg) read by a few static classes in site.css,
 * so per-device overrides need no runtime style calculation and no generated class names.
 */
export function resolveResponsive<T>(value: Responsive<T> | T | undefined, fallback: T): [T, T, T] {
  if (value === undefined || value === null) return [fallback, fallback, fallback]
  if (typeof value !== 'object' || !('base' in (value as object))) {
    const v = value as T
    return [v, v, v]
  }
  const r = value as Responsive<T>
  const base = r.base ?? fallback
  const md = r.md ?? base
  const lg = r.lg ?? md
  return [base, md, lg]
}

export const PAD_STEPS = { none: 0, xs: 1.5, sm: 2.5, md: 4, lg: 6, xl: 8 } as const
export type PadStep = keyof typeof PAD_STEPS
export type Align = 'start' | 'center' | 'end'
export type Visibility = 'show' | 'hide'

type StyleInput = {
  padding?: Responsive<PadStep>
  align?: Responsive<Align>
  hide?: Responsive<Visibility>
  /** Spacer height. */
  height?: Responsive<PadStep>
}

/** Class names, CSS variables and visibility attributes for a block's responsive style props. */
export function responsiveStyle(input: StyleInput, opts: { editing?: boolean; padFallback?: PadStep } = {}) {
  const classes: string[] = []
  const style: Record<string, string> = {}
  if (input.padding !== undefined || opts.padFallback) {
    const [b, m, l] = resolveResponsive<PadStep>(input.padding, opts.padFallback ?? 'md')
    classes.push('sb-py')
    style['--py-b'] = `${PAD_STEPS[b] ?? 4}rem`
    style['--py-m'] = `${PAD_STEPS[m] ?? 4}rem`
    style['--py-l'] = `${PAD_STEPS[l] ?? 4}rem`
  }
  if (input.height !== undefined) {
    const [b, m, l] = resolveResponsive<PadStep>(input.height, 'md')
    classes.push('sb-h')
    style['--h-b'] = `${PAD_STEPS[b] ?? 4}rem`
    style['--h-m'] = `${PAD_STEPS[m] ?? 4}rem`
    style['--h-l'] = `${PAD_STEPS[l] ?? 4}rem`
  }
  if (input.align !== undefined) {
    const [b, m, l] = resolveResponsive<Align>(input.align, 'start')
    classes.push('sb-al')
    style['--al-b'] = b
    style['--al-m'] = m
    style['--al-l'] = l
  }
  const attrs: Record<string, string> = {}
  if (input.hide !== undefined) {
    const [b, m, l] = resolveResponsive<Visibility>(input.hide, 'show')
    const hidden = [b === 'hide' && 'base', m === 'hide' && 'md', l === 'hide' && 'lg'].filter(Boolean)
    // In the editor hidden blocks stay selectable (ghosted) instead of disappearing.
    if (hidden.length) attrs[opts.editing ? 'data-ghost' : 'data-hide'] = hidden.join(' ')
  }
  return { className: classes.join(' '), style: style as CSSProperties, attrs }
}
