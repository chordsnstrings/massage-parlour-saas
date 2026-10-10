// F15 extra site blocks (PLAN §11.4): Map, Video, Google reviews, Instagram feed, Blog list, Enquiry form. Server-safe
// renders like the other blocks; only the video poster and the enquiry form ship client JS. Data-bound blocks read
// SiteMeta.data (loaded per request in data.ts) and render nothing on the live site when there's nothing to show —
// the editor shows a note instead.
import type { ComponentConfig } from '@puckeditor/core'
import { mapEmbedSrc, parseVideoUrl, videoEmbedSrc, youtubePoster } from '@spa/core'
import { imageSrc, postBlocks } from '@spa/services/site-kit'
import { ArrowLeft, Camera, MapPin, MessageCircle, Phone, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { biField, imageField, radio, select, videoField } from '../field-defs'
import { longDate, tr, ui } from '../i18n'
import { addressLinkProps, bookHref, linkProps, mapHref, pageHref, phoneHref, whatsappHref } from '../links'
import type { Bi, SiteMeta } from '../types'
import { SiteEnquiryForm } from './enquiry-form'
import { bandFields, SectionShell, type ShellProps } from './layout'
import { metaOf, SectionTitle } from './shared'
import { VideoPlayer } from './video-player'

type Band = Omit<ShellProps, 'width' | 'bgImage' | 'anchor'>
const band: Band = { background: 'none', padding: { base: 'lg' } }

/** What a data block shows in the editor when the live site would show nothing (never rendered publicly). */
function EditorNote({ meta, children }: { meta: SiteMeta; children: React.ReactNode }) {
  if (!meta.editing) return null
  return (
    <div className="mx-auto my-4 max-w-6xl px-5 sm:px-8">
      <p
        data-editor-note=""
        className="rounded-[var(--radius)] border border-dashed px-4 py-3 text-sm text-muted"
      >
        {children}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ Map */

const MAP_HEIGHT = { sm: 'h-64', md: 'h-80 md:h-96', lg: 'h-96 md:h-[32rem]' } as const

export const MapBlock: ComponentConfig<
  Band & { title: Bi; intro: Bi; layout: 'card' | 'split' | 'embed' | 'map'; height: keyof typeof MAP_HEIGHT }
> = {
  label: 'Map',
  fields: {
    title: biField('Title'),
    intro: biField('Intro', { multiline: true }),
    layout: radio('Layout', [
      ['split', 'Card + map'],
      ['embed', 'Map, card below'],
      ['map', 'Map only'],
      ['card', 'Card only (no Google embed)'],
    ]),
    height: radio('Map height', [
      ['sm', 'S'],
      ['md', 'M'],
      ['lg', 'L'],
    ]),
    ...bandFields,
  },
  defaultProps: {
    ...band,
    title: { en: 'Find us', ar: 'موقعنا' },
    intro: { en: '' },
    layout: 'split',
    height: 'md',
  },
  render: ({ puck, title, intro, layout, height, ...shell }) => {
    const meta = metaOf(puck)
    const branch = meta.data.branch
    const href = mapHref(meta)
    if (!href)
      return (
        <EditorNote meta={meta}>Map: add the branch address (or a Google Maps link) in Settings.</EditorNote>
      )
    const embed = layout === 'card' ? null : mapEmbedSrc(branch, meta.locale)
    const phone = phoneHref(meta)
    const wa = whatsappHref(meta)
    const card = (
      <div className="sb-card flex flex-col justify-center gap-5 border bg-surface p-6 sm:p-8">
        {branch?.address && (
          <p className="flex gap-3 text-[15px]">
            <MapPin className="mt-0.5 size-5 shrink-0 text-muted" strokeWidth={1.5} />
            <a {...addressLinkProps(meta)} className="text-inherit hover:underline">
              {branch.address}
            </a>
          </p>
        )}
        {branch?.phone && phone && (
          <p className="flex gap-3 text-[15px]">
            <Phone className="mt-0.5 size-5 shrink-0 text-muted" strokeWidth={1.5} />
            <a {...linkProps(meta, phone)} dir="ltr" className="hover:underline">
              {branch.phone}
            </a>
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <a {...linkProps(meta, href)} data-maps-link="" className="sb-btn sb-btn-primary">
            <MapPin strokeWidth={1.75} />
            {ui('openInMaps', meta.locale)}
          </a>
          {wa && (
            <a {...linkProps(meta, wa)} className="sb-btn sb-btn-secondary">
              <MessageCircle strokeWidth={1.75} />
              {ui('whatsapp', meta.locale)}
            </a>
          )}
        </div>
      </div>
    )
    const frame = embed && (
      <div
        className={cn(
          'sb-card relative overflow-hidden border bg-subtle',
          MAP_HEIGHT[height] ?? MAP_HEIGHT.md,
        )}
      >
        {meta.editing ? (
          // No Google iframe in the editor canvas (it would swallow clicks); the live site loads it lazily.
          <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:18px_18px]">
            <span className="flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-sm text-muted shadow">
              <MapPin className="size-4" /> Google Maps
            </span>
          </div>
        ) : (
          <iframe
            src={embed}
            title={`${ui('mapOf', meta.locale)} — ${meta.data.tenant.name}`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            className="absolute inset-0 size-full border-0"
            data-map-embed=""
          />
        )}
      </div>
    )
    return (
      <SectionShell meta={meta} {...shell}>
        <SectionTitle title={title} intro={intro} meta={meta} />
        {layout === 'map' && frame ? (
          frame
        ) : layout === 'split' && frame ? (
          <div className="grid gap-6 md:grid-cols-[2fr_3fr] md:items-stretch">
            {card}
            {frame}
          </div>
        ) : (
          <div className="space-y-6">
            {frame}
            {card}
          </div>
        )}
      </SectionShell>
    )
  },
}

/* ------------------------------------------------------------------ Video */

const ASPECT = {
  '16:9': 'aspect-video',
  '4:3': 'aspect-[4/3]',
  '1:1': 'aspect-square',
  '9:16': 'aspect-[9/16] max-h-[80vh] mx-auto',
} as const
const PROVIDER = { youtube: 'YouTube', vimeo: 'Vimeo' } as const

export const Video: ComponentConfig<
  Band & {
    title: Bi
    intro: Bi
    url: string
    poster: string
    caption: Bi
    aspect: keyof typeof ASPECT
    size: 'narrow' | 'contained'
  }
> = {
  label: 'Video',
  fields: {
    title: biField('Title'),
    intro: biField('Intro', { multiline: true }),
    url: videoField('Video (YouTube, Vimeo or upload)'),
    poster: imageField('Poster image (optional)'),
    caption: biField('Caption'),
    aspect: radio('Shape', [
      ['16:9', '16:9'],
      ['4:3', '4:3'],
      ['1:1', 'Square'],
      ['9:16', 'Portrait'],
    ]),
    size: radio('Width', [
      ['narrow', 'Narrow'],
      ['contained', 'Wide'],
    ]),
    ...bandFields,
  },
  defaultProps: {
    ...band,
    title: { en: '' },
    intro: { en: '' },
    url: '',
    poster: '',
    caption: { en: '' },
    aspect: '16:9',
    size: 'contained',
  },
  render: ({ puck, title, intro, url, poster, caption, aspect, size, ...shell }) => {
    const meta = metaOf(puck)
    const video = parseVideoUrl(url)
    if (!video)
      return <EditorNote meta={meta}>Video: paste a YouTube or Vimeo link, or upload a video.</EditorNote>
    const ratio = ASPECT[aspect] ?? ASPECT['16:9']
    const name = tr(title, meta) || tr(caption, meta) || meta.data.tenant.name
    const posterSrc = imageSrc(poster) || (video.provider === 'youtube' ? youtubePoster(video.id) : null)
    const embed = videoEmbedSrc(video)
    return (
      <SectionShell meta={meta} {...shell} width={size === 'narrow' ? 'narrow' : 'contained'}>
        <SectionTitle title={title} intro={intro} meta={meta} />
        <figure className="m-0">
          {video.provider === 'file' ? (
            // Uploaded clip: plays from /files, nothing downloads before play (preload none).
            // biome-ignore lint/a11y/useMediaCaption: spa-uploaded promo clips have no caption track
            <video
              src={video.src}
              poster={posterSrc ?? undefined}
              controls
              preload="none"
              playsInline
              aria-label={name}
              className={cn('sb-card block w-full bg-black object-cover', ratio)}
            />
          ) : (
            embed && (
              <VideoPlayer
                embedSrc={embed}
                poster={posterSrc}
                title={name}
                playLabel={ui('playVideo', meta.locale)}
                notice={`${ui('playsFrom', meta.locale)} ${PROVIDER[video.provider]}`}
                aspect={ratio}
                inert={meta.editing}
              />
            )
          )}
          {tr(caption, meta) && (
            <figcaption className="mt-3 text-center text-sm text-muted">{tr(caption, meta)}</figcaption>
          )}
        </figure>
      </SectionShell>
    )
  },
}

/* ------------------------------------------------------------------ Google reviews (Premium) */

function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn('inline-flex gap-0.5 text-[#f5a623]', className)} aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn('size-4', n <= Math.round(value) ? 'fill-current' : 'opacity-30')}
          strokeWidth={1.25}
        />
      ))}
    </span>
  )
}

