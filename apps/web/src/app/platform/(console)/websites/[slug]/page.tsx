import { domains, platformDb, siteAiEditorStatus, withTenant } from '@spa/db'
import {
  getSite,
  listChangeRequests,
  listPages,
  listPosts,
  templateUndoChanges,
  websiteOverview,
} from '@spa/services'
import { asc, sql } from 'drizzle-orm'
import { ArrowLeft, ArrowRight, ArrowUpRight, Eye } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ScaledFrame } from '@/components/site/scaled-frame'
import { normalizeTheme } from '@/components/site/theme'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { CopyButton } from '@/components/ui/copy-button'
import { PageBody, PageHeader } from '@/components/ui/page'
import { adminPath, studioPath } from '@/lib/paths'
import { formatDateTime } from '@/lib/utils'
import { can, isStudio, requireMember } from '@/server/access'
import { aiFixturesOn } from '@/server/ai-fixture'
import { themeDraftWarnings } from '@/server/site-preflight'
import { templateCatalog } from '@/server/site-templates'
import { publicSiteUrl } from '@/server/sites'
import { WebsiteStatusBadge } from '../next-step'
import { BlogCard, DomainCard, PagesCard, pageUnpublished, RequestsCard, TemplatesCard } from './cards'
import { PublishSiteSheet, ThemeSheet, UndoTemplateBar } from './website-client'

export const metadata: Metadata = { title: 'Website' }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * R23 Website Studio in the console: one spa's website — status + next step, templates (switch + undo), pages
 * (full-screen editor), theme, import, blog, change requests and Publish. Super-admins publish directly; the spa
 * only sends change requests (its own Website page).
 */
