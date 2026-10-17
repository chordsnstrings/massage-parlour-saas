// R33 (owner 2026-10-17): a spa's own redirects — addresses of its old website that search engines still list (now a
// 404) → pages of the new site, a 301 on every public address of the spa (proxy.ts, web server/site-redirect.ts).
// Pure helpers shared by the console (parse + check), services (save: chains, loops) and the proxy (match). Old
// addresses are stored and matched decoded, lower-case and without a trailing slash, so `/Old%20Page/`, `/old page`
// and `/OLD PAGE` are one address; a source `?query` matches when all of its params are on the request.
import { trimTrailingSlashes } from './hosts'

/** Longest old address path (decoded) or query kept. */
export const REDIRECT_PATH_MAX = 512
/** Longest new address (path + query + hash). */
export const REDIRECT_TARGET_MAX = 1000
/** Lines one import may have (owner 2026-10-17). */
export const REDIRECT_IMPORT_MAX_LINES = 500

/** A stored redirect: `from` = normalised path, `query` = normalised source params ('' = any), `to` = on-site path [?query][#hash]. */
export type RedirectRule = { from: string; query: string; to: string }
export type RedirectSource = { path: string; query: string }
/**
 * The spa's public addresses a pasted full URL may be on (anything else is "another site"): bare hostnames
 * (`theirspa.ae`, `www.theirspa.ae`, `{slug}.spamanagement.co`) or, for path routing, `{host}/s/{slug}`.
 */
export type RedirectAddresses = { addresses: readonly string[] }

type Problem = { error: string }
/** `foreign`: the host of a full URL that isn't one of the spa's addresses. */
type RestProblem = Problem & { foreign?: string }
const BASE = 'http://site.invalid'

// Never reach the proxy (its matcher skips them): static files by extension, /api, /_next, /files, /.well-known.
const STATIC_FILE = /\.(?:svg|png|jpg|jpeg|webp|avif|ico|css|js|woff2?)$/
const NOT_PROXIED = /^\/(?:api|_next|files|\.well-known)(?:\/|$)/
const SITE_ROUTES: [RegExp, string][] = [
  [/^\/book(?:\/|$)/, 'online booking'],
  [/^\/voucher\//, 'gift vouchers'],
  [/^\/(?:robots\.txt|sitemap\.xml)$/, 'search engines'],
  [/^\/(?:crm-data\.json|crm-enquiry)$/, 'the design’s live data'],
  [/^\/manifest\.webmanifest$/, 'the installed app'],
]

/**
 * Why a normalised old-address path can never redirect (the site's own routes, or a request the proxy never sees),
 * else null. The home page `/` is left to the caller: only with a ?query (WordPress `/?p=12`).
 */
export function redirectPathProblem(path: string): string | null {
  if (STATIC_FILE.test(path))
    return 'Pictures, styles, scripts and fonts (.png, .jpg, .css, .js …) can’t be redirected.'
  if (NOT_PROXIED.test(path))
    return 'Addresses under /api, /_next, /files and /.well-known can’t be redirected.'
  for (const [re, what] of SITE_ROUTES)
    if (re.test(path)) return `${path} is used by the site itself (${what}).`
  return null
}

/** Decoded, lower-case, `//` collapsed, no trailing slash ('/' for the home page). */
function normalisePath(raw: string): string | Problem {
  const segments: string[] = []
  for (const seg of raw.split('/')) {
    if (!seg) continue
    let s: string
    try {
      s = decodeURIComponent(seg)
    } catch {
      return { error: 'The address has a broken % code.' }
    }
    if (s === '.' || s === '..') return { error: 'The address can’t have . or .. parts.' }
    if (/\p{Cc}/u.test(s)) return { error: 'The address has invisible control characters.' }
    segments.push(s.normalize('NFC').toLowerCase())
  }
  return `/${segments.join('/')}`
}

/**
 * The request path (as sent: percent-encoded) as an old-address key, normalised like a stored one; null when it can't
 * be decoded (never matches).
 */
export function redirectRequestKey(encodedPath: string): string | null {
  const p = normalisePath(encodedPath)
  return typeof p === 'string' ? p : null
}

/** A new address's path as an old-address key (to find chains: a target that is another redirect's source). */
export function redirectTargetKey(to: string): string {
  try {
    return redirectRequestKey(new URL(to, BASE).pathname) ?? to
  } catch {
    return to
  }
}

/** Params sorted, empty keys dropped, values as typed. */
function normaliseQuery(raw: string): string {
  const params = [...new URLSearchParams(raw)].filter(([k]) => k !== '')
  params.sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
  return new URLSearchParams(params).toString()
}

const hostOf = (h: string) => h.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.+$/, '')

