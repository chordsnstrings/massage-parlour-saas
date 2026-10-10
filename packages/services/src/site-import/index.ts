// Studio "Import from existing website" (F32): fetch a spa's public site (robots.txt respected, SSRF-guarded, time +
// size caps), extract its content, map it to a new DRAFT page through the site-edit ops layer (dry run first), and
// on Apply download its images into the spa's media library. Nothing here publishes. Network work happens outside
// the DB transaction; callers audit and check permissions.

import type { Tx } from '@spa/db'
import { DomainError } from '../errors'
import { createAsset, type ProcessedImage, processImage, sniffImageType } from '../media'
import { extractPage, linksToFollow, type PageExtract } from './extract'
import { type ImportedSite, mergeImportPages } from './ops'
import { parseRobots, type RobotsGroup, robotsAllows } from './robots'
import {
  IMPORT_BOT_TOKEN,
  ImportBlockedError,
  ImportFetchError,
  type SafeFetchOpts,
  safeFetch,
} from './safe-fetch'

export * from './extract'
export * from './ops'
export * from './robots'
export * from './safe-fetch'

export const IMPORT_MAX_PAGES = 5
export const IMPORT_PAGE_BYTES = 2 * 1024 * 1024
export const IMPORT_IMAGE_BYTES = 8 * 1024 * 1024
/** Whole crawl budget (start page + followed pages). */
export const IMPORT_DEADLINE_MS = 30_000

export type CrawlOpts = Pick<SafeFetchOpts, 'resolve' | 'allow' | 'isBlocked' | 'ports'> & {
  maxPages?: number
  deadlineMs?: number
}

