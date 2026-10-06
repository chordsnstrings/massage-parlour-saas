/** Subdomain labels we use ourselves or that would confuse customers. */
export const RESERVED_SLUGS = new Set(
  (
    'www app admin api mail email smtp imap pop ftp cdn assets static media img status help support docs blog ' +
    'customers dev staging test demo preview login logout signup register invite account accounts dashboard ' +
    'billing pay payments book booking shop store spa spas ns ns1 ns2 mx m mobile wa whatsapp instagram google'
  ).split(' '),
)

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/

export function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export type SlugCheck = { ok: true } | { ok: false; reason: string }

export function checkSlug(slug: string): SlugCheck {
  if (!SLUG.test(slug)) return { ok: false, reason: 'Use 3–40 lowercase letters, numbers or hyphens.' }
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: 'This name is reserved.' }
  return { ok: true }
}
