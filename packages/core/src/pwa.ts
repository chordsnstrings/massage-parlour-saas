// Installable spa dashboard (docs/PLAN.md §18.6): the app name and icon initials every spa's PWA is built from.

/** Leading words skipped when another word follows ("The Royal Spa" → "Royal Management", "Al Noor Spa" → "Noor"). */
const ARTICLES = new Set(['the', 'a', 'an', 'al', 'el', 'le', 'la', 'ال'])

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const firstGrapheme = (word: string) => graphemes.segment(word)[Symbol.iterator]().next().value?.segment ?? ''

/**
 * The name's words without punctuation: split on spaces, edge punctuation and a trailing possessive dropped
 * ("Tamara's" → "Tamara"), words that were only punctuation ("&", "-") skipped, then a leading article.
 * Arabic/Thai words stay as typed (Thai has no spaces, so a Thai name is usually one word).
 */
export function nameWords(name: string): string[] {
  const words = name
    .normalize('NFC')
    .split(/[\s​]+/u)
    .map((w) =>
      w
        .replace(/^[^\p{L}\p{N}]+/u, '')
        .replace(/[^\p{L}\p{N}\p{M}]+$/u, '')
        .replace(/['’]s$/iu, ''),
    )
    .filter(Boolean)
  return words.length > 1 && ARTICLES.has(words[0]!.toLowerCase()) ? words.slice(1) : words
}

const capitalise = (word: string) => {
  const first = firstGrapheme(word)
  return `${first.toLocaleUpperCase()}${word.slice(first.length)}`
}

/** Installed app name: the spa name's first word + " Management" ("Tamara Spa & Wellness" → "Tamara Management"). */
export function pwaAppName(spaName: string): string {
  const first = nameWords(spaName)[0]
  return `${first ? capitalise(first) : 'Spa'} Management`
}

/** Icon initials when a spa has no logo: first letters of the first two words ("Tamara Spa & Wellness" → "TS"). */
export function appInitials(spaName: string): string {
  return nameWords(spaName)
    .slice(0, 2)
    .map((w) => firstGrapheme(w).toLocaleUpperCase())
    .join('')
}

/** Initials from a slug ("sabai-spa" → "SS"): the fallback when the name's letters are in a script the icon font lacks. */
export const slugInitials = (slug: string) =>
  slug
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
