// F10 (G11): Content-Security-Policy + security headers. Pure builders; the web proxy (apps/web/src/proxy.ts) calls
// `pageSecurityHeaders` for every page with a fresh nonce, next.config.ts sets the static rest (API, files, assets).
//
// Decisions (docs/CODEMAP.md "Security headers"):
// - script-src: per-request nonce + 'strict-dynamic' (Next applies the nonce to its own scripts; scripts those load —
//   chunks, t.js, Turnstile — are trusted through strict-dynamic). 'self' + the Turnstile origin are CSP2 fallbacks.
// - style-src 'self' 'unsafe-inline': React renders `style` props as attributes (tenant theme colours, Puck per-device
//   overrides) and Radix (scroll lock), Puck (copies styles into its canvas iframe) and Turnstile insert <style>
//   elements without a nonce; a nonce in style-src would switch 'unsafe-inline' off. CSS can't run script, and
//   img-src/font-src/connect-src keep CSS from loading from or reporting to anything but https images.
// - img-src https:: image fields accept any https URL (AI images, pasted links, Instagram/Google media); stored files
//   are served by the app itself (/files), never straight from the S3/R2 bucket.

export type CspSurface = 'marketing' | 'app' | 'admin' | 'site' | 'domain'

/** Cloudflare Turnstile (F9): script + challenge iframe. */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'
/** Violation reports (report-uri: sent at once, by every browser). */
export const CSP_REPORT_PATH = '/api/csp-report'
/** Shell document that runs uploaded HTML designs (R17) under their own policy (CSP sandbox). */
export const HTML_DESIGN_FRAME_PATH = '/api/html-design/frame'

/** Surfaces with a Turnstile form: marketing Contact, app Apply (/signup), spa sites' /book + widget. */
const TURNSTILE_SURFACES: readonly CspSurface[] = ['marketing', 'app', 'site', 'domain']

export type PageKind = {
  surface: CspSurface
  /** The booking widget's iframe route: the only page any site may frame. */
  embed: boolean
}

/** Surface + page kind of a rewritten (internal) path, see proxy.ts `internalPath`. */
export function pageKindOf(internalPath: string): PageKind {
  const top = internalPath.split('/')[1] ?? ''
  const surface: CspSurface =
    top === 'dashboard'
      ? 'app'
      : top === 'platform'
        ? 'admin'
        : top === 'site'
          ? 'site'
          : top === 'domain'
            ? 'domain'
            : 'marketing'
  const embed =
    (surface === 'site' || surface === 'domain') && /^\/[^/]+\/[^/]+\/book\/embed\/?$/.test(internalPath)
  return { surface, embed }
}

/** 128 random bits, base64 (a valid CSP nonce-source). */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export type CspOptions = PageKind & {
  nonce: string
  /** Development server: React needs eval for its debug stacks. */
  dev?: boolean
  /** Served over https (adds upgrade-insecure-requests). */
  https?: boolean
}

/** The page CSP for one response. */
export function contentSecurityPolicy(o: CspOptions): string {
  const turnstile = TURNSTILE_SURFACES.includes(o.surface) ? [TURNSTILE_ORIGIN] : []
  const directives: [string, ...string[]][] = [
    ['default-src', "'self'"],
    [
      'script-src',
      "'self'",
      `'nonce-${o.nonce}'`,
      "'strict-dynamic'",
      ...turnstile,
      ...(o.dev ? ["'unsafe-eval'"] : []),
    ],
    ['style-src', "'self'", "'unsafe-inline'"],
    ['img-src', "'self'", 'data:', 'blob:', 'https:'],
    ['font-src', "'self'", 'data:'],
    ['connect-src', "'self'"],
    ['frame-src', "'self'", ...turnstile],
    ['worker-src', "'self'"],
    ['manifest-src', "'self'"],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', o.embed ? '*' : "'self'"],
    ...(o.https ? ([['upgrade-insecure-requests']] as [string][]) : []),
    ['report-uri', `${CSP_REPORT_PATH}?s=${o.surface}`],
  ]
  return directives.map((d) => d.join(' ')).join('; ')
}

export type PageHeaderOptions = {
  nonce: string
  internalPath: string
  https: boolean
  dev?: boolean
}

/**
 * Headers the proxy puts on every page response (next.config.ts adds nosniff, Referrer-Policy and Permissions-Policy
 * to every path). HSTS only over https; includeSubDomains only on platform hosts (a spa's own domain may have other,
 * http-only subdomains).
 */