/** `rest` ('/…') when `hostname` + `pathname` is on one of the spa's addresses, else null. */
function onAddress(hostname: string, pathname: string, addresses: readonly string[]): string | null {
  const host = hostOf(hostname)
  for (const a of addresses) {
    const slash = a.indexOf('/')
    const aHost = hostOf(slash < 0 ? a : a.slice(0, slash))
    const prefix = slash < 0 ? '' : trimTrailingSlashes(a.slice(slash)).toLowerCase()
    if (aHost !== host) continue
    if (!prefix) return pathname || '/'
    const lower = pathname.toLowerCase()
    if (lower === prefix || lower.startsWith(`${prefix}/`)) return pathname.slice(prefix.length) || '/'
  }
  return null
}

/**
 * What a typed or pasted address is on the spa's site: '/path?query#hash'. A full http(s) URL (or `//host/…`) must be
 * on one of `addresses` (its host — and a path-routing `/s/{slug}` — is stripped); a bare `old-page` gets its `/`, a
 * bare `theirspa.ae/old-page` loses the host.
 */
function siteRest(input: string, addresses: readonly string[]): string | RestProblem {
  const s = input.trim()
  const scheme = /^[a-z][a-z\d+.-]*:/i.test(s)
  if (scheme || s.startsWith('//')) {
    if (scheme && !/^https?:\/\//i.test(s))
      return { error: 'Use a web address (http or https) or a path like /old-page.' }
    let u: URL
    try {
      u = new URL(scheme ? s : `http:${s}`)
    } catch {
      return { error: 'That address isn’t valid.' }
    }
    const rest = onAddress(u.hostname, u.pathname, addresses)
    if (rest === null) {
      const foreign = hostOf(u.hostname)
      return { error: `${foreign || 'That'} isn’t one of this spa’s addresses.`, foreign }
    }
    return `${rest}${u.search}${u.hash}`
  }
  if (s.startsWith('/')) return s
  const end = s.search(/[/?#]/)
  const first = end < 0 ? s : s.slice(0, end)
  if (first.includes('.')) {
    const rest = onAddress(first, end < 0 ? '/' : s.slice(end).replace(/^(?=[?#])/, '/'), addresses)
    if (rest !== null) return rest
  }
  return `/${s}`
}

/** An old address (path, or a full URL on one of the spa's addresses) → its stored form; or why it can't redirect. */
export function normalizeRedirectSource(input: string, opts: RedirectAddresses): RedirectSource | Problem {
  if (!input.trim()) return { error: 'Enter the old address.' }
  const rest = siteRest(input, opts.addresses)
  if (typeof rest !== 'string') return { error: rest.error }
  const noHash = rest.split('#')[0]!
  const q = noHash.indexOf('?')
  const path = normalisePath(q < 0 ? noHash : noHash.slice(0, q))
  if (typeof path !== 'string') return path
  if (path.length > REDIRECT_PATH_MAX) return { error: 'That address is too long.' }
  const query = q < 0 ? '' : normaliseQuery(noHash.slice(q + 1))
  if (query.length > REDIRECT_PATH_MAX) return { error: 'That address’s ?query is too long.' }
  if (path === '/') {
    if (!query)
      return {
        error: 'The home page can’t be redirected — only an old address with a ?query on it (e.g. /?p=12).',
      }
    return { path, query }
  }
  const problem = redirectPathProblem(path)
  return problem ? { error: problem } : { path, query }
}

/**
 * A new address → an on-site path [?query][#hash] (trailing slash dropped); a full URL only on one of the spa's
 * addresses (host stripped). Never another host: no `//host`, `/\host`, other schemes, spaces or control characters.
 */
export function normalizeRedirectTarget(input: string, opts: RedirectAddresses): { to: string } | Problem {
  const s = input.trim()
  if (!s) return { error: 'Enter the new address.' }
  const offSite = { error: 'Redirects can only go to this spa’s own pages.' }
  if (/[\s\p{Cc}\\]/u.test(s)) return { error: 'The new address can’t have spaces or backslashes.' }
  if (s.startsWith('//')) return offSite
  const rest = siteRest(s, opts.addresses)
  if (typeof rest !== 'string')
    return rest.foreign
      ? { error: `${offSite.error} ${rest.foreign} is another site.` }
      : { error: rest.error }
  let u: URL
  try {
    u = new URL(rest, BASE)
  } catch {
    return { error: 'That address isn’t valid.' }
  }
  if (u.origin !== BASE) return offSite
  const to = `${trimTrailingSlashes(u.pathname) || '/'}${u.search}${u.hash}`
  // `/.//host` parses to the path `//host`: a Location a browser would read as another host. Refused, not repaired.
  if (!/^\/(?![/\\])/.test(to)) return offSite
  if (to.length > REDIRECT_TARGET_MAX) return { error: 'The new address is too long.' }
  return { to }
}

const paramsOf = (query: string) => [...new URLSearchParams(query)]
const matches = (params: [string, string][], on: URLSearchParams) =>
  params.every(([k, v]) => on.getAll(k).includes(v))

/**
 * The redirect for a request (`key` = redirectRequestKey of its path, `search` = its query): among `rules` at that
 * path, the one with the most source params all present (a path-only rule matches any query). The visitor's other
 * params (gclid, utm_*) carry over; the target's own params win a clash. Null when none matches, or when the target is
 * this same address again (a loop).
 */
export function matchRedirect(
  rules: readonly RedirectRule[],
  key: string,
  search: string,
): { to: string; rule: RedirectRule } | null {
  const visitor = new URLSearchParams(search)
  let best: { rule: RedirectRule; params: [string, string][] } | null = null
  for (const rule of rules) {
    if (rule.from !== key) continue
    const params = paramsOf(rule.query)
    if (!matches(params, visitor)) continue
    if (
      !best ||
      params.length > best.params.length ||
      (params.length === best.params.length && rule.query < best.rule.query)
    )
      best = { rule, params }
  }
  if (!best) return null
  let target: URL
  try {
    target = new URL(best.rule.to, BASE)
  } catch {
    return null
  }
  const rest = [...visitor]
  for (const [k, v] of best.params) {
    const i = rest.findIndex(([rk, rv]) => rk === k && rv === v)
    if (i >= 0) rest.splice(i, 1)
  }
  const own = new Set(target.searchParams.keys())
  for (const [k, v] of rest) if (!own.has(k)) target.searchParams.append(k, v)
  if (redirectRequestKey(target.pathname) === key && matches(best.params, target.searchParams)) return null
  return { to: `${target.pathname}${target.search}${target.hash}`, rule: best.rule }
}

/** The rule would send its own old address to itself (same path, its params kept). */
export function redirectLoops(rule: RedirectRule): boolean {
  return matchRedirect([rule], rule.from, rule.query) === null
}

/** The old address as a link (`{site}{href}`): path segments percent-encoded, the stored query as is. */
export function redirectSourceHref(path: string, query: string): string {
  return `${path.split('/').map(encodeURIComponent).join('/')}${query ? `?${query}` : ''}`
}

export type RedirectLine = { line: number } & RedirectRule
export type RedirectLineError = { line: number; text: string; error: string }

// A first line naming columns (Search Console: "URL,Last crawled").
const HEADER =
  /^(?:urls?|address(?:es)?|links?|pages?|top pages|from|source|old(?:[ _-]?(?:urls?|address(?:es)?|pages?))?)$/i

function csvCells(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (quoted) {
      if (c !== '"') cur += c
      else if (line[i + 1] === '"') {
        cur += '"'
        i++
      } else quoted = false
    } else if (c === '"') quoted = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

/** Tab, `->` / `→` / `=>`, comma (CSV quotes respected) or whitespace separated. */
function cellsOf(line: string): string[] {
  const arrow = line.split(/\s*(?:->|→|=>)\s*/)
  const cells = line.includes('\t')
    ? line.split('\t')
    : arrow.length > 1
      ? arrow
      : line.includes(',')
        ? csvCells(line)
        : line.split(/\s+/)
  return cells.map((c) => c.trim().replace(/^"([\s\S]*)"$/, '$1')).filter(Boolean)
}

/** One import line's redirect, or why it can't be one. */
function lineRule(
  cells: string[],
  opts: RedirectAddresses,
  fallback: { to: string } | Problem | null,
): RedirectRule | string {
  const source = normalizeRedirectSource(cells[0]!, opts)
  if ('error' in source) return source.error
  const second = cells[1] && /^(?:\/|https?:)/i.test(cells[1]) ? cells[1] : null
  const target = second ? normalizeRedirectTarget(second, opts) : fallback
  if (!target) return 'Add the new address after the old one, or pick a new address for single URLs.'
  if ('error' in target) return target.error
  const rule = { from: source.path, query: source.query, to: target.to }
  return redirectLoops(rule) ? 'The old and new address are the same.' : rule
}

/**
 * A pasted list (Search Console's 404 export, or `old new` pairs) → redirects, one per line. Blank lines, `#` notes and
 * a header line are skipped. A second column is the new address only when it starts with `/` or `http` (Search
 * Console's second column is a date): otherwise `defaultTarget` (the import form's choice, e.g. the home page). The
 * last line wins for the same old address. At most REDIRECT_IMPORT_MAX_LINES lines.
 */
export function parseRedirectLines(
  text: string,
  opts: RedirectAddresses & { defaultTarget: string },
): { rows: RedirectLine[]; errors: RedirectLineError[] } {
  const lines = text.split(/\r\n|\r|\n/)
  const content = lines.filter((l) => l.trim() && !l.trim().startsWith('#')).length
  if (content > REDIRECT_IMPORT_MAX_LINES)
    return {
      rows: [],
      errors: [
        {
          line: 0,
          text: '',
          error: `At most ${REDIRECT_IMPORT_MAX_LINES} lines per import — split the list.`,
        },
      ],
    }
  const fallback = opts.defaultTarget.trim() ? normalizeRedirectTarget(opts.defaultTarget, opts) : null
  const rows = new Map<string, RedirectLine>()
  const errors: RedirectLineError[] = []
  let first = true
  lines.forEach((raw, i) => {
    const text = raw.trim()
    if (!text || text.startsWith('#')) return
    const cells = cellsOf(text)
    const isHeader = first && (HEADER.test(cells[0] ?? '') || /last crawled/i.test(text))
    first = false
    if (isHeader || !cells.length) return
    const rule = lineRule(cells, opts, fallback)
    if (typeof rule === 'string') {
      errors.push({ line: i + 1, text, error: rule })
      return
    }
    const key = `${rule.from}?${rule.query}`
    rows.delete(key)
    rows.set(key, { line: i + 1, ...rule })
  })
  return { rows: [...rows.values()], errors }
}
