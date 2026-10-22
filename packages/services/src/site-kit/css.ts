/**
 * Section-scoped custom CSS (PLAN §11.3 layer 6, §11.8). Owners may style one section with plain CSS; it is
 * sanitised (no imports, scripts, foreign URLs or markup) and every selector is prefixed with the section's
 * `[data-section-id]`, so it can never reach the rest of the page. Pure and dependency-free: it runs in the
 * editor canvas (live preview) and on the server for the public page.
 */
export const MAX_SECTION_CSS_BYTES = 4096

export type ScopedCss = {
  /** Ready to inject into a <style> element (never contains `<`). */
  css: string
  /** Human-readable notes on what was dropped. */
  removed: string[]
  tooLarge: boolean
}

const ALLOWED_AT_RULES = new Set(['media', 'supports'])
const BLOCKED_PROPS = /^(behavior|-ms-behavior|-moz-binding)$/i
const PROP = /^(--[a-z0-9_-]+|-?[a-z][a-z0-9-]*)$/i
const SELECTOR = /^[\w\s\-.#:>+~*()[\]="'^$|,%&]+$/
const AT_PRELUDE = /^[\w\s\-():,.>=/'"]*$/
const HTTPS_URL = /^https:\/\/[^\s"'()\\<>]+$/i

/** Puck ids are safe already; this keeps the attribute selector well-formed whatever we are given. */
export const safeSectionId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)

export const sectionSelector = (id: string) => `[data-section-id="${safeSectionId(id)}"]`

const byteLength = (s: string) => new TextEncoder().encode(s).length

/** Splits on `sep` at nesting depth 0, outside strings. */
function splitTop(input: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!
    if (quote) {
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1)
    else if (c === sep && depth === 0) {
      out.push(input.slice(start, i))
      start = i + 1
    }
  }
  out.push(input.slice(start))
  return out
}

type Block = { prelude: string; body: string | null }

/** Top-level `prelude { body }` blocks and `@statement;` rules; an unclosed block drops the rest. */
function parseBlocks(input: string, removed: Set<string>): Block[] {
  const blocks: Block[] = []
  let quote: string | null = null
  let start = 0
  let i = 0
  while (i < input.length) {
    const c = input[i]!
    if (quote) {
      if (c === quote) quote = null
      i++
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
    } else if (c === ';') {
      const prelude = input.slice(start, i).trim()
      if (prelude) blocks.push({ prelude, body: null })
      start = i + 1
    } else if (c === '{') {
      let depth = 1
      let j = i + 1
      let q: string | null = null
      for (; j < input.length && depth > 0; j++) {
        const d = input[j]!
        if (q) {
          if (d === q) q = null
        } else if (d === '"' || d === "'") q = d
        else if (d === '{') depth++
        else if (d === '}') depth--
      }
      if (depth > 0) {
        removed.add('an unclosed { block')
        return blocks
      }
      blocks.push({ prelude: input.slice(start, i).trim(), body: input.slice(i + 1, j - 1) })
      start = j
      i = j
      continue
    } else if (c === '}') {
      // Stray closing brace: skip it and whatever came before it.
      start = i + 1
    }
    i++
  }
  if (input.slice(start).trim()) removed.add('text outside a rule')
  return blocks
}

function cleanDeclarations(body: string, removed: Set<string>): string {
  const out: string[] = []
  // Nested rules (CSS nesting) aren't scoped by us: drop them.
  let flat = body
  if (/[{}]/.test(flat)) {
    removed.add('nested rules')
    flat = flat.replace(/[^;{}]*\{[^{}]*\}/g, '').replace(/[{}]/g, '')
  }
  for (const raw of splitTop(flat, ';')) {
    const decl = raw.trim()
    if (!decl) continue
    const colon = decl.indexOf(':')
    if (colon <= 0) continue
    const prop = decl.slice(0, colon).trim()
    const value = decl.slice(colon + 1).trim()
    if (!PROP.test(prop) || !value) continue
    if (BLOCKED_PROPS.test(prop)) {
      removed.add(prop.toLowerCase())
      continue
    }
    if (value.includes('\\')) {
      removed.add('escaped characters')
      continue
    }
    if (/expression\s*\(/i.test(value)) {
      removed.add('expression()')
      continue
    }
    if (/(java|vb)script\s*:/i.test(value)) {
      removed.add('javascript: URLs')
      continue
    }
    if (/(image-set|src)\s*\(/i.test(value)) {
      removed.add('image-set()')
      continue
    }
    let urlsOk = true
    const urls = value.match(/url\s*\(/gi)?.length ?? 0
    let matched = 0
    for (const m of value.matchAll(/url\s*\(\s*(["']?)([^"')]*)\1\s*\)/gi)) {
      matched++
      if (!HTTPS_URL.test(m[2]!.trim())) urlsOk = false
    }
    if (!urlsOk || matched !== urls) {
      removed.add('url() other than https images')
      continue
    }
    out.push(`${prop}:${value}`)
  }
  return out.join(';')
}

function scopeSelector(selector: string, scope: string): string | null {
  const s = selector.trim().replace(/\s+/g, ' ')
  if (!s || !SELECTOR.test(s)) return null
  // A leading sibling combinator (`~ *`, `+ section`) would match the section's neighbours, not its content.
  if (/^[~+]/.test(s)) return null
  // `:scope` (and root-ish selectors) mean the section element itself: the wrapper's only child but <style>.
  const root = s.match(/^(:root|html|body|:scope|&)(?![\w-])/i)
  if (root) return `${scope} > :not(style)${s.slice(root[0].length)}`
  return `${scope} ${s}`
}

function compile(input: string, scope: string, removed: Set<string>, depth: number): string {
  let out = ''
  for (const block of parseBlocks(input, removed)) {
    if (block.prelude.startsWith('@')) {
      const name =
        block.prelude
          .slice(1)
          .match(/^[a-z-]+/i)?.[0]
          ?.toLowerCase() ?? ''
      const prelude = block.prelude.slice(1 + name.length).trim()
      if (!ALLOWED_AT_RULES.has(name) || block.body === null || depth > 1) {
        removed.add(`@${name || 'rule'}`)
        continue
      }
      if (!AT_PRELUDE.test(prelude) || /url\s*\(/i.test(prelude)) {
        removed.add(`@${name} condition`)
        continue
      }
      const inner = compile(block.body, scope, removed, depth + 1)
      if (inner) out += `@${name} ${prelude.replace(/\s+/g, ' ')}{${inner}}`
      continue
    }
    if (block.body === null) continue
    const selectors: string[] = []
    for (const part of splitTop(block.prelude, ',')) {
      const scoped = scopeSelector(part, scope)
      if (scoped) selectors.push(scoped)
      else if (part.trim()) removed.add(`selector “${part.trim().slice(0, 40)}”`)
    }
    if (!selectors.length) continue
    const decls = cleanDeclarations(block.body, removed)
    if (decls) out += `${selectors.join(',')}{${decls}}`
  }
  return out
}

/**
 * Sanitises `input` and scopes it to one section. Over-size input is ignored entirely (not truncated) so
 * a half-applied stylesheet never reaches visitors.
 */
export function scopeSectionCss(input: string | null | undefined, sectionId: string): ScopedCss {
  // Page JSON is only shape-checked, so anything but a string counts as "no CSS".
  const source = typeof input === 'string' ? input : ''
  if (!source.trim()) return { css: '', removed: [], tooLarge: false }
  if (byteLength(source) > MAX_SECTION_CSS_BYTES) {
    return { css: '', removed: ['everything — custom CSS is limited to 4 KB'], tooLarge: true }
  }
  const removed = new Set<string>()
  let text = source.replace(/\/\*[\s\S]*?(\*\/|$)/g, '')
  if (text.includes('<')) {
    removed.add('HTML tags')
    // Every "<" goes; one that opens a tag takes the tag with it (per piece, so no "<" can survive or re-form).
    text = text
      .split('<')
      .map((part, i) => (i === 0 ? part : part.replace(/^\s*(?:\/\s*)?[a-z!][^>]*>?/i, '')))
      .join('')
  }
  if (/@import/i.test(text)) removed.add('@import')
  const css = compile(text, sectionSelector(sectionId), removed, 0)
  return { css: css.replace(/</g, ''), removed: [...removed], tooLarge: false }
}
