// Text layout for generated PDFs (F27): font fallback per character (DM Sans / Noto Sans Thai / Noto Naskh Arabic),
// a reduced Unicode Bidi Algorithm (Arabic right to left, numbers and Latin/Thai left to right, bracket pairs and
// neutrals resolved from their neighbours) and line breaking on Intl.Segmenter word boundaries (ICU dictionary
// breaks for Thai, which has no spaces between words). Shaping (Arabic joining, Thai marks) is fontkit's, through
// pdfkit: a piece of Arabic script is handed over in logical order and fontkit lays it out right to left.
import { PDF_FONT_COVERAGE } from './fonts.generated'

export type Family = keyof typeof PDF_FONT_COVERAGE
export type Piece = { text: string; family: Family; rtl: boolean }

const covers = (family: Family, cp: number) => PDF_FONT_COVERAGE[family].some(([a, b]) => cp >= a && cp <= b)

const isArabic = (cp: number) =>
  (cp >= 0x0590 && cp <= 0x08ff) || (cp >= 0xfb1d && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)
const isThai = (cp: number) => cp >= 0x0e00 && cp <= 0x0e7f
const isDigit = (cp: number) =>
  (cp >= 0x30 && cp <= 0x39) || (cp >= 0x0660 && cp <= 0x0669) || (cp >= 0x06f0 && cp <= 0x06f9)
const LETTER = /\p{L}/u

/** Bidi class, simplified: strong L / R, numbers (EN), everything else neutral. */
type Bidi = 'L' | 'R' | 'EN' | 'N'
const bidiOf = (ch: string): Bidi => {
  const cp = ch.codePointAt(0)!
  if (isDigit(cp)) return 'EN'
  if (isArabic(cp)) return 'R'
  return LETTER.test(ch) ? 'L' : 'N'
}

/** Base direction of a paragraph: its first strong letter, else the document's (numbers are not strong). */
export function baseRtl(text: string, fallbackRtl: boolean) {
  for (const ch of text) {
    const d = bidiOf(ch)
    if (d === 'L' || d === 'R') return d === 'R'
  }
  return fallbackRtl
}

const MIRROR: Record<string, string> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
  '«': '»',
  '»': '«',
}
const SEPARATORS = '.,:/+-'
const TERMINATORS = '%#$°'
const OPEN = '([{'
const CLOSE = ')]}'

/** The font family that draws `ch`, preferring the script's own font for neutrals inside that script's run. */
function familyFor(ch: string, prefer: Family): Family {
  const cp = ch.codePointAt(0)!
  if (isArabic(cp)) return 'arabic'
  if (isThai(cp)) return 'thai'
  if (prefer !== 'latin' && covers(prefer, cp)) return prefer
  if (covers('latin', cp)) return 'latin'
  if (covers('thai', cp)) return 'thai'
  if (covers('arabic', cp)) return 'arabic'
  return 'latin' // drawn as .notdef
}

/**
 * Embedding levels of one line — a reduced Unicode Bidi Algorithm: W7 (numbers after L text are L), N0 (bracket
 * pairs), N1/N2 (neutrals; numbers count as R for their neighbours) and I1/I2. No explicit embeddings.
 */
export function bidiLevels(chars: string[], rtlBase: boolean): number[] {
  const e: 'L' | 'R' = rtlBase ? 'R' : 'L'
  const t = chars.map(bidiOf)
  // W4: one separator between two numbers joins them (203.0.113.7, 14:05, 1,250); W5: % # $ ° next to a number.
  for (let i = 1; i < t.length - 1; i++)
    if (t[i] === 'N' && SEPARATORS.includes(chars[i]!) && t[i - 1] === 'EN' && t[i + 1] === 'EN') t[i] = 'EN'
  for (let i = 0; i < t.length; i++)
    if (t[i] === 'N' && TERMINATORS.includes(chars[i]!)) {
      let j = i
      while (j < t.length && t[j] === 'N' && TERMINATORS.includes(chars[j]!)) j++
      if (t[i - 1] === 'EN' || t[j] === 'EN') for (let k = i; k < j; k++) t[k] = 'EN'
      i = j - 1
    }
  let prev: 'L' | 'R' = e
  for (let i = 0; i < t.length; i++) {
    if (t[i] === 'L' || t[i] === 'R') prev = t[i] as 'L' | 'R'
    else if (t[i] === 'EN' && prev === 'L') t[i] = 'L'
  }
  const strong = (x: Bidi | undefined) => (x === 'L' ? 'L' : x === 'R' || x === 'EN' ? 'R' : null)
  const before = (i: number) => {
    for (let j = i - 1; j >= 0; j--) {
      const d = strong(t[j])
      if (d) return d
    }
    return e
  }
  const after = (i: number) => {
    for (let j = i + 1; j < t.length; j++) {
      const d = strong(t[j])
      if (d) return d
    }
    return e
  }
  // N0: both brackets of a pair take one direction — the embedding's when the pair holds such text, else the
  // other direction when the text before the pair has it too.
  const stack: { ch: string; i: number }[] = []
  const pairs: [number, number][] = []
  chars.forEach((ch, i) => {
    if (t[i] !== 'N') return
    if (OPEN.includes(ch)) stack.push({ ch, i })
    else if (CLOSE.includes(ch)) {
      const k = stack.map((s) => s.ch).lastIndexOf(OPEN[CLOSE.indexOf(ch)]!)
      if (k >= 0) {
        pairs.push([stack[k]!.i, i])
        stack.length = k
      }
    }
  })
  for (const [o, c] of pairs.sort((x, y) => x[0] - y[0])) {
    const inside = t.slice(o + 1, c).map(strong)
    let dir: 'L' | 'R' | null = null
    if (inside.includes(e)) dir = e
    else if (inside.some((d) => d && d !== e)) dir = before(o)
    if (dir) {
      t[o] = dir
      t[c] = dir
    }
  }
  const resolved = t.map((x, i) => (x === 'N' ? (before(i) === after(i) ? before(i) : e) : x))
  return resolved.map((x) => (rtlBase ? (x === 'R' ? 1 : 2) : x === 'L' ? 0 : x === 'R' ? 1 : 2))
}

