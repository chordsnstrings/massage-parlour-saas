import '@/components/site/site.css'
import { type Data, Render } from '@puckeditor/core'
import { PAGE_SLUG } from '@spa/services'
import { X } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { siteConfig } from '@/components/site/config'
import { buildMeta, localeOf } from '@/components/site/data'
import { adminPath } from '@/lib/paths'
import { cn } from '@/lib/utils'
import { requirePlatformAdmin } from '@/server/access'
import { loadAdminTemplate } from '../../data'
import { DEMO_SITE } from '../../demo'

export const metadata: Metadata = { title: 'Template preview', robots: { index: false } }

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ page?: string; lang?: string }>
}

/** Studio preview: a template's pages rendered with a sample spa, with a small page / language switcher. */
export default async function TemplatePreviewPage({ params, searchParams }: Props) {
  await requirePlatformAdmin()
  const { id } = await params
  const { page = '', lang } = await searchParams
  if (!PAGE_SLUG.test(page)) notFound()
  const template = await loadAdminTemplate(id)
  const current = template?.pages.find((p) => p.slug === page)
  if (!template || !current) notFound()
  const locale = localeOf(lang)
  const meta = buildMeta({
    data: { ...DEMO_SITE, pages: template.pages.map((p) => ({ slug: p.slug, title: p.title })) },
    theme: template.theme,
    locale,
    base: '',
    slug: page,
    editing: true,
  })
  const href = (slug: string, l = locale) =>
    adminPath(
      `/templates/${id}/preview?${new URLSearchParams({ page: slug, ...(l === 'ar' ? { lang: 'ar' } : {}) })}`,
    )
  const pill =
    'inline-flex min-h-10 items-center rounded-full px-3.5 text-sm whitespace-nowrap transition-colors'
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-bg pb-24">
      <Render config={siteConfig} data={current.data as Partial<Data>} metadata={meta} />
      <nav
        aria-label="Template pages"
        className="anim-pop-in fixed inset-x-3 bottom-3 z-[70] mx-auto flex max-w-3xl items-center gap-1 overflow-x-auto rounded-full border bg-surface/95 p-1.5 shadow-pop backdrop-blur [scrollbar-width:none]"
      >
        <Link
          href={adminPath('/templates')}
          aria-label="Close preview"
          className={cn(pill, 'text-muted hover:text-fg')}
        >
          <X className="size-4" />
        </Link>
        <span className="px-2 text-sm font-medium whitespace-nowrap">{template.name}</span>
        {template.pages.map((p) => (
          <Link
            key={p.slug}
            href={href(p.slug)}
            aria-current={p.slug === page ? 'page' : undefined}
            className={cn(pill, p.slug === page ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg')}
          >
            {p.title.en}
          </Link>
        ))}
        <Link
          href={href(page, locale === 'ar' ? 'en' : 'ar')}
          className={cn(pill, 'ms-auto text-muted hover:text-fg')}
        >
          {locale === 'ar' ? 'English' : 'عربي'}
        </Link>
      </nav>
    </div>
  )
}