export function pageSecurityHeaders(o: PageHeaderOptions): Record<string, string> {
  const kind = pageKindOf(o.internalPath)
  const h: Record<string, string> = {
    'content-security-policy': contentSecurityPolicy({ ...kind, nonce: o.nonce, dev: o.dev, https: o.https }),
  }
  if (!kind.embed) {
    h['x-frame-options'] = 'SAMEORIGIN'
    // The spa dashboard opens WhatsApp Web in one named tab it reuses (outbox queue): popups keep their opener.
    h['cross-origin-opener-policy'] = kind.surface === 'app' ? 'same-origin-allow-popups' : 'same-origin'
  }
  if (o.https)
    h['strict-transport-security'] =
      kind.surface === 'domain' ? 'max-age=31536000' : 'max-age=31536000; includeSubDomains'
  return h
}

/** JSON/redirect endpoints (/api, /.well-known): nothing may load, frame or submit. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

/** iframe sandbox of an uploaded HTML design on spa sites (R17): no allow-same-origin, ever. */
export const HTML_DESIGN_SANDBOX =
  'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation'

/**
 * The design shell's own policy: the design runs exactly as built (any CSS, fonts, images, scripts), but always in
 * an opaque origin (CSP sandbox, even when opened directly) and only inside the platform's own pages.
 */
export function htmlDesignFrameCsp(): string {
  const any = "* data: blob: 'unsafe-inline' 'unsafe-eval'"
  return [
    `default-src ${any}`,
    `script-src ${any}`,
    `style-src ${any}`,
    'img-src * data: blob:',
    'font-src * data:',
    'media-src * data: blob:',
    'connect-src *',
    'frame-src *',
    'form-action *',
    "object-src 'none'",
    "frame-ancestors 'self'",
    `sandbox ${HTML_DESIGN_SANDBOX}`,
  ].join('; ')
}

/** One reported violation, normalised (CSP2 `application/csp-report` or Reporting API `csp-violation`). */
export type CspViolation = {
  directive: string
  /** 'inline' | 'eval' | 'data' | 'blob' | an origin | 'other'. */
  blocked: string
  /** Document path without query (tokens never stored). */
  path: string | null
}

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '')

/** Where a violation came from, reduced to something safe to store and group by. */
export function blockedSource(raw: string): string {
  const v = raw.trim().toLowerCase()
  if (!v) return 'other'
  if (v === 'inline' || v === 'eval' || v === 'wasm-eval' || v === 'trusted-types-policy') return v
  if (v === 'data' || v.startsWith('data:')) return 'data'
  if (v === 'blob' || v.startsWith('blob:')) return 'blob'
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'wss:' || u.protocol === 'ws:'
      ? u.origin
      : u.protocol.replace(/:$/, '')
  } catch {
    return 'other'
  }
}

const EXTENSION = /^(chrome|moz|safari|safari-web|ms-browser)-extension:/i

function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname.slice(0, 200)
  } catch {
    return null
  }
}

/**
 * Parses a report body into violations. Browser-extension noise (blocked or source file in an extension) is dropped;
 * anything malformed yields [].
 */
export function parseCspReports(body: unknown): CspViolation[] {
  const items: Record<string, unknown>[] = []
  if (Array.isArray(body)) {
    for (const r of body.slice(0, 20))
      if (r && typeof r === 'object' && (r as { type?: unknown }).type === 'csp-violation') {
        const b = (r as { body?: unknown }).body
        if (b && typeof b === 'object') items.push(b as Record<string, unknown>)
      }
  } else if (body && typeof body === 'object' && 'csp-report' in body) {
    const b = (body as { 'csp-report'?: unknown })['csp-report']
    if (b && typeof b === 'object') items.push(b as Record<string, unknown>)
  }
  const out: CspViolation[] = []
  for (const b of items) {
    const directive = (
      str(b.effectiveDirective, 60) ||
      str(b['effective-directive'], 60) ||
      str(b['violated-directive'], 60).split(' ')[0] ||
      ''
    ).toLowerCase()
    const blockedRaw = str(b.blockedURL, 500) || str(b['blocked-uri'], 500)
    const source = str(b.sourceFile, 500) || str(b['source-file'], 500)
    if (EXTENSION.test(blockedRaw) || EXTENSION.test(source)) continue
    if (!/^[a-z-]{3,40}$/.test(directive)) continue
    out.push({
      directive,
      blocked: blockedSource(blockedRaw),
      path: pathOf(str(b.documentURL, 500) || str(b['document-uri'], 500)),
    })
  }
  return out
}

export const CSP_SURFACES: readonly CspSurface[] = ['marketing', 'app', 'admin', 'site', 'domain']
