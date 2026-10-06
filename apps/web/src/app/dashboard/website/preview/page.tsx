import '@/components/site/site.css'
import { type Data, Render } from '@puckeditor/core'
import { platformDb, tenants, withTenant } from '@spa/db'
import { getEditablePage, globalSectionsFor, verifyPreviewToken } from '@spa/services'
import { eq } from 'drizzle-orm'
import { Clock3 } from 'lucide-react'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { siteConfig } from '@/components/site/config'
import { buildMeta, loadSite, localeOf } from '@/components/site/data'
import { tenantSiteUrl } from '@/lib/paths'

export const metadata: Metadata = { title: 'Draft preview', robots: { index: false, follow: false } }

type Props = { searchParams: Promise<{ token?: string; lang?: string }> }

const expiry = new Intl.DateTimeFormat('en-AE', {
  timeZone: 'Asia/Dubai',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/**
 * Shareable draft preview (PLAN §11.6): `/website/preview?token=…` on the app host works without signing in.
 * The HMAC-signed token (BETTER_AUTH_SECRET) names the tenant + page and expires; it lives outside the
 * tenant dashboard layout, which requires a session. The current draft renders as visitors would see it.
 */
export default async function SharedDraftPreview({ searchParams }: Props) {
  await headers()
  const { token, lang } = await searchParams
  const claims = verifyPreviewToken(token, process.env.BETTER_AUTH_SECRET ?? '')
  if (!claims) return <Expired />
  // The token resolves the tenant (platform lookup); everything after reads through withTenant.
  const [tenant] = await platformDb()
    .select({ id: tenants.id, slug: tenants.slug, name: tenants.name, status: tenants.status })
    .from(tenants)
    .where(eq(tenants.id, claims.tenantId))
    .limit(1)
  if (!tenant || tenant.status === 'cancelled') notFound()
  const draft = await withTenant(tenant.id, async (tx) => {
    const editable = await getEditablePage(tx, tenant.id, claims.pageId)
    return editable ? { ...editable, globals: await globalSectionsFor(tx, tenant.id, editable.data) } : null
  })
  if (!draft) notFound()
  const { site, data } = await loadSite(tenant, { published: false })
  const locale = localeOf(lang)
  const meta = {
    ...buildMeta({
      data,
      theme: site?.theme ?? null,
      locale,
      // Links lead to the live site.
      base: tenantSiteUrl(tenant.slug),
      slug: draft.page.slug,
    }),
    globals: draft.globals,
  }
  const other = locale === 'ar' ? 'en' : 'ar'
  return (
    <>
      <Render config={siteConfig} data={draft.data as Partial<Data>} metadata={meta} />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto flex max-w-full items-center gap-4 rounded-2xl border border-black/10 bg-[#16241c]/92 py-2 ps-4 pe-2 font-sans text-white shadow-[0_8px_30px_rgb(0_0_0/0.25)] backdrop-blur">
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[13px] font-medium">Draft preview · not live yet</span>
            <span className="block truncate text-[11px] text-white/70">
              Link expires {expiry.format(new Date(claims.exp * 1000))} (Dubai)
            </span>
          </span>
          <a
            href={`?token=${encodeURIComponent(token ?? '')}${other === 'ar' ? '&lang=ar' : ''}`}
            lang={other}
            className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-xl bg-white/12 px-3 text-[13px] font-medium transition-colors hover:bg-white/20"
          >
            {other === 'ar' ? 'عربي' : 'English'}
          </a>
        </div>
      </div>
    </>
  )
}

function Expired() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-fg">
      <div className="max-w-sm space-y-3 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
          <Clock3 className="size-5" strokeWidth={1.5} />
        </span>
        <h1 className="text-lg font-semibold tracking-tight">This preview link has expired</h1>
        <p className="text-sm text-muted">
          Ask the spa for a new link — previews stay open for a limited time.
        </p>
      </div>
    </main>
  )
}
