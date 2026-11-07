import { redirectSourceHref } from '@spa/core'
import { withTenant } from '@spa/db'
import { listPublishedPages, listSiteRedirects } from '@spa/services'
import { ArrowLeft, ArrowRight, ExternalLink, Route } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader } from '@/components/ui/card'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { studioPath } from '@/lib/paths'
import { formatDate } from '@/lib/utils'
import { can, isStudio, requireMember } from '@/server/access'
import { publicSiteUrl } from '@/server/sites'
import {
  AddRedirectSheet,
  ClearRedirectsButton,
  DeleteRedirectButton,
  ImportRedirectsSheet,
  type RedirectTarget,
} from './redirects-client'

export const metadata: Metadata = { title: 'Redirects' }

/**
 * R33: the spa's redirects (Website Studio in the console): old website addresses → pages of the site, a 301 on every
 * address of the spa. Added one by one or imported (Search Console's 404 list); live at once (site.publish).
 */
export default async function SiteRedirectsPage({ params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireMember((await params).slug)
  if (!(await isStudio(ctx))) notFound()
  if (!can(ctx, 'site.content') && !can(ctx, 'site.design') && !can(ctx, 'site.publish')) notFound()
  const slug = ctx.tenant.slug
  const canPublish = can(ctx, 'site.publish')
  const [{ redirects, pages }, publicUrl] = await Promise.all([
    withTenant(ctx.tenant.id, async (tx) => ({
      redirects: await listSiteRedirects(tx, ctx.tenant.id),
      pages: await listPublishedPages(tx, ctx.tenant.id),
    })),
    publicSiteUrl(ctx.tenant),
  ])
  const site = publicUrl.replace(/\/$/, '')
  // New-address choices: the live pages (home first), then online booking.
  const targets: RedirectTarget[] = [
    ...[...pages]
      .sort((a, b) => Number(a.slug !== '') - Number(b.slug !== ''))
      .map((p) => ({ value: `/${p.slug}`, label: `${p.title.en} (/${p.slug})` })),
    { value: '/book', label: 'Online booking (/book)' },
  ]
  const titleOf = new Map(pages.map((p) => [`/${p.slug}`, p.title.en]))
  const inactive = redirects.filter((r) => r.inactive).length
  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={studioPath(slug)}
            className="inline-flex items-center gap-1 normal-case tracking-normal hover:text-fg"
          >
            <ArrowLeft className="size-3.5" /> {ctx.tenant.name} website
          </Link>
        }
        title="Redirects"
        description="Addresses of the old website (still listed by Google, now a 404) → pages of this site. A 301 on every address of the spa; a live page at the same address always wins."
        actions={
          canPublish && (
            <>
              {redirects.length > 0 && <ClearRedirectsButton slug={slug} count={redirects.length} />}
              <ImportRedirectsSheet slug={slug} targets={targets} />
              <AddRedirectSheet slug={slug} targets={targets} />
            </>
          )
        }
      />
      <PageBody>
        <Card>
          <CardHeader
            title={`${redirects.length} ${redirects.length === 1 ? 'redirect' : 'redirects'}`}
            description={
              inactive
                ? `${inactive} inactive: a live page uses that address.`
                : 'Old addresses match without regard to case or a trailing slash; the visitor’s other ?params are kept.'
            }
          />
          <div className="mt-3">
            <DataTable
              rows={redirects}
              rowKey={(r) => r.id}
              empty={
                <EmptyState
                  icon={<Route className="size-5" />}
                  title="No redirects yet"
                  description="Add an old address, or import Search Console’s list of pages not found (404)."
                />
              }
              columns={[
                {
                  key: 'from',
                  header: 'Old address',
                  primary: true,
                  cell: (r) => (
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 break-all font-medium">
                        {r.fromQuery ? `${r.fromPath}?${r.fromQuery}` : r.fromPath}
                      </span>
                      {r.inactive && <Badge tone="warning">Inactive: a page uses this address</Badge>}
                    </span>
                  ),
                },
                {
                  key: 'to',
                  header: 'Goes to',
                  cell: (r) => (
                    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <ArrowRight className="size-3.5 shrink-0 text-muted" />
                      <span className="min-w-0 break-all">{r.toPath}</span>
                      {titleOf.has(r.toPath) && (
                        <span className="text-xs text-muted">{titleOf.get(r.toPath)}</span>
                      )}
                      {r.targetMissing && <Badge tone="danger">Page missing</Badge>}
                    </span>
                  ),
                },
                {
                  key: 'added',
                  header: 'Added',
                  hideOnMobile: true,
                  cell: (r) => (
                    <span className="inline-flex flex-col gap-0.5 text-xs text-muted">
                      <span className="tabular-nums">{formatDate(r.createdAt)}</span>
                      <span>{r.source === 'import' ? 'Imported' : 'Added'}</span>
                    </span>
                  ),
                },
                {
                  key: 'actions',
                  header: <span className="sr-only">Actions</span>,
                  className: 'text-end',
                  cell: (r) => {
                    const from = r.fromQuery ? `${r.fromPath}?${r.fromQuery}` : r.fromPath
                    return (
                      <span className="inline-flex items-center gap-1">
                        <a
                          href={`${site}${redirectSourceHref(r.fromPath, r.fromQuery)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-muted hover:bg-subtle hover:text-fg"
                          aria-label={`Test ${from}`}
                        >
                          Test <ExternalLink className="size-3.5" />
                        </a>
                        {canPublish && <DeleteRedirectButton slug={slug} id={r.id} from={from} />}
                      </span>
                    )
                  },
                },
              ]}
            />
          </div>
        </Card>
      </PageBody>
    </>
  )
}
