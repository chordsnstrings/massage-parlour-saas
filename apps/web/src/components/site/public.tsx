import './site.css'
import { type ComponentConfig, type Config, type Data, Render } from '@puckeditor/core'
import { blogPostJsonLd, jsonLdString, normalizeGoogleMapsUrl, spaJsonLd } from '@spa/core'
import { withTenant } from '@spa/db'
import {
  getPublishedPage,
  getPublishedPost,
  getSite,
  globalSectionsFor,
  isScheduleVisible,
  listPublishedPages,
  PAGE_SLUG,
  POST_SLUG,
} from '@spa/services'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { ScrollScenes } from '@/components/scroll-scenes'
import { PlaceholderSite } from '@/components/site/placeholder-site'
import { getNonce } from '@/server/nonce'
import { absoluteImage, heroImageOf, hreflang, sitePageUrl, siteSeo } from '@/server/seo'
import { siteData } from '@/server/sites'
import { turnstileSiteKey } from '@/server/turnstile'
import { siteConfig } from './config'
import { buildMeta, loadSite, localeOf } from './data'
import { tr, ui } from './i18n'
import { pageHref } from './links'
import type { AdvancedProps } from './style'
import type { Bi, Locale, SiteMeta, SitePostView } from './types'

type Tenant = { id: string; slug: string; name: string; status: string }
/** Which public site is rendering (the enquiry form posts it back; custom domains follow the Turnstile switch). */
export type SiteKey = { slug: string } | { hostname: string }

/** '' for home, 'services' for /services; null for anything that can't be a page slug. */
export function slugOf(path: string[] | undefined): string | null {
  if (!path?.length) return ''
  if (path.length > 1) return null
  const slug = decodeURIComponent(path[0]!).toLowerCase()
  return PAGE_SLUG.test(slug) ? slug : null
}

/** F15: `blog/{post}` → the post's slug; null for anything else. */
export function postSlugOf(path: string[] | undefined): string | null {
  if (path?.length !== 2 || decodeURIComponent(path[0]!).toLowerCase() !== 'blog') return null
  const slug = decodeURIComponent(path[1]!).toLowerCase()
  return slug.length <= 80 && POST_SLUG.test(slug) ? slug : null
}

type PageNode = { type: string; props: Record<string, unknown> }

/**
 * A published blog post + what its page needs: the live theme, live data, and the home page's Footer and floating
 * WhatsApp button (so the post page looks like the rest of the site). null = no such live post, or the site has
 * nothing published yet.
 */
const loadPost = cache(async (tenant: Tenant, slug: string) => {
  const found = await withTenant(tenant.id, async (tx) => {
    const pages = await listPublishedPages(tx, tenant.id)
    if (!pages.length) return null
    const post = await getPublishedPost(tx, slug)
    if (!post) return null
    const site = await getSite(tx, tenant.id)
    const home = await getPublishedPage(tx, tenant.id, '')
    const nodes = ((home?.data as { content?: PageNode[] } | undefined)?.content ?? []).filter(
      (n) => n && typeof n.type === 'string',
    )
    return { post, theme: site?.theme ?? {}, pages, nodes }
  })
  if (!found) return null
  const { data } = await loadSite(tenant, { published: true })
  return { ...found, data }
})

/**
 * Public-only config: each top-level section is wrapped in a box carrying `data-block-id/-type`, which the
 * cookieless tracker (public/t.js) uses for block views and per-section click attribution.
 */
function trackedConfig(data: Partial<Data>): Config {
  const top = new Set((data.content ?? []).map((c) => String(c.props?.id)))
  const components = Object.fromEntries(
    Object.entries(siteConfig.components).map(([name, c]) => {
      const Inner = c.render as (props: Record<string, unknown>) => React.ReactNode
      const render = (props: Record<string, unknown>) => {
        // Outside its schedule a band renders nothing — not even the tracking box.
        if (!isScheduleVisible((props.advanced as AdvancedProps | undefined)?.schedule)) return null
        return top.has(String(props.id)) ? (
          <div data-block-id={String(props.id)} data-block-type={name}>
            <Inner {...props} />
          </div>
        ) : (
          <Inner {...props} />
        )
      }
      return [name, { ...c, render } as ComponentConfig]
    }),
  )
  return { ...siteConfig, components }
}

/** Published page (+ the global sections it shows) and live data, shared by generateMetadata and the page. */
const loadPublished = cache(async (tenant: Tenant, slug: string) => {
  const published = await withTenant(tenant.id, async (tx) => {
    const page = await getPublishedPage(tx, tenant.id, slug)
    return page ? { ...page, globals: await globalSectionsFor(tx, tenant.id, page.data) } : null
  })
  if (!published) return null
  const { data } = await loadSite(tenant, { published: true })
  return { published, data }
})