/** One line of text → pieces in visual order (left to right), each in one font and direction. */
export function visualPieces(line: string, rtlBase: boolean): Piece[] {
  const chars = [...line]
  if (!chars.length) return []
  const levels = bidiLevels(chars, rtlBase)
  // L2: reverse every run at level ≥ k, from the highest level down to 1.
  const order = chars.map((_, i) => i)
  for (let k = Math.max(...levels); k >= 1; k--) {
    let i = 0
    while (i < order.length) {
      if (levels[order[i]!]! < k) {
        i++
        continue
      }
      let j = i
      while (j < order.length && levels[order[j]!]! >= k) j++
      order.splice(i, j - i, ...order.slice(i, j).reverse())
      i = j
    }
  }
  // Visually adjacent characters in the same font and direction form one piece.
  const groups: { idx: number[]; family: Family; rtl: boolean }[] = []
  for (const i of order) {
    const rtl = levels[i]! % 2 === 1
    const family = familyFor(chars[i]!, rtl ? 'arabic' : 'latin')
    const last = groups[groups.length - 1]
    if (last && last.family === family && last.rtl === rtl) last.idx.push(i)
    else groups.push({ idx: [i], family, rtl })
  }
  return groups.map(({ idx, family, rtl }) => {
    const visual = idx.map((i) => chars[i]!)
    // fontkit lays Arabic-script text out right to left, so such a piece goes in reversed: logical order for
    // right-to-left text, pre-reversed for left-to-right Arabic-Indic numbers.
    if (visual.some((ch) => isArabic(ch.codePointAt(0)!)))
      return { text: visual.reverse().join(''), family, rtl }
    return { text: (rtl ? visual.map((ch) => MIRROR[ch] ?? ch) : visual).join(''), family, rtl }
  })
}

/** Measures a piece at a size (pdfkit: font + fontSize + widthOfString). */
export type Measure = (piece: Piece, size: number) => number

const words = new Intl.Segmenter('th', { granularity: 'word' })
const graphemes = new Intl.Segmenter('th', { granularity: 'grapheme' })

/**
 * Greedy line breaking of a paragraph at word boundaries (Thai via ICU's dictionary); a word wider than the line
 * is split by grapheme. Returns each line's logical text (trailing spaces trimmed); blank input lines are kept.
 */
export function wrapLines(
  text: string,
  maxWidth: number,
  size: number,
  measure: Measure,
  rtl: boolean,
): string[] {
  const width = (s: string) => visualPieces(s.trimEnd(), rtl).reduce((sum, p) => sum + measure(p, size), 0)
  const lines: string[] = []
  for (const para of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = ''
    for (const { segment } of words.segment(para)) {
      const candidate = line + segment
      if (width(candidate) <= maxWidth) {
        line = candidate
        continue
      }
      if (line.trim()) {
        lines.push(line.trimEnd())
        line = segment.trimStart()
      } else line = candidate.trimStart()
      while (line && width(line) > maxWidth) {
        const parts = [...graphemes.segment(line)].map((g) => g.segment)
        let head = parts[0] ?? ''
        let i = 1
        while (i < parts.length && width(head + parts[i]) <= maxWidth) head += parts[i++]
        lines.push(head.trimEnd())
        line = parts.slice(i).join('').trimStart()
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}