export default async function SpaWebsitePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ publish?: string }>
}) {
  const ctx = await requireMember((await params).slug)
  if (!(await isStudio(ctx))) notFound()
  if (!can(ctx, 'site.content') && !can(ctx, 'site.design') && !can(ctx, 'site.publish')) notFound()
  const { publish } = await searchParams
  const slug = ctx.tenant.slug
  const reports = can(ctx, 'reports.view')
  const canDesign = can(ctx, 'site.design')
  const canPublish = can(ctx, 'site.publish')
  const canEdit = can(ctx, 'site.content')
  const [data, [progress], catalog, aiEditor, publicUrl] = await Promise.all([
    withTenant(ctx.tenant.id, async (tx) => {
      const site = await getSite(tx, ctx.tenant.id)
      return {
        site,
        hosts: await tx.select().from(domains).orderBy(asc(domains.createdAt)),
        // Cookieless visitors + booking conversion, last 30 days.
        glance: reports
          ? ((
              await tx.execute(sql`select count(distinct session_hash)::int as visitors,
              (count(distinct session_hash) filter (where type = 'booking_complete'))::int as booked
              from web_events where ts >= now() - interval '30 days'`)
            ).rows[0] as { visitors: number; booked: number })
          : null,
        pages: await listPages(tx, ctx.tenant.id),
        posts: await listPosts(tx),
        requests: await listChangeRequests(tx, ctx.tenant.id),
        // Undo is only offered while nothing the switch wrote has been edited or published since.
        undoBlocked: (await templateUndoChanges(tx, ctx.tenant.id, site)).length > 0,
        // A waiting draft theme goes live on every page with "Publish site": its contrast there.
        themeWarnings: site?.themeDraft ? await themeDraftWarnings(tx, ctx.tenant.id, { drafts: true }) : [],
      }
    }),
    websiteOverview(platformDb(), { tenantId: ctx.tenant.id }),
    templateCatalog(),
    siteAiEditorStatus(platformDb(), ctx.user.id),
    publicSiteUrl(ctx.tenant),
  ])
  const { site, pages, posts, undoBlocked, requests, hosts, glance, themeWarnings } = data
  // F32 import: AI mapping for SITE_AI_EDITOR_EMAILS accounts when ModelArk is set up (re-checked by the action).
  const importAi = canDesign && (Boolean(process.env.ARK_API_KEY) || aiFixturesOn()) && aiEditor === 'ok'
  const pending = pages.filter(pageUnpublished).length
  const themePending = Boolean(site?.themeDraft)
  const hasLive = pages.some((p) => p.publishedAt)
  const openRequests = requests.filter((r) => r.status === 'open').length
  const current = site ? catalog.find((t) => t.key === site.templateKey) : null
  const nameOf = (key: string) => catalog.find((t) => t.key === key)?.name ?? key
  // The undo offer stays for a week after a switch (the snapshot itself lives until the next switch).
  const undo =
    site?.templateUndo &&
    !undoBlocked &&
    Date.now() - new Date(site.templateUndo.at).getTime() < 7 * 86_400_000
      ? site.templateUndo
      : null
  const host = publicUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const status = progress?.status ?? (site ? 'template' : 'none')
  const unpublished = progress?.unpublished ?? false
  const changes = [pending ? plural(pending, 'page', 'pages') : null, themePending ? 'the theme' : null]
    .filter(Boolean)
    .join(' and ')
  const nextText = {
    none: 'Pick a template below.',
    template: 'Write the texts, then adjust each page.',
    draft: 'Ready? Publish to make it live.',
    live: unpublished
      ? `${changes.charAt(0).toUpperCase()}${changes.slice(1)} ${pending + Number(themePending) === 1 ? 'has' : 'have'} unpublished changes.`
      : `Live at ${host}.`,
  }[status]

  const templates = (
    <TemplatesCard slug={slug} catalog={catalog} site={site} hasLive={hasLive} canDesign={canDesign} />
  )
  const requestsCard = <RequestsCard slug={slug} requests={requests} canEdit={canEdit} />

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={adminPath('/websites')}
            className="inline-flex items-center gap-1 normal-case tracking-normal hover:text-fg"
          >
            <ArrowLeft className="size-3.5" /> Websites
          </Link>
        }
        title={ctx.tenant.name}
        description={`${host} · English · Arabic`}
        actions={
          site && (
            <>
              <Button variant="secondary" asChild>
                <a href={studioPath(slug, '/preview')} target="_blank" rel="noreferrer">
                  <Eye /> Preview
                </a>
              </Button>
              {hasLive && (
                <Button variant="secondary" asChild>
                  <a href={publicUrl} target="_blank" rel="noreferrer">
                    Open site <ArrowUpRight />
                  </a>
                </Button>
              )}
              {canPublish && (pending > 0 || themePending) && (
                <PublishSiteSheet
                  slug={slug}
                  pending={pending}
                  theme={themePending}
                  themeWarnings={themeWarnings.slice(0, 8)}
                  defaultOpen={publish === '1'}
                />
              )}
            </>
          )
        }
      />
      <PageBody>
        <Card
          className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 sm:px-6"
          data-testid="website-status"
        >
          <WebsiteStatusBadge status={status} unpublished={unpublished} />
          <p className="min-w-0 flex-1 text-sm text-muted">{nextText}</p>
          {openRequests > 0 && (
            <Link href="#requests" className="text-sm font-medium text-accent hover:underline">
              {plural(openRequests, 'open request', 'open requests')}
            </Link>
          )}
        </Card>
        {!site ? (
          <>
            {templates}
            {requestsCard}
          </>
        ) : (
          <>
            {canDesign && undo && (
              <UndoTemplateBar
                slug={slug}
                from={nameOf(undo.templateKey)}
                to={current?.name ?? site.templateKey}
                at={formatDateTime(new Date(undo.at))}
                pages={undo.pages.length}
              />
            )}
            <div className="grid items-start gap-[var(--ui-stack,1.5rem)] lg:grid-cols-2">
              <div className="grid gap-[var(--ui-stack,1.5rem)]">
                <Card>
                  <CardHeader title="Website" description={`${host} · English · Arabic`} />
                  <CardBody className="space-y-4">
                    <div className="overflow-hidden rounded-lg border">
                      <p className="truncate border-b bg-subtle px-3 py-1.5 text-xs text-muted">{host}</p>
                      <ScaledFrame
                        src={studioPath(slug, '/preview')}
                        title="Home page preview"
                        className="aspect-[16/11]"
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted">Template</p>
                        <p className="text-[15px] font-semibold" data-testid="current-template">
                          {current?.name ?? site.templateKey}
                        </p>
                      </div>
                      <span className="flex flex-wrap gap-2">
                        <CopyButton value={publicUrl} label="Copy link" />
                        {canDesign && (
                          <ThemeSheet
                            slug={slug}
                            theme={normalizeTheme(site.theme)}
                            draft={site.themeDraft !== null}
                          />
                        )}
                      </span>
                    </div>
                  </CardBody>
                </Card>
                {requestsCard}
              </div>
              <div className="grid gap-[var(--ui-stack,1.5rem)]">
                <PagesCard
                  slug={slug}
                  pages={pages}
                  themePending={themePending}
                  canEdit={canEdit}
                  canDesign={canDesign}
                  importAi={importAi}
                />
                <BlogCard slug={slug} posts={posts} canEdit={canEdit} />
                {glance && (
                  <Card>
                    <CardHeader
                      title="Site at a glance"
                      description="Last 30 days · cookieless"
                      action={
                        <Link
                          href={adminPath(`/performance/${ctx.tenant.id}`)}
                          className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
                        >
                          Performance <ArrowRight className="size-3.5" />
                        </Link>
                      }
                    />
                    <CardBody className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted">Visitors</p>
                        <p className="mt-1 text-xl font-semibold tabular-nums">
                          {glance.visitors.toLocaleString('en')}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted">
                          Booking conversion
                        </p>
                        <p className="mt-1 text-xl font-semibold tabular-nums">
                          {Math.round((glance.visitors ? glance.booked / glance.visitors : 0) * 100)}%
                        </p>
                        <p className="text-xs text-muted">
                          {plural(glance.booked, 'online booking', 'online bookings')}
                        </p>
                      </div>
                    </CardBody>
                  </Card>
                )}
                <DomainCard host={host} domains={hosts} />
              </div>
            </div>
            {canDesign && templates}
          </>
        )}
      </PageBody>
    </>
  )
}