export async function publicSiteMetadata(
  tenant: Tenant | null,
  path: string[] | undefined,
  lang: string | string[] | undefined,
): Promise<Metadata> {
  if (!tenant) return {}
  const postSlug = postSlugOf(path)
  if (postSlug) return postMetadata(tenant, postSlug, lang)
  const slug = slugOf(path)
  const loaded = slug === null ? null : await loadPublished(tenant, slug)
  // Placeholder (nothing published) or a 404: never indexed.
  if (!loaded || slug === null) return { title: { absolute: tenant.name }, robots: { index: false } }
  const seo = await siteSeo(tenant)
  const locale = localeOf(lang)
  const ctx = { locale, data: loaded.data }
  const root = (loaded.published.data as { root?: { props?: { title?: Bi; description?: Bi } } }).root?.props
  const title = tr(root?.title, ctx) || tenant.name
  const description = tr(root?.description, ctx) || undefined
  const url = sitePageUrl(seo.base, slug, locale === 'ar' && seo.arabic ? 'ar' : undefined)
  // Social card: the page's hero picture, else the spa logo.
  const hero = heroImageOf(loaded.published.data, seo.origin)
  const image = hero ?? seo.logo
  const images = image ? [{ url: image, alt: title }] : undefined
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url, languages: hreflang(seo.base, slug, seo.arabic) },
    openGraph: {
      title,
      description,
      siteName: tenant.name,
      locale: locale === 'ar' ? 'ar_AE' : 'en_AE',
      type: 'website',
      url,
      images,
    },
    twitter: { card: hero ? 'summary_large_image' : 'summary', title, description, images },
    ...(seo.indexable ? {} : { robots: { index: false, follow: false } }),
  }
}

/** F15 post page: canonical/hreflang, article social card (cover, else logo), noindex while the site isn't indexable. */
async function postMetadata(
  tenant: Tenant,
  slug: string,
  lang: string | string[] | undefined,
): Promise<Metadata> {
  const loaded = await loadPost(tenant, slug)
  if (!loaded) return { title: { absolute: tenant.name }, robots: { index: false } }
  const seo = await siteSeo(tenant)
  const locale = localeOf(lang)
  const ctx = { locale, data: loaded.data }
  const { post } = loaded
  const path = `blog/${slug}`
  const arabic = seo.arabic && Boolean(post.title.ar)
  const title = tr(post.seoTitle, ctx) || tr(post.title, ctx)
  const description = tr(post.seoDescription, ctx) || tr(post.excerpt, ctx) || undefined
  const url = sitePageUrl(seo.base, path, locale === 'ar' && arabic ? 'ar' : undefined)
  const cover = post.coverImage ? absoluteImage(post.coverImage, seo.origin) : null
  const image = cover ?? seo.logo
  const images = image ? [{ url: image, alt: title }] : undefined
  return {
    title: { absolute: `${title} · ${tenant.name}` },
    description,
    alternates: { canonical: url, languages: hreflang(seo.base, path, arabic) },
    openGraph: {
      title,
      description,
      siteName: tenant.name,
      locale: locale === 'ar' ? 'ar_AE' : 'en_AE',
      type: 'article',
      url,
      images,
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
    },
    twitter: { card: cover ? 'summary_large_image' : 'summary', title, description, images },
    ...(seo.indexable ? {} : { robots: { index: false, follow: false } }),
  }
}

/** schema.org JSON-LD for a published page: the spa (branch, hours, profiles, services + public prices). */
async function siteJsonLd(
  tenant: Tenant,
  slug: string,
  loaded: NonNullable<Awaited<ReturnType<typeof loadPublished>>>,
  locale: Locale,
) {
  const seo = await siteSeo(tenant)
  const ctx = { locale, data: loaded.data }
  const root = (loaded.published.data as { root?: { props?: { description?: Bi } } }).root?.props
  const branch = loaded.data.branch
  return jsonLdString(
    spaJsonLd({
      name: tenant.name,
      url: seo.home,
      pageUrl: sitePageUrl(seo.base, slug),
      pageName: slug ? tr(loaded.published.page.title, ctx) : null,
      description: slug ? null : tr(root?.description, ctx),
      logo: seo.logo,
      image: heroImageOf(loaded.published.data, seo.origin),
      branch,
      services: loaded.data.services.map((s) => ({
        name: tr(s.name, ctx),
        description: tr(s.description, ctx) || null,
        category: tr(s.category, ctx) || null,
        variants: s.variants,
      })),
      sameAs: [seo.instagram, normalizeGoogleMapsUrl(branch?.mapsUrl)],
    }),
  )
}

