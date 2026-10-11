/** Subdomain labels we use ourselves or that would confuse customers. */
export const RESERVED_SLUGS = new Set(
  (
    'www app admin api mail email smtp imap pop ftp cdn assets static media img status help support docs blog ' +
    'customers dev staging test demo preview login logout signup register invite account accounts dashboard ' +
    'billing pay payments book booking shop store spa spas ns ns1 ns2 mx m mobile wa whatsapp instagram google ' +
    'website files domain s oauth'
  ).split(' '),
)

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/

export function normalizeSlug(input: string): string {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
  // Runs are single hyphens now: drop one at each end (no `-+$` regex, quadratic on long hyphen runs).
  const start = s.startsWith('-') ? 1 : 0
  const end = s.endsWith('-') && s.length > start ? s.length - 1 : s.length
  return s.slice(start, end).slice(0, 40)
}

export type SlugCheck = { ok: true } | { ok: false; reason: string }

export function checkSlug(slug: string): SlugCheck {
  if (!SLUG.test(slug)) return { ok: false, reason: 'Use 3–40 lowercase letters, numbers or hyphens.' }
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: 'This name is reserved.' }
  return { ok: true }
}
