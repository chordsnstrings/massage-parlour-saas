// contract.inline (owner 2026-10-13 "i don't want to see delay when i reload the website"; @spa/core html-crm-inline,
// docs/design/html-crm-contract.md): the first-screen pictures a contract design asks for, delivered as data: URIs
// inside window.CRM_DATA on the live page and share links (the sandboxed design document reuses nothing from the
// browser cache on a reload). Bytes are read here, never fetched from a URL: this spa's own public /files (its
// tenant transaction) and the static public/designs files. Process-wide cache ≤ 32 MB; a render waits ≤ 300 ms for
// reads (a late one fills the cache for the next load). Decision B (owner 2026-10-14): contract.inline_fonts — the
// static design woff2 fonts one locale's page needs (BE RELAX's Arabic faces) as `inline_fonts`, that locale only,
// with the same deadline (both plans run together), cache and host rules (fonts ≤ 150 KB each, ≤ 400 KB a page).
import { open } from 'node:fs/promises'
import path from 'node:path'
import {
  type CrmContract,
  type CrmInline,
  type CrmInlineFonts,
  type CrmLocale,
  createCrmInlineLoader,
  crmDesignData,
  crmInlineFontUrls,
  crmInlinePaths,
  crmInlineSource,
  crmValueAt,
  type HtmlDesignContent,
  htmlDesignDocOf,
  matchRoot,
  planCrmInline,
  planCrmInlineFonts,
} from '@spa/core'
import { withTenant } from '@spa/db'
import { crmInlineFileBytes, crmInlineFiles } from '@spa/services'
import { designContract, designCrmData, designKey } from '@/components/site/html-crm'
import { platformRoots } from '@/server/origin'
import { resolveSiteTenant } from '@/server/sites'

/** public/ of the web app: the standalone server runs from apps/web (cwd), dev and tests from apps/web or the repo. */
const PUBLIC_DIRS = [path.join(process.cwd(), 'public'), path.join(process.cwd(), 'apps', 'web', 'public')]

async function readDesignFile(design: string, name: string, max: number): Promise<Uint8Array | null> {
  for (const dir of PUBLIC_DIRS) {
    const root = path.join(dir, 'designs')
    const file = path.join(root, design, name)
    // core already allows only [a-z0-9-] / [A-Za-z0-9_-].ext names: this keeps it inside public/designs regardless.
    if (!file.startsWith(`${root}${path.sep}`)) return null
    // One open file handle for the check and the read, so the file checked is the file read.
    const handle = await open(file, 'r').catch(() => null)
    if (!handle) continue
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > max) return null
      const bytes = await handle.readFile()
      return bytes.length <= max ? bytes : null
    } finally {
      await handle.close()
    }
  }
  return null
}

const g = globalThis as unknown as { __spaCrmInline?: ReturnType<typeof createCrmInlineLoader> }
g.__spaCrmInline ??= createCrmInlineLoader({
  // One tenant transaction per spa and tick for the file rows; bucket downloads (5 s limit) only after it returned.
  readFiles: async (tenantId, ids, max) => {
    const refs = await withTenant(tenantId, (tx) => crmInlineFiles(tx, tenantId, ids, max))
    return new Map(ids.map((id) => [id, crmInlineFileBytes(refs.get(id), max)]))
  },
  readDesign: readDesignFile,
  maxBytes: 32 * 1024 * 1024,
})
const loader = g.__spaCrmInline

const bare = (host: string) => host.replace(/:\d+$/, '')

/**
 * Which hosts a picture url may name: the platform's domains (and their subdomains: spa addresses, app) and this
 * spa's own active domains (the 60 s site-host cache). Only the hosts the data actually names are looked up.
 */
async function hostCheck(tenantId: string, urls: unknown[]): Promise<(host: string) => boolean> {
  const roots = platformRoots()
  const platform = (host: string) => matchRoot(host, roots) !== null
  const own = new Set<string>()
  const asked = new Set<string>()
  for (const url of urls)
    crmInlineSource(url, (host) => {
      if (!platform(host)) asked.add(bare(host))
      return false
    })
  for (const host of asked) {
    const t = await resolveSiteTenant({ hostname: host })
    if (t?.id === tenantId) own.add(host)
  }
  return (host) => platform(host) || own.has(bare(host))
}

/** What one design render inlines: `inline` pictures, `fonts` (designWithCrm's opts of the same names); null = none. */
export type CrmInlineRender = { inline: CrmInline | null; fonts: CrmInlineFonts | null }
const NOTHING: CrmInlineRender = { inline: null, fonts: null }

/** The inline plans of one design render (same inputs as designWithCrm). */
export async function crmInlinePlan(
  tenant: { id: string },
  html: string,
  key: string | null,
  crm: CrmContract | null | undefined,
  opts: { inject: boolean; content?: HtmlDesignContent | null; locale?: CrmLocale },
): Promise<CrmInlineRender> {
  const locale = opts.locale ?? 'en'
  // Designs without contract.inline / inline_fonts for this locale pay one cached parse.
  const found = designContract(html, key)?.found
  const own = found ? crmDesignData(found) : null
  if (!own || (!crmInlinePaths(own).length && !crmInlineFontUrls(own, locale).length)) return NOTHING
  const data = designCrmData(html, key, crm, opts)
  if (!data) return NOTHING
  const paths = crmInlinePaths(data)
  const fonts = crmInlineFontUrls(data, locale)
  if (!paths.length && !fonts.length) return NOTHING
  const ourHost = await hostCheck(tenant.id, [...paths.map((p) => crmValueAt(data, p)), ...fonts])
  // One deadline for both: the plans run together.
  const [inline, fontPlan] = await Promise.all([
    paths.length ? planCrmInline(data, { ourHost, load: (src) => loader.load(tenant.id, src) }) : null,
    fonts.length ? planCrmInlineFonts(data, locale, { ourHost, load: loader.loadFont }) : null,
  ])
  return { inline, fonts: fontPlan }
}

/**
 * The plans of a page's HtmlDesign blocks (framed renders: the live page with Phone fixes on, share links) by
 * designKey ('' = an inline legacy design) → `SiteMeta.crmInline` / `SiteMeta.crmFonts`. `data` has its design files
 * filled in.
 */
export async function pageCrmInline(
  tenant: { id: string },
  data: unknown,
  crm: CrmContract | null | undefined,
  opts: { locale: CrmLocale },
): Promise<{ crmInline?: Record<string, CrmInline>; crmFonts?: Record<string, CrmInlineFonts> }> {
  const content = (data as { content?: { type?: unknown; props?: Record<string, unknown> }[] } | null)
    ?.content
  const pictures: Record<string, CrmInline> = {}
  const fonts: Record<string, CrmInlineFonts> = {}
  for (const n of Array.isArray(content) ? content : []) {
    const props = n?.type === 'HtmlDesign' ? n.props : undefined
    if (!props || typeof props.html !== 'string' || !props.html) continue
    const key = designKey(htmlDesignDocOf(props))
    const plan = await crmInlinePlan(tenant, props.html, key, crm, {
      inject: true,
      content: props.content as HtmlDesignContent | undefined,
      locale: opts.locale,
    })
    if (plan.inline) pictures[key ?? ''] = plan.inline
    if (plan.fonts) fonts[key ?? ''] = plan.fonts
  }
  return {
    ...(Object.keys(pictures).length ? { crmInline: pictures } : {}),
    ...(Object.keys(fonts).length ? { crmFonts: fonts } : {}),
  }
}
