// R28: the console names of a design's Website content (data slots, page texts, pictures, leftovers), shared by the
// Website content field and the publish sheet's content checks, plus the page-text / picture listing they both read.
import {
  type HtmlContentLeftover,
  type HtmlContentSlot,
  type HtmlDesignImage,
  type HtmlDesignText,
  type HtmlTextAttr,
  listHtmlDesignImages,
  listHtmlDesignTexts,
} from '@spa/core'

/** Plain names for the keys designs use (anything else: the key in words). */
const KEY_LABELS: Record<string, string> = {
  label: 'Menu label',
  eyebrow: 'Small top line',
  title: 'Title',
  body: 'Text',
  text: 'Text',
  tags: 'Tags',
  cta: 'Show the buttons',
  image: 'Picture',
  still: 'Picture',
  image_alt: 'Picture description',
  focus: 'Picture focus',
  accent: 'Accent colour',
  logo_on_dark: 'Logo on dark backgrounds',
  experience_image: 'Picture',
  experience_image_alt: 'Picture description',
  whatsapp_message: 'WhatsApp message',
  whatsapp_service_message: 'WhatsApp message (with a treatment)',
}
const words = (k: string) => {
  const s = k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
/** A slot's label; `label` is a scene's menu label only inside the story, elsewhere a button's text. */
export const keyLabel = (k: string, group = '') =>
  k === 'label' && !group.startsWith('journey') ? 'Button label' : (KEY_LABELS[k] ?? words(k))

/** A group's heading: `journey[welcome]` → "Scene · Welcome", `spa.experience[1]` → "Experience 2", `booking` → "Booking". */
export function groupLabel(group: string, slots: HtmlContentSlot[]): string {
  const named = slots.find((s) => s.key === 'label' && typeof s.value === 'string' && s.value.trim())
  const m = /^(?:.*\.)?([A-Za-z_][\w]*)\[([^\]]+)\]$/.exec(group)
  if (m) {
    const base = m[1] === 'journey' ? 'Scene' : words(m[1]!).replace(/s$/, '')
    const item = /^\d+$/.test(m[2]!) ? String(Number(m[2]) + 1) : words(m[2]!)
    return `${base} · ${named ? String(named.value) : item}`
  }
  if (group === 'contact') return 'WhatsApp messages'
  return words(group.split('.').pop() ?? group)
}

export const REASONS: Record<HtmlContentLeftover['reason'], string> = {
  'other-spa': "names the design's spa",
  city: 'names another city',
  phone: 'has a phone number',
  email: 'has an email address',
  test: 'test or filler text',
  arabic: 'no Arabic yet',
  stale: 'no longer in the design',
}

/** The field row of a slot path, `text:<id>` or `picture:<id>` (an element id). */
export const rowId = (path: string) => `hc-${path.replace(/[^\w-]/g, '_')}`

export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const TAG_KINDS: Record<string, string> = { a: 'Link', button: 'Button', option: 'Option', label: 'Label' }
const ATTR_KINDS: Record<HtmlTextAttr, string> = {
  alt: 'Picture description',
  placeholder: 'Placeholder',
  'aria-label': 'Screen-reader label',
  title: 'Tooltip',
}
/** What a page text is, in plain words: "Heading", "Button", "Picture description", "Page title" … */
export function kindLabel(t: Pick<HtmlDesignText, 'kind' | 'tag' | 'attr'>): string {
  if (t.kind === 'title') return 'Page title'
  if (t.kind === 'meta') return 'Search description'
  if (t.kind === 'attr') return t.attr ? ATTR_KINDS[t.attr] : 'Text'
  return /^h[1-6]$/.test(t.tag) ? 'Heading' : (TAG_KINDS[t.tag] ?? 'Text')
}
/** A page text's field label: its kind + the design's words ("Heading: Our rituals"). */
export const textLabel = (t: HtmlDesignText) => `${kindLabel(t)}: ${clip(t.text, 40)}`

/** A leftover's name: the slot's group + key, the page text's label, or "Picture n" (n = the field's card). */
export function leftoverLabel(
  path: string,
  ctx: { slots: HtmlContentSlot[]; texts: HtmlDesignText[]; images: HtmlDesignImage[] },
): string {
  if (path.startsWith('text:')) {
    const t = ctx.texts.find((x) => x.id === path.slice(5))
    return t ? textLabel(t) : `Page text ${path.slice(5)}`
  }
  if (path.startsWith('picture:')) {
    const n = ctx.images.findIndex((x) => x.id === path.slice(8))
    return n >= 0 ? `Picture ${n + 1}` : `Picture ${path.slice(8)}`
  }
  const slot = ctx.slots.find((s) => s.path === path)
  if (!slot) return path
  const group = ctx.slots.filter((s) => s.group === slot.group)
  return `${groupLabel(slot.group, group)} · ${keyLabel(slot.key, slot.group)}`
}

export type DesignListing = { texts: HtmlDesignText[]; images: HtmlDesignImage[] }
const listings = new Map<string, DesignListing>()
const NONE: DesignListing = { texts: [], images: [] }
/** The design's page texts + pictures, listed once per stored document (`designKey`; null = not cached; last 4 kept). */
export function designListing(source: string, key: string | null): DesignListing {
  // Not loaded yet: nothing to list, and nothing cached for the key.
  if (!source) return NONE
  const hit = key ? listings.get(key) : undefined
  if (hit) return hit
  const out = { texts: listHtmlDesignTexts(source), images: listHtmlDesignImages(source) }
  if (key) {
    if (listings.size >= 4) listings.delete(listings.keys().next().value as string)
    listings.set(key, out)
  }
  return out
}
