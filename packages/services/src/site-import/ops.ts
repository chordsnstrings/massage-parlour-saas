// Studio site import (F32): extracted pages → one ImportedSite → site-edit ops that build a NEW DRAFT page from the
// existing blocks (Hero, Section + Heading + RichText, Gallery). Pure. Images travel as placeholders
// (`/files/import-image-<n>`, a site-relative URL so dry runs validate) until Apply downloads them into the spa's media
// library and swaps in the real /files URLs (`resolveImportImages`).
import type { ImportContact, ImportImage, ImportSection, ImportService, PageExtract } from './extract'

export type ImportedSite = {
  /** Final address of the start page. */
  url: string
  host: string
  lang: 'en' | 'ar'
  pages: { url: string; title: string | null }[]
  name: string | null
  title: string | null
  description: string | null
  headline: string | null
  lead: string | null
  sections: ImportSection[]
  services: ImportService[]
  hours: string[]
  contact: ImportContact
  images: ImportImage[]
}

export const MAX_IMPORT_IMAGES = 12
export const IMPORT_IMAGE_PLACEHOLDER = '/files/import-image-'
export const importImageRef = (n: number) => `${IMPORT_IMAGE_PLACEHOLDER}${n}`

/** Start page first; later pages add sections, services, hours, contact details and images it lacks. */
export function mergeImportPages(pages: PageExtract[]): ImportedSite {
  const [first, ...rest] = pages
  if (!first) throw new Error('no pages')
  const all = [first, ...rest]
  const uniq = <T>(xs: T[], key: (x: T) => string) => {
    const seen = new Set<string>()
    return xs.filter((x) => {
      const k = key(x)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }
  const contact: ImportContact = {
    phones: uniq(
      all.flatMap((p) => p.contact.phones),
      (x) => x,
    ).slice(0, 3),
    emails: uniq(
      all.flatMap((p) => p.contact.emails),
      (x) => x,
    ).slice(0, 2),
    whatsapp: uniq(
      all.flatMap((p) => p.contact.whatsapp),
      (x) => x,
    ).slice(0, 2),
    address: all.map((p) => p.contact.address).find(Boolean) ?? null,
    instagram: all.map((p) => p.contact.instagram).find(Boolean) ?? null,
    facebook: all.map((p) => p.contact.facebook).find(Boolean) ?? null,
  }
  return {
    url: first.url,
    host: new URL(first.url).hostname.replace(/^www\./, ''),
    lang: first.lang,
    pages: all.map((p) => ({ url: p.url, title: p.title })),
    name: first.name ?? all.map((p) => p.name).find(Boolean) ?? null,
    title: first.title,
    description: first.description,
    headline: first.headline,
    lead: first.lead,
    sections: uniq(
      all.flatMap((p) => p.sections),
      (s) => s.heading.toLowerCase(),
    ).slice(0, 6),
    services: uniq(
      all.flatMap((p) => p.services),
      (s) => `${s.name.toLowerCase()}|${s.price}|${s.duration}`,
    ).slice(0, 40),
    hours: uniq(
      all.flatMap((p) => p.hours),
      (h) => h.toLowerCase(),
    ).slice(0, 8),
    contact,
    images: uniq(
      all.flatMap((p) => p.images),
      (i) => i.url,
    ).slice(0, MAX_IMPORT_IMAGES),
  }
}

type Op = Record<string, unknown> & { op: string }
const MAX = 4000

/** Imported text into a bilingual value: English always; an Arabic source also fills `ar`. */
const bi = (text: string, lang: 'en' | 'ar', ours?: { en: string; ar: string }) =>
  ours
    ? { ...ours }
    : lang === 'ar'
      ? { en: text.slice(0, MAX), ar: text.slice(0, MAX) }
      : { en: text.slice(0, MAX) }

export const serviceLine = (s: ImportService) =>
  [
    s.name,
    s.duration ? `${s.duration} min` : null,
    s.price !== null ? `AED ${s.price.toLocaleString('en-AE')}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

/** The visit-us copy: hours, address, phone, email, social links. */
export function visitLines(site: Pick<ImportedSite, 'hours' | 'contact'>) {
  const c = site.contact
  return [
    ...site.hours,
    c.address ? `Address: ${c.address}` : null,
    c.phones[0] ? `Phone: ${c.phones[0]}` : null,
    c.whatsapp[0] ? `WhatsApp: +${c.whatsapp[0].replace(/^\+/, '')}` : null,
    c.emails[0] ? `Email: ${c.emails[0]}` : null,
    c.instagram ? `Instagram: ${c.instagram}` : null,
  ].filter((l): l is string => Boolean(l))
}

/**
 * Standard mapping (no AI): ops that add page `slug` (draft, hidden until published) with a hero, one section per
 * imported heading, the price list, a visit-us section and a gallery. Images are placeholders (see above).
 */
export function buildImportOps(site: ImportedSite, o: { slug: string; title: string }): Op[] {
  const page = o.slug
  const { lang } = site
  const ops: Op[] = [{ op: 'add_page', slug: o.slug, title: { en: o.title.slice(0, 80) } }]
  const seo: Record<string, unknown> = {}
  if (site.title) seo.title = bi(site.title.slice(0, 200), lang)
  if (site.description) seo.description = bi(site.description, lang)
  if (Object.keys(seo).length) ops.push({ op: 'update', page, id: 'root', props: seo })

  const headline = site.headline ?? site.name ?? site.title ?? o.title
  const subtitle = site.description ?? site.lead ?? ''
  const hero = site.images[0]
  ops.push({
    op: 'add',
    page,
    type: 'Hero',
    props: {
      variant: hero ? 'split' : 'centered',
      eyebrow: bi(site.name && site.name !== headline ? site.name : '', lang),
      title: bi(headline.slice(0, 200), lang),
      subtitle: bi(subtitle, lang),
      image: hero ? importImageRef(0) : '',
      imageAlt: bi(hero?.alt ?? '', lang),
    },
  })
  for (const s of site.sections)
    ops.push({
      op: 'add',
      page,
      type: 'Section',
      props: {
        content: [
          { type: 'Heading', props: { text: bi(s.heading.slice(0, 200), lang), level: 'h2' } },
          { type: 'RichText', props: { text: bi(s.text.join('\n\n'), lang), tone: 'default' } },
        ],
      },
    })
  if (site.services.length)
    ops.push({
      op: 'add',
      page,
      type: 'Section',
      props: {
        content: [
          {
            type: 'Heading',
            props: {
              text: bi('', lang, { en: 'Treatments & prices', ar: 'العلاجات والأسعار' }),
              level: 'h2',
            },
          },
          {
            type: 'RichText',
            props: {
              text: bi(site.services.slice(0, 30).map(serviceLine).join('\n\n'), lang),
              tone: 'default',
            },
          },
        ],
      },
    })
  const visit = visitLines(site)
  if (visit.length)
    ops.push({
      op: 'add',
      page,
      type: 'Section',
      props: {
        content: [
          { type: 'Heading', props: { text: bi('', lang, { en: 'Visit us', ar: 'زورونا' }), level: 'h2' } },
          { type: 'RichText', props: { text: bi(visit.join('\n\n'), lang), tone: 'default' } },
        ],
      },
    })
  const gallery = site.images.slice(1, MAX_IMPORT_IMAGES)
  if (gallery.length >= 2)
    ops.push({
      op: 'add',
      page,
      type: 'Gallery',
      props: {
        title: bi('', lang, { en: 'Gallery', ar: 'معرض الصور' }),
        images: gallery.map((img, i) => ({ src: importImageRef(i + 1), alt: bi(img.alt, lang) })),
        layout: 'grid',
        columns: gallery.length >= 3 ? '3' : '2',
      },
    })
  return ops
}

/** Placeholder indexes the ops use (only those images are downloaded). */
export function usedImportImages(ops: unknown[]): number[] {
  const found = new Set<number>()
  const re = new RegExp(`${IMPORT_IMAGE_PLACEHOLDER.replace(/[/-]/g, '\\$&')}(\\d+)`, 'g')
  for (const m of JSON.stringify(ops).matchAll(re)) found.add(Number(m[1]))
  return [...found].sort((a, b) => a - b)
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Swaps placeholders for stored image URLs (`urls[n]`; missing / failed → removed: a hero image becomes empty, gallery
 * items are dropped, a gallery left with fewer than 2 images is dropped).
 */
export function resolveImportImages(ops: Op[], urls: Map<number, string>): Op[] {
  const swap = (v: unknown): unknown => {
    if (typeof v === 'string' && v.startsWith(IMPORT_IMAGE_PLACEHOLDER)) {
      const n = Number(v.slice(IMPORT_IMAGE_PLACEHOLDER.length))
      return urls.get(n) ?? ''
    }
    if (Array.isArray(v))
      return v
        .map(swap)
        .filter((x) => !(isObj(x) && 'src' in x && x.src === '' && Object.keys(x).length <= 3 && 'alt' in x))
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]))
    return v
  }
  return ops
    .map((op) => swap(op) as Op)
    .filter((op) => {
      const images = isObj(op.props) ? op.props.images : undefined
      return !(op.type === 'Gallery' && Array.isArray(images) && images.length < 2)
    })
}
