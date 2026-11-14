// R28 P3 (docs/design/r28-dynamic-html-designs.md §4): pairing a contract design's own services (its CRM_DATA
// `services[]`) with the spa's CRM services when a super-admin fills the CRM from the design. The live merge
// (`mergeCrmContract`) only pairs by identity (same normalised name or the slug as id); seeding also accepts the near
// names designs tend to use ("Moroccan bath or jacuzzi" ↔ "Morocco Bath or Jacuzzi", "4-hands" ↔ "Four Hands").
// Pure, no I/O.
import { crmName, crmSlug } from './html-crm'

/** Lowest score at which a design service pairs with a CRM service. */
export const SEED_MATCH_MIN = 0.5
/** Highest score of a near (not identical) name: an exact name / slug match (1) always ranks first. */
const NEAR_MAX = 0.95

const NUMBER_WORDS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
}
/** Joining words that say nothing about the treatment ("bath or jacuzzi", "massage with oil"). */
const STOP_WORDS = new Set(['a', 'an', 'and', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'with'])
/** Two words are the same when they share at least this many leading letters (moroccan ↔ morocco). */
const PREFIX_MIN = 5

/** The words of a name: `crmName`, digits split from letters (4hands), number words as digits, plurals singular. */
function words(s: unknown): string[] {
  const all = crmName(s)
    .replace(/(\p{N})(\p{L})/gu, '$1 $2')
    .replace(/(\p{L})(\p{N})/gu, '$1 $2')
    .split(' ')
    .filter(Boolean)
    .map(
      (w) => NUMBER_WORDS[w] ?? (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w),
    )
  const kept = all.filter((w) => !STOP_WORDS.has(w))
  return [...new Set(kept.length ? kept : all)]
}

function sameWord(a: string, b: string) {
  if (a === b) return true
  if (a.length < PREFIX_MIN || b.length < PREFIX_MIN) return false
  for (let i = 0; i < PREFIX_MIN; i++) if (a[i] !== b[i]) return false
  return true
}

/** Token Jaccard with near words counted as equal (each word pairs once). */
function jaccard(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0
  const used = new Set<number>()
  let shared = 0
  for (const w of a) {
    const j = b.findIndex((x, k) => !used.has(k) && sameWord(w, x))
    if (j >= 0) {
      used.add(j)
      shared++
    }
  }
  return shared / (a.length + b.length - shared)
}

/** A design service as the matcher sees it: its name and id (designs often use the slug as id). */
export type SeedDesignItem = { name?: unknown; id?: unknown }
/** A CRM service as the matcher sees it: its names (EN, AR) and slug (`crmSlug` of the English name if omitted). */
export type SeedCrmItem = { names: readonly unknown[]; slug?: unknown }

/**
 * How well a design service names a CRM service, 0..1: 1 = the same normalised name (`crmName`) or the design's id is
 * the CRM slug (`crmSlug`); otherwise the token Jaccard of the names (number words = digits, plurals singular, joining
 * words ignored, words sharing a 5-letter prefix equal), at most 0.95. Pairs at `SEED_MATCH_MIN` (0.5) or more.
 */
export function crmMatchScore(design: SeedDesignItem, crm: SeedCrmItem): number {
  const names = crm.names.map(crmName).filter(Boolean)
  if (!names.length) return 0
  const slug = crmSlug(crm.slug) || crmSlug(names[0])
  const name = crmName(design.name)
  const id = crmSlug(design.id)
  if (name && names.includes(name)) return 1
  if (id && (id === slug || names.some((n) => crmSlug(n) === id))) return 1
  let best = 0
  for (const own of [name, crmName(design.id)]) {
    if (!own) continue
    const a = words(own)
    for (const n of names) best = Math.max(best, jaccard(a, words(n)))
  }
  return Math.min(best, NEAR_MAX)
}

/** The CRM service a design service pairs with (index into the CRM list) and its score. */
export type SeedPair = { crm: number; score: number }

/**
 * The best unique pairing of design services with CRM services: every pair scoring at least `min`, highest score
 * first (ties: design order, then CRM order); each side pairs at most once. One entry per design service, in order:
 * its pair, or null (no CRM service is close enough, or a closer design service took it).
 */
export function designSeedPairs(
  design: readonly SeedDesignItem[],
  crm: readonly SeedCrmItem[],
  min = SEED_MATCH_MIN,
): (SeedPair | null)[] {
  const candidates: { d: number; c: number; score: number }[] = []
  design.forEach((item, d) => {
    crm.forEach((other, c) => {
      const score = crmMatchScore(item, other)
      if (score >= min) candidates.push({ d, c, score })
    })
  })
  candidates.sort((x, y) => y.score - x.score || x.d - y.d || x.c - y.c)
  const pairs: (SeedPair | null)[] = design.map(() => null)
  const taken = new Set<number>()
  for (const { d, c, score } of candidates) {
    if (pairs[d] || taken.has(c)) continue
    pairs[d] = { crm: c, score }
    taken.add(c)
  }
  return pairs
}
