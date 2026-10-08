import { cn } from '@/lib/utils'
import { tr, ui } from './i18n'
import { bookHref, linkProps, pageHref } from './links'
import { themeVars } from './theme'
import type { SiteMeta } from './types'

/**
 * The public site chrome around every page: theme variables, direction, header with page navigation,
 * language switch and the Book button (PLAN §11.3 layer 2, MVP defaults).
 */
export function SiteFrame({ meta, children }: { meta: SiteMeta; children: React.ReactNode }) {
  const { tenant, pages } = meta.data
  const other = meta.locale === 'ar' ? 'en' : 'ar'
  const navLink = (slug: string, label: string) => (
    <a
      key={slug}
      {...linkProps(meta, pageHref(meta, slug))}
      aria-current={slug === meta.slug ? 'page' : undefined}
      className={cn(
        'relative whitespace-nowrap py-2 text-[15px] text-muted transition-colors hover:text-fg',
        'aria-[current=page]:text-fg after:absolute after:inset-x-0 after:-bottom-px after:h-px after:origin-left after:scale-x-0 after:bg-current after:transition-transform after:duration-300 aria-[current=page]:after:scale-x-100 hover:after:scale-x-100',
      )}
    >
      {label}
    </a>
  )
  return (
    <div
      className="site-root"
      dir={meta.locale === 'ar' ? 'rtl' : 'ltr'}
      lang={meta.locale}
      data-motion={meta.editing ? 'none' : meta.theme.motion}
      data-emphasis={meta.theme.emphasis ?? 'italic'}
      style={themeVars(meta.theme)}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b bg-[color-mix(in_srgb,var(--bg)_86%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
          <a {...linkProps(meta, pageHref(meta, ''))} className="sb-heading min-w-0 truncate text-xl">
            {tenant.name}
          </a>
          {pages.length > 1 && (
            <nav aria-label="Main" className="hidden items-center gap-7 md:flex">
              {pages.map((p) => navLink(p.slug, tr(p.title, meta)))}
            </nav>
          )}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <a
              {...linkProps(meta, pageHref(meta, meta.slug, other))}
              lang={other}
              className="grid min-h-11 min-w-11 place-items-center rounded-full px-2 text-sm text-muted transition-colors hover:text-fg"
            >
              {other === 'ar' ? 'عربي' : 'English'}
            </a>
            <a {...linkProps(meta, bookHref(meta))} className="sb-btn sb-btn-primary min-h-10 px-4 text-sm">
              {ui('bookShort', meta.locale)}
            </a>
          </div>
        </div>
        {pages.length > 1 && (
          <nav
            aria-label="Main"
            className="mx-auto flex max-w-6xl gap-6 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:px-8 md:hidden"
          >
            {pages.map((p) => navLink(p.slug, tr(p.title, meta)))}
          </nav>
        )}
      </header>
      <main id="main">{children}</main>
    </div>
  )
}