/**
 * Public tenant page: renders the published Puck JSON on the server (only interactive bits ship JS).
 * Home falls back to the placeholder until something is published; unknown slugs 404.
 */
export async function PublicSite({
  tenant,
  path,
  lang,
  base,
  site,
}: {
  tenant: Tenant
  path: string[] | undefined
  lang: string | string[] | undefined
  base: string
  site: SiteKey
}) {
  // F15 enquiry form: posts for this site, with the same bot check as /book.
  const form = {
    site,
    turnstileSiteKey: await turnstileSiteKey({ customDomain: 'hostname' in site }),
  }
  const postSlug = postSlugOf(path)
  if (postSlug) return <PostPage tenant={tenant} slug={postSlug} lang={lang} base={base} form={form} />
  const slug = slugOf(path)
  if (slug === null) notFound()
  const loaded = await loadPublished(tenant, slug)
  if (!loaded) {
    if (slug === '') return <PlaceholderSite data={await siteData(tenant)} />
    notFound()
  }
  const meta = {
    ...buildMeta({
      data: loaded.data,
      theme: loaded.published.site.theme,
      locale: localeOf(lang),
      base,
      slug,
    }),
    globals: loaded.published.globals,
    form,
  }
  const data = loaded.published.data as Partial<Data>
  const ld = await siteJsonLd(tenant, slug, loaded, meta.locale)
  // ScrollScenes mounts last so it commits with the sections it drives (per-section scroll effects).
  return (
    <>
      <script
        type="application/ld+json"
        nonce={await getNonce()}
        suppressHydrationWarning
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD escaped by jsonLdString (no tag breakout)
        dangerouslySetInnerHTML={{ __html: ld }}
      />
      <Render config={trackedConfig(data)} data={data} metadata={meta} />
      <ScrollScenes key={slug} />
    </>
  )
}

/**
 * F15 blog post page (`{site}/blog/{slug}`): the post's article (hidden BlogPost block) between the site header and
 * the home page's footer, rendered through the same Puck config, so theme, header and footer match the site.
 */
async function PostPage({
  tenant,
  slug,
  lang,
  base,
  form,
}: {
  tenant: Tenant
  slug: string
  lang: string | string[] | undefined
  base: string
  form: NonNullable<SiteMeta['form']>
}) {
  const loaded = await loadPost(tenant, slug)
  if (!loaded) notFound()
  const { post, data: live } = loaded
  const locale = localeOf(lang)
  const meta0 = buildMeta({ data: live, theme: loaded.theme, locale, base, slug: `blog/${slug}` })
  const blogPage = live.pages.find((p) => p.slug === 'blog')
  const view: SitePostView = {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    body: post.body,
    coverImage: post.coverImage,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    backHref: pageHref(meta0, blogPage ? 'blog' : ''),
    backLabel: blogPage ? blogPage.title : { en: ui('home', 'en'), ar: ui('home', 'ar') },
  }
  const meta = { ...meta0, globals: [], form, post: view }
  const keep = (type: string) => loaded.nodes.filter((n) => n.type === type).slice(-1)
  const data: Partial<Data> = {
    root: { props: {} },
    content: [
      { type: 'BlogPost', props: { id: `post-${post.slug}` } },
      ...keep('Footer').map((n) => ({ type: n.type, props: { ...n.props, id: 'post-footer' } })),
      ...keep('WhatsAppButton').map((n) => ({ type: n.type, props: { ...n.props, id: 'post-whatsapp' } })),
    ],
  }
  const seo = await siteSeo(tenant)
  const ctx = { locale, data: live }
  const url = sitePageUrl(seo.base, `blog/${slug}`)
  const ld = jsonLdString(
    blogPostJsonLd(
      {
        name: tenant.name,
        url: seo.home,
        pageUrl: url,
        logo: seo.logo,
        branch: live.branch,
        sameAs: [seo.instagram, normalizeGoogleMapsUrl(live.branch?.mapsUrl)],
      },
      {
        url,
        headline: tr(post.title, ctx),
        description: tr(post.seoDescription, ctx) || tr(post.excerpt, ctx) || null,
        image: post.coverImage ? absoluteImage(post.coverImage, seo.origin) : null,
        datePublished: post.publishedAt,
        dateModified: post.updatedAt,
        inLanguage: locale === 'ar' && post.title.ar ? 'ar' : 'en',
      },
    ),
  )
  return (
    <>
      <script
        type="application/ld+json"
        nonce={await getNonce()}
        suppressHydrationWarning
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD escaped by jsonLdString (no tag breakout)
        dangerouslySetInnerHTML={{ __html: ld }}
      />
      <Render config={trackedConfig(data)} data={data} metadata={meta} />
    </>
  )
}