export const Reviews: ComponentConfig<
  Band & { title: Bi; intro: Bi; count: '3' | '6' | '9'; minRating: '4' | '5'; showSummary: boolean }
> = {
  label: 'Google reviews',
  fields: {
    title: biField('Title'),
    intro: biField('Intro', { multiline: true }),
    count: select('Reviews shown', [
      ['3', '3'],
      ['6', '6'],
      ['9', '9'],
    ]),
    minRating: radio('Lowest rating shown', [
      ['4', '4 ★ and up'],
      ['5', '5 ★ only'],
    ]),
    showSummary: radio('Average rating', [
      [true, 'Show'],
      [false, 'Hide'],
    ]),
    ...bandFields,
  },
  defaultProps: {
    ...band,
    title: { en: 'What our guests say', ar: 'ماذا يقول ضيوفنا' },
    intro: { en: '' },
    count: '3',
    minRating: '4',
    showSummary: true,
  },
  render: ({ puck, title, intro, count, minRating, showSummary, ...shell }) => {
    const meta = metaOf(puck)
    const data = meta.data.reviews
    if (data === null)
      return (
        <EditorNote meta={meta}>
          Google reviews are a Premium feature — this block stays hidden on this spa&rsquo;s plan.
        </EditorNote>
      )
    const items = (data?.items ?? [])
      .filter((r) => r.rating >= Number(minRating))
      .slice(0, Number(count) || 3)
    if (!data || !items.length)
      return (
        <EditorNote meta={meta}>
          Google reviews: none synced yet — connect Google Business in Settings → Integrations. Hidden until
          then.
        </EditorNote>
      )
    const google = meta.data.branch?.mapsUrl ? mapHref(meta) : null
    return (
      <SectionShell meta={meta} {...shell}>
        <SectionTitle title={title} intro={intro} meta={meta} />
        {showSummary && data.count > 0 && (
          <div className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-2" data-reviews-summary="">
            <span className="sb-heading text-4xl tabular-nums" dir="ltr">
              {data.average.toFixed(1)}
            </span>
            <span className="flex flex-col gap-1">
              <Stars value={data.average} />
              <span className="text-sm text-muted">
                <span className="sr-only">
                  {data.average.toFixed(1)} {ui('outOf5', meta.locale)} ·{' '}
                </span>
                <span dir="ltr">{data.count}</span> {ui('googleReviews', meta.locale)}
              </span>
            </span>
            {google && (
              <a {...linkProps(meta, google)} className="sb-btn sb-btn-link ms-auto">
                {ui('seeOnGoogle', meta.locale)}
              </a>
            )}
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          {items.map((r) => (
            <figure key={r.id} className="sb-card m-0 flex flex-col gap-4 border bg-surface p-6">
              <Stars value={r.rating} />
              <span className="sr-only">
                {r.rating} {ui('outOf5', meta.locale)}
              </span>
              {/* Review text is the guest's own words (never translated). */}
              <blockquote className="sb-prose m-0 line-clamp-6 text-[15px]" dir="auto">
                “{r.text}”
              </blockquote>
              <figcaption className="mt-auto text-sm text-muted">
                <span className="font-medium text-fg" dir="auto">
                  {r.author}
                </span>
                {r.reviewedAt && ` · ${longDate(r.reviewedAt, meta.locale)}`}
              </figcaption>
            </figure>
          ))}
        </div>
      </SectionShell>
    )
  },
}

/* ------------------------------------------------------------------ Instagram feed (Premium) */

export const InstagramFeed: ComponentConfig<
  Band & { title: Bi; intro: Bi; count: '3' | '6' | '9' | '12'; showFollow: boolean }
> = {
  label: 'Instagram feed',
  fields: {
    title: biField('Title'),
    intro: biField('Intro', { multiline: true }),
    count: select('Posts shown', [
      ['3', '3'],
      ['6', '6'],
      ['9', '9'],
      ['12', '12'],
    ]),
    showFollow: radio('Follow button', [
      [true, 'Show'],
      [false, 'Hide'],
    ]),
    ...bandFields,
  },
  defaultProps: {
    ...band,
    title: { en: 'On Instagram', ar: 'على إنستغرام' },
    intro: { en: '' },
    count: '6',
    showFollow: true,
  },
  render: ({ puck, title, intro, count, showFollow, ...shell }) => {
    const meta = metaOf(puck)
    const data = meta.data.instagram
    if (data === null)
      return (
        <EditorNote meta={meta}>
          The Instagram feed is a Premium feature — this block stays hidden on this spa&rsquo;s plan.
        </EditorNote>
      )
    const items = (data?.items ?? []).slice(0, Number(count) || 6)
    if (!data || !items.length)
      return (
        <EditorNote meta={meta}>
          Instagram feed: no posts yet — connect Instagram and publish posts from the dashboard. Hidden until
          then.
        </EditorNote>
      )
    const profile = data.profileUrl
    return (
      <SectionShell meta={meta} {...shell}>
        <SectionTitle title={title} intro={intro} meta={meta} />
        <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3 sm:gap-3">
          {items.map((p) => (
            <li key={p.id}>
              <a
                {...linkProps(meta, profile)}
                className="sb-card group relative block aspect-square overflow-hidden bg-subtle"
              >
                {/* biome-ignore lint/performance/noImgElement: tenant-site markup, stored post image */}
                <img
                  src={p.image}
                  alt={p.caption || ui('instagramPost', meta.locale)}
                  loading="lazy"
                  className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </a>
            </li>
          ))}
        </ul>
        {showFollow && profile && data.username && (
          <div className="mt-8 flex justify-center">
            <a {...linkProps(meta, profile)} className="sb-btn sb-btn-secondary">
              <Camera strokeWidth={1.75} />
              {ui('followInstagram', meta.locale)} <span dir="ltr">@{data.username}</span>
            </a>
          </div>
        )}
      </SectionShell>
    )
  },
}

/* ------------------------------------------------------------------ Blog list */

/** Public URL of a blog post (`{site}/blog/{slug}`). */
export const postHref = (meta: Pick<SiteMeta, 'base' | 'locale'>, slug: string) =>
  pageHref(meta, `blog/${slug}`)

export const BlogList: ComponentConfig<
  Band & { title: Bi; intro: Bi; count: '3' | '6' | '9'; layout: 'grid' | 'list' }
> = {
  label: 'Blog posts',
  fields: {
    title: biField('Title'),
    intro: biField('Intro', { multiline: true }),
    count: select('Posts shown', [
      ['3', '3'],
      ['6', '6'],
      ['9', '9'],
    ]),
    layout: radio('Layout', [
      ['grid', 'Cards'],
      ['list', 'List'],
    ]),
    ...bandFields,
  },
  defaultProps: {
    ...band,
    title: { en: 'From our journal', ar: 'من مدونتنا' },
    intro: { en: '' },
    count: '3',
    layout: 'grid',
  },
  render: ({ puck, title, intro, count, layout, ...shell }) => {
    const meta = metaOf(puck)
    const posts = (meta.data.posts ?? []).slice(0, Number(count) || 3)
    if (!posts.length)
      return (
        <EditorNote meta={meta}>
          Blog posts: none published yet — write them in Website Studio → Blog.
        </EditorNote>
      )
    return (
      <SectionShell meta={meta} {...shell}>
        <SectionTitle title={title} intro={intro} meta={meta} />
        <div className={layout === 'list' ? 'divide-y border-y' : 'grid gap-6 md:grid-cols-3'}>
          {posts.map((p) => {
            const href = postHref(meta, p.slug)
            const cover = p.coverImage
            return (
              <article
                key={p.slug}
                data-blog-post={p.slug}
                className={cn(
                  layout === 'list'
                    ? 'flex flex-col gap-2 py-6 sm:flex-row sm:items-baseline sm:gap-8'
                    : 'sb-card flex flex-col overflow-hidden border bg-surface',
                )}
              >
                {layout === 'grid' && cover && (
                  // biome-ignore lint/performance/noImgElement: tenant-site markup, any cover URL
                  <img src={cover} alt="" loading="lazy" className="aspect-[16/10] w-full object-cover" />
                )}
                <div className={cn('flex flex-1 flex-col gap-2', layout === 'grid' && 'p-6')}>
                  {p.publishedAt && (
                    <time dateTime={p.publishedAt} className="text-xs uppercase tracking-wide text-muted">
                      {longDate(p.publishedAt, meta.locale)}
                    </time>
                  )}
                  <h3 className="sb-heading text-xl">
                    <a {...linkProps(meta, href)} className="hover:underline">
                      {tr(p.title, meta)}
                    </a>
                  </h3>
                  {tr(p.excerpt, meta) && (
                    <p className="sb-prose text-[15px] text-muted">{tr(p.excerpt, meta)}</p>
                  )}
                  {layout === 'grid' && (
                    <a {...linkProps(meta, href)} className="sb-btn sb-btn-link mt-auto self-start px-0">
                      {ui('readMore', meta.locale)}
                      <span className="sr-only">: {tr(p.title, meta)}</span>
                    </a>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </SectionShell>
    )
  },
}

/* ------------------------------------------------------------------ Enquiry form */

export const EnquiryForm: ComponentConfig<
  Band & { title: Bi; intro: Bi; buttonLabel: Bi; success: Bi; layout: 'form' | 'split' }
> = {
  label: 'Enquiry form',
  fields: {
    title: biField('Title'),
    intro: biField('Intro', { multiline: true }),
    buttonLabel: biField('Button'),
    success: biField('Thank-you message', { multiline: true }),
    layout: radio('Layout', [
      ['split', 'Text + form'],
      ['form', 'Form only'],
    ]),
    ...bandFields,
  },
  defaultProps: {
    ...band,
    title: { en: 'Send us a message', ar: 'أرسل لنا رسالة' },
    intro: {
      en: 'Questions about a treatment, a gift or a group booking? We reply on WhatsApp.',
      ar: 'لديك سؤال عن جلسة أو هدية أو حجز جماعي؟ نرد عليك عبر واتساب.',
    },
    buttonLabel: { en: 'Send message', ar: 'إرسال الرسالة' },
    success: {
      en: 'Thank you — we’ll reply on WhatsApp soon.',
      ar: 'شكرًا لك — سنرد عليك عبر واتساب قريبًا.',
    },
    layout: 'split',
  },
  render: ({ puck, title, intro, buttonLabel, success, layout, ...shell }) => {
    const meta = metaOf(puck)
    const l = meta.locale
    const form = (
      <SiteEnquiryForm
        locale={l}
        page={meta.slug}
        form={meta.form}
        editing={meta.editing}
        labels={{
          name: ui('formName', l),
          phone: ui('formPhone', l),
          phoneHint: ui('formPhoneHint', l),
          message: ui('formMessage', l),
          send: tr(buttonLabel, meta) || ui('formSend', l),
          sending: ui('formSending', l),
          success: tr(success, meta),
          preview: ui('formPreview', l),
        }}
      />
    )
    if (layout === 'form')
      return (
        <SectionShell meta={meta} {...shell} width="narrow">
          <SectionTitle title={title} intro={intro} meta={meta} />
          {form}
        </SectionShell>
      )
    return (
      <SectionShell meta={meta} {...shell}>
        <div className="grid gap-10 md:grid-cols-[2fr_3fr] lg:gap-16">
          <SectionTitle title={title} intro={intro} meta={meta} />
          {form}
        </div>
      </SectionShell>
    )
  },
}

/* ------------------------------------------------------------------ Blog post (page body, hidden) */

/**
 * The article on a post page (`{site}/blog/{slug}`): rendered by PublicSite from `meta.post`, never placed by hand
 * (hidden category ⇒ not in the palette or the AI schema). Body = plain text blocks (site-kit postBlocks).
 */
export const BlogPost: ComponentConfig<Record<string, never>> = {
  label: 'Blog post',
  fields: {},
  render: ({ puck }) => {
    const meta = metaOf(puck)
    const post = meta.post
    if (!post) return <EditorNote meta={meta}>Blog post</EditorNote>
    const blocks = postBlocks(tr(post.body, meta))
    const wa = whatsappHref(meta)
    return (
      <article data-blog-article={post.slug} className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        <a
          {...linkProps(meta, post.backHref)}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" strokeWidth={1.75} />
          {tr(post.backLabel, meta)}
        </a>
        {post.publishedAt && (
          <time dateTime={post.publishedAt} className="mt-8 block text-xs uppercase tracking-wide text-muted">
            {longDate(post.publishedAt, meta.locale)}
          </time>
        )}
        <h1 className="sb-heading mt-3 text-4xl sm:text-5xl">{tr(post.title, meta)}</h1>
        {tr(post.excerpt, meta) && (
          <p className="sb-prose mt-5 text-lg text-muted">{tr(post.excerpt, meta)}</p>
        )}
        {post.coverImage && (
          // biome-ignore lint/performance/noImgElement: tenant-site markup, any cover URL
          <img src={post.coverImage} alt="" className="sb-card mt-10 aspect-[16/9] w-full object-cover" />
        )}
        <div className="sb-prose mt-10 space-y-5 text-[17px] leading-relaxed">
          {blocks.map((b, i) =>
            b.kind === 'h2' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: static article blocks
              <h2 key={i} className="sb-heading pt-4 text-2xl sm:text-3xl">
                {b.text}
              </h2>
            ) : b.kind === 'ul' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: static article blocks
              <ul key={i} className="list-disc space-y-2 ps-6">
                {b.items.map((item, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static list items
                  <li key={j}>{item}</li>
                ))}
              </ul>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: static article blocks
              <p key={i} className="whitespace-pre-line">
                {b.text}
              </p>
            ),
          )}
        </div>
        <div className="mt-12 flex flex-wrap gap-3 border-t pt-8">
          <a {...linkProps(meta, bookHref(meta))} className="sb-btn sb-btn-primary">
            {ui('book', meta.locale)}
          </a>
          {wa && (
            <a {...linkProps(meta, wa)} className="sb-btn sb-btn-secondary">
              <MessageCircle strokeWidth={1.75} />
              {ui('whatsapp', meta.locale)}
            </a>
          )}
        </div>
      </article>
    )
  },
}