/** "spa.ae" / "https://spa.ae/x" → URL (https assumed without a scheme); anything else → DomainError. */
export function normaliseImportUrl(input: string): URL {
  const raw = input.trim()
  if (!raw || raw.length > 500) throw new DomainError('Enter the address of the spa’s current website')
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`
  let u: URL
  try {
    u = new URL(withScheme)
  } catch {
    throw new DomainError('That address isn’t valid')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    throw new DomainError('Only http:// and https:// addresses can be imported')
  u.hash = ''
  return u
}

function decode(body: Buffer, charset: string | null) {
  const head = body.subarray(0, 2048).toString('latin1')
  const metaCharset = head.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)?.[1]
  for (const label of [charset, metaCharset, 'utf-8']) {
    if (!label) continue
    try {
      return new TextDecoder(label).decode(body)
    } catch {
      // unknown label → next
    }
  }
  return body.toString('utf8')
}

const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml', ''])

/**
 * Reads the site: robots.txt of each origin (5xx / unreachable = don't crawl, per RFC 9309; 4xx = no rules), the start
 * page (≤ 2 MB, 10 s), then up to 4 same-site pages that look like services / prices / contact / about. Followed pages
 * that fail are skipped; the start page failing is an error the user sees.
 */
export async function crawlSiteForImport(
  input: string,
  opts: CrawlOpts = {},
): Promise<{ site: ImportedSite; skipped: { url: string; reason: string }[] }> {
  const start = normaliseImportUrl(input)
  const deadline = Date.now() + (opts.deadlineMs ?? IMPORT_DEADLINE_MS)
  const guard = { resolve: opts.resolve, allow: opts.allow, isBlocked: opts.isBlocked, ports: opts.ports }
  const left = () => Math.max(500, deadline - Date.now())
  /** Rules per origin; `unreachable` = robots.txt answered 5xx or not at all (RFC 9309: don't crawl). */
  const robots = new Map<string, RobotsGroup[] | 'unreachable'>()
  const allowed = async (u: URL) => {
    let rules = robots.get(u.origin)
    if (!rules) {
      try {
        const r = await safeFetch(`${u.origin}/robots.txt`, {
          ...guard,
          maxBytes: 512 * 1024,
          timeoutMs: Math.min(6000, left()),
          accept: 'text/plain,*/*;q=0.5',
        })
        rules = r.status >= 500 ? 'unreachable' : r.status >= 400 ? [] : parseRobots(r.body.toString('utf8'))
      } catch (e) {
        // A refused address (private network, port, scheme) is the user's answer; anything else = unreachable.
        if (e instanceof ImportBlockedError) throw e
        rules = 'unreachable'
      }
      robots.set(u.origin, rules)
    }
    if (rules === 'unreachable') return 'unreachable' as const
    return robotsAllows(rules, IMPORT_BOT_TOKEN, `${u.pathname}${u.search}`)
  }
  const page = async (u: URL): Promise<PageExtract> => {
    const r = await safeFetch(u.toString(), {
      ...guard,
      maxBytes: IMPORT_PAGE_BYTES,
      timeoutMs: Math.min(10_000, left()),
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    })
    if (r.status !== 200) throw new ImportFetchError(`The site answered ${r.status} for ${u.pathname}`)
    if (!HTML_TYPES.has(r.contentType)) throw new ImportFetchError('That address is not a web page')
    const final = new URL(r.url)
    if (final.origin !== u.origin && (await allowed(final)) !== true)
      throw new ImportFetchError(`robots.txt of ${final.hostname} asks bots not to read this page`)
    return extractPage(decode(r.body, r.charset), r.url)
  }

  const ok = await allowed(start)
  if (ok === 'unreachable')
    throw new DomainError(
      `${start.hostname} didn’t answer (its robots.txt couldn’t be read) — check the address and try again`,
    )
  if (!ok)
    throw new DomainError(
      `robots.txt of ${start.hostname} asks bots not to read this page, so it can’t be imported. Ask the spa for the content instead.`,
    )
  const first = await page(start)
  const pages = [first]
  const skipped: { url: string; reason: string }[] = []
  for (const link of linksToFollow(first, (opts.maxPages ?? IMPORT_MAX_PAGES) - 1)) {
    if (deadline - Date.now() < 1500) {
      skipped.push({ url: link, reason: 'time limit' })
      continue
    }
    try {
      const u = new URL(link)
      if ((await allowed(u)) !== true) {
        skipped.push({ url: link, reason: 'robots.txt' })
        continue
      }
      pages.push(await page(u))
    } catch (e) {
      skipped.push({ url: link, reason: e instanceof DomainError ? e.message : 'failed' })
    }
  }
  return { site: mergeImportPages(pages), skipped }
}

/**
 * Downloads one imported image under the same SSRF rules (≤ 8 MB, image types by magic bytes, no SVG) and re-encodes
 * it for the media library. Do this outside the DB transaction.
 */
export async function fetchImportImage(url: string, opts: CrawlOpts = {}): Promise<ProcessedImage> {
  const r = await safeFetch(url, {
    resolve: opts.resolve,
    allow: opts.allow,
    isBlocked: opts.isBlocked,
    ports: opts.ports,
    maxBytes: IMPORT_IMAGE_BYTES,
    timeoutMs: 10_000,
    accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9',
  })
  if (r.status !== 200) throw new ImportFetchError(`The image host answered ${r.status}`)
  if (r.contentType.includes('svg') || !sniffImageType(r.body))
    throw new ImportFetchError('That file isn’t an image we can use')
  return processImage(r.body)
}

/** Stores downloaded images in the spa's media library (tag `import`), inside the caller's tenant tx. */
export async function saveImportImages(
  tx: Tx,
  input: {
    tenantId: string
    userId: string
    host: string
    images: { n: number; image: ProcessedImage; alt: string }[]
  },
) {
  const urls = new Map<number, string>()
  for (const img of input.images) {
    const row = await createAsset(tx, {
      tenantId: input.tenantId,
      image: img.image,
      source: 'upload',
      filename: `import-${input.host}-${img.n + 1}`,
      alt: { en: img.alt || undefined },
      tags: ['import', input.host],
      createdBy: input.userId,
    })
    urls.set(img.n, row.url)
  }
  return urls
}
