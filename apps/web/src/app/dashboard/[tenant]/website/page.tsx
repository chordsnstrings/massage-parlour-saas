import { enumLabel } from '@spa/core/i18n'
import { domains, withTenant } from '@spa/db'
import { getSite, listChangeRequests, listPages, templateUndoChanges } from '@spa/services'
import { asc, sql } from 'drizzle-orm'
import { ArrowRight, ExternalLink, FileText, Globe, MessageSquare, PencilLine } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, Grid, ListRow, Pill, SiteFrame, Stack, Stat, type Tone } from '@/components/crm'
import { PAGE_TEMPLATES } from '@/components/site/presets'
import { ScaledFrame } from '@/components/site/scaled-frame'
import { normalizeTheme } from '@/components/site/theme'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, isStudio, requireMember } from '@/server/access'
import { themeDraftWarnings } from '@/server/site-preflight'
import { templateCatalog } from '@/server/site-templates'
import { siteWriterReady } from '@/server/site-writer'
import { publicSiteUrl } from '@/server/sites'
import { ServicesPrices } from './services-prices'
import { ApproveSiteSheet, ResolveRequestSheet, StudioStatusButton } from './studio-client'
import {
  AddPageSheet,
  AiWriterSheet,
  ApplyTemplateSheet,
  PublishSiteSheet,
  ThemeSheet,
  UndoTemplateBar,
  UseTemplateButton,
  VisibilityToggle,
} from './website-client'

const STUDIO_TONE: Record<string, Tone> = { building: 'neutral', review: 'acc', approved: 'ok' }
const REQUEST_TONE: Record<string, Tone> = { open: 'info', done: 'ok', declined: 'neutral' }

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('website.title') }
}

export default async function WebsitePage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  // Website Studio (PLAN §14.4, §18.1): only a super-admin acting on the spa (impersonating or platform admin) edits
  // and publishes the site; spa members only keep its services and prices current.
  const studio = await isStudio(ctx)
  if (!studio) {
    if (!can(ctx, 'site.content') && !can(ctx, 'services.manage')) notFound()
    return <ServicesPrices ctx={ctx} />
  }
  if (!can(ctx, 'site.content') && !can(ctx, 'site.design') && !can(ctx, 'site.publish')) notFound()
  const slug = ctx.tenant.slug
  const reports = can(ctx, 'reports.view')
  const { t, fmt } = await getI18n()
  const { site, pages, undoBlocked, requests, hosts, glance, themeWarnings } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const site = await getSite(tx, ctx.tenant.id)
      return {
        site,
        hosts: await tx.select().from(domains).orderBy(asc(domains.createdAt)),
        // "Site at a glance" (crm-spec §5.9): cookieless visitors + booking conversion, last 30 days.
        glance: reports
          ? ((
              await tx.execute(sql`select count(distinct session_hash)::int as visitors,
              (count(distinct session_hash) filter (where type = 'booking_complete'))::int as booked
              from web_events where ts >= now() - interval '30 days'`)
            ).rows[0] as { visitors: number; booked: number })
          : null,
        pages: await listPages(tx, ctx.tenant.id),
        requests: await listChangeRequests(tx, ctx.tenant.id),
        // Undo is only offered while nothing the switch wrote has been edited or published since.
        undoBlocked: (await templateUndoChanges(tx, ctx.tenant.id, site)).length > 0,
        // A waiting draft theme goes live on every page with "Publish site": its contrast there.
        themeWarnings: site?.themeDraft ? await themeDraftWarnings(tx, ctx.tenant.id, { drafts: true }) : [],
      }
    },
  )
  const catalog = await templateCatalog()
  const canDesign = can(ctx, 'site.design')
  const canPublish = can(ctx, 'site.publish')
  const canEdit = can(ctx, 'site.content')
  const studioStatus = site?.studioStatus ?? 'building'
  const openRequests = requests.filter((r) => r.status === 'open').length
  const aiReady = canDesign && (await siteWriterReady())
  const publicUrl = await publicSiteUrl(ctx.tenant)
  // Unpublished: page drafts, pending page renames (Claude MCP) and a draft theme (Ask AI / MCP, site-wide).
  const unpublished = (p: (typeof pages)[number]) => p.hasDraft || p.pending !== null
  const pending = pages.filter(unpublished).length
  const themePending = Boolean(site?.themeDraft)
  const hasLive = pages.some((p) => p.publishedAt)
  const preview = (query = '') => appPath(`/${slug}/website/preview${query ? `?${query}` : ''}`)
  const current = site ? catalog.find((t) => t.key === site.templateKey) : null
  // The undo offer stays for a week after a switch (the snapshot itself lives until the next switch).
  const undo =
    site?.templateUndo &&
    !undoBlocked &&
    Date.now() - new Date(site.templateUndo.at).getTime() < 7 * 86_400_000
      ? site.templateUndo
      : null
  const nameOf = (key: string) => catalog.find((t) => t.key === key)?.name ?? key

  const host = publicUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')

  const gallery = (
    <Stagger className="crm-grid crm-g3">
      {catalog.map((tpl) => {
        const isCurrent = site?.templateKey === tpl.key
        return (
          <StaggerItem key={tpl.key}>
            <article
              aria-label={tpl.name}
              className="crm-card group flex h-full flex-col overflow-hidden !p-0 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 motion-reduce:hover:translate-y-0"
            >
              {tpl.source === 'builtin' ? (
                // Built-ins ship a static thumbnail (public/site-templates, rendered by the
                // e2e/template-thumbs.spec.ts with THUMBS=1) so a gallery of 20+ templates doesn't boot a live page each.
                // biome-ignore lint/performance/noImgElement: static public asset, fixed size
                <img
                  src={`/site-templates/${tpl.key}.webp`}
                  alt={t('website.templatePreview', { name: tpl.name })}
                  loading="lazy"
                  width={640}
                  height={480}
                  className="aspect-[4/3] w-full border-b bg-subtle object-cover object-top"
                />
              ) : (
                <ScaledFrame
                  src={preview(`template=${tpl.key}&starter=1`)}
                  title={t('website.templatePreview', { name: tpl.name })}
                  className="aspect-[4/3] border-b"
                />
              )}
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="truncate text-[15px] font-semibold">{tpl.name}</h3>
                    <span className="flex shrink-0 gap-1.5">
                      {tpl.source === 'studio' && <Pill>{t('website.studioBadge')}</Pill>}
                      {isCurrent && <Pill tone="acc">{t('website.current')}</Pill>}
                    </span>
                  </div>
                  <p className="crm-muted text-sm">{tpl.feel}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" asChild className="h-11 flex-1">
                    <a
                      href={preview(site ? `template=${tpl.key}` : `template=${tpl.key}&starter=1`)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={t('website.tryOnName', { name: tpl.name })}
                    >
                      {t('website.tryOn')} <ExternalLink />
                    </a>
                  </Button>
                  {canDesign && !isCurrent && (
                    <div className="flex-1">
                      {site ? (
                        <ApplyTemplateSheet
                          slug={slug}
                          template={tpl.key}
                          name={tpl.name}
                          currentName={current?.name ?? site.templateKey}
                          hasLiveContent={hasLive}
                          nowSrc={preview()}
                          keepSrc={preview(`template=${tpl.key}`)}
                          starterSrc={preview(`template=${tpl.key}&starter=1`)}
                        />
                      ) : (
                        <UseTemplateButton slug={slug} template={tpl.key} name={tpl.name} />
                      )}
                    </div>
                  )}
                </div>
              </div>
            </article>
          </StaggerItem>
        )
      })}
    </Stagger>
  )

  const writer = canDesign && (
    <AiWriterSheet
      slug={slug}
      ready={aiReady}
      templates={catalog.map((tpl) => ({ key: tpl.key, name: tpl.name }))}
      current={site?.templateKey ?? 'zen'}
    />
  )

  const requestsCard = requests.length > 0 && (
    <Card title={t('website.requests')} sub={t('website.requestsStudio')}>
      {requests.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="size-5" />}
          title={t('website.noRequests')}
          description={t('website.noRequestsBody')}
        />
      ) : (
        <div>
          {requests.map((r) => (
            <ListRow
              key={r.id}
              title={<span className="whitespace-pre-line font-normal">{r.body}</span>}
              body={
                <>
                  <span className="block">
                    {r.pageTitle?.en ?? t('website.wholeSite')} · {fmt.dateTime(r.createdAt)}
                  </span>
                  {r.response && (
                    <span className="block whitespace-pre-line">
                      {t('website.studioReply', { text: r.response })}
                    </span>
                  )}
                </>
              }
              end={
                <span className="flex flex-col items-end gap-2">
                  <Pill tone={REQUEST_TONE[r.status] ?? 'neutral'} dot>
                    {enumLabel(t, 'changeRequestStatus', r.status)}
                  </Pill>
                  {canEdit && r.status === 'open' && <ResolveRequestSheet slug={slug} id={r.id} />}
                </span>
              }
            />
          ))}
        </div>
      )}
    </Card>
  )

  const pagesCard = site && (
    <Card
      flush
      title={t('website.pages')}
      sub={
        [
          pending > 0 ? t('website.pagesPending', { count: pending }) : null,
          themePending ? t('website.themePending') : null,
        ]
          .filter(Boolean)
          .join(' · ') || t('website.allLive')
      }
      actions={
        canDesign && (
          <AddPageSheet
            slug={slug}
            templates={PAGE_TEMPLATES.map((tpl) => ({
              key: tpl.key,
              name: tpl.name,
              description: tpl.description,
              slug: tpl.slug,
            }))}
          />
        )
      }
    >
      <div className="mt-3">
        <DataTable
          rows={pages}
          rowKey={(p) => p.id}
          empty={<EmptyState icon={<FileText className="size-5" />} title={t('website.noPages')} />}
          columns={[
            {
              key: 'page',
              header: t('website.colPage'),
              primary: true,
              cell: (p) => (
                <span className="flex min-w-0 items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.title.en}</span>
                    <span className="crm-muted block truncate text-xs">/{p.slug}</span>
                  </span>
                  {canEdit && (
                    <Button variant="secondary" size="sm" asChild className="h-10 md:hidden">
                      <Link href={appPath(`/${slug}/website/editor/${p.id}`)}>
                        <PencilLine /> {t('website.edit')}
                      </Link>
                    </Button>
                  )}
                </span>
              ),
            },
            {
              key: 'status',
              header: t('website.colStatus'),
              cell: (p) => (
                <span className="inline-flex flex-col items-end gap-1 md:items-start">
                  {!p.publishedAt ? (
                    <Pill tone="warn">{t('website.notPublished')}</Pill>
                  ) : unpublished(p) ? (
                    <Pill tone="info">{t('website.unpublished')}</Pill>
                  ) : (
                    <Pill tone="ok" dot>
                      {t('website.live')}
                    </Pill>
                  )}
                  {p.publishedAt && (
                    <span className="crm-muted crm-num text-xs">
                      {t('website.publishedAt', { when: fmt.dateTime(p.publishedAt) })}
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: 'visible',
              header: t('website.colMenu'),
              cell: (p) => (
                <VisibilityToggle
                  slug={slug}
                  pageId={p.id}
                  visible={p.visible}
                  label={p.title.en}
                  disabled={!canDesign || p.slug === ''}
                />
              ),
            },
            {
              key: 'edit',
              header: <span className="sr-only">{t('website.actions')}</span>,
              className: 'text-end',
              hideOnMobile: true,
              cell: (p) =>
                canEdit && (
                  <Button variant="secondary" size="sm" asChild>
                    <Link
                      href={appPath(`/${slug}/website/editor/${p.id}`)}
                      aria-label={t('website.editPage', { name: p.title.en })}
                    >
                      <PencilLine /> {t('website.edit')}
                    </Link>
                  </Button>
                ),
            },
          ]}
        />
      </div>
    </Card>
  )

  return (
    <>
      <PageHeader
        title={t('website.title')}
        description={t('website.descStudio')}
        actions={
          <>
            {writer}
            {canPublish && site && (
              <StudioStatusButton
                slug={slug}
                to={site.studioStatus === 'building' ? 'review' : 'building'}
                reopen={site.studioStatus === 'approved'}
              />
            )}
            {canPublish && site && site.studioStatus !== 'approved' && <ApproveSiteSheet slug={slug} />}
            {site && (
              <Button variant="secondary" asChild>
                <a href={publicUrl} target="_blank" rel="noreferrer">
                  <Globe /> {t('website.viewSite')}
                </a>
              </Button>
            )}
            {site && canPublish && (pending > 0 || themePending) && (
              <PublishSiteSheet
                slug={slug}
                pending={pending}
                theme={themePending}
                themeWarnings={themeWarnings.slice(0, 8)}
              />
            )}
          </>
        }
      />
      <PageBody>
        {!site ? (
          <>
            <Card title={t('website.chooseTemplate')} sub={t('website.chooseTemplateSub')}>
              {canDesign ? (
                gallery
              ) : (
                <EmptyState
                  icon={<Globe className="size-5" />}
                  title={t('website.craftingTitle')}
                  description={t('website.craftingBody')}
                />
              )}
            </Card>
            {requestsCard}
          </>
        ) : (
          <>
            <div className="crm-card flex flex-wrap items-center gap-3" data-testid="studio-status">
              <Pill tone={STUDIO_TONE[studioStatus] ?? 'neutral'} dot>
                {t(`website.status.${studioStatus}.label`)}
              </Pill>
              <p className="crm-muted min-w-0 flex-1 text-sm">
                {site.studioStatus === 'review'
                  ? t('website.studioReview')
                  : site.studioStatus === 'approved'
                    ? t('website.studioApproved')
                    : t('website.studioBuilding')}
              </p>
              {openRequests > 0 && (
                <span className="crm-muted text-sm">
                  {t('website.openRequests', { count: openRequests })}
                </span>
              )}
            </div>
            {canDesign && undo && (
              <UndoTemplateBar
                slug={slug}
                from={nameOf(undo.templateKey)}
                to={current?.name ?? site.templateKey}
                at={fmt.dateTime(new Date(undo.at))}
                pages={undo.pages.length}
              />
            )}
            <Grid cols="col-2b">
              <Stack>
                <Card
                  title={t('website.yourWebsite')}
                  sub={`${host} · ${t('website.languages')}`}
                  actions={
                    hasLive && (
                      <Pill tone="ok" dot>
                        {t('website.live')}
                      </Pill>
                    )
                  }
                >
                  <SiteFrame url={host}>
                    <ScaledFrame src={preview()} title={t('website.homePage')} className="aspect-[16/11]" />
                  </SiteFrame>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="crm-ey">{t('website.template')}</p>
                      <p className="text-[15px] font-semibold" data-testid="current-template">
                        {current?.name ?? site.templateKey}
                      </p>
                    </div>
                    <span className="flex flex-wrap gap-2">
                      <CopyButton value={publicUrl} label={t('website.copyLink')} />
                      {canDesign && (
                        <ThemeSheet
                          slug={slug}
                          theme={normalizeTheme(site.theme)}
                          draft={site.themeDraft !== null}
                        />
                      )}
                    </span>
                  </div>
                </Card>
                {requestsCard}
              </Stack>
              <Stack>
                {glance && (
                  <Card
                    title={t('website.glance')}
                    sub={t('website.glanceSub')}
                    actions={
                      <Link
                        href={appPath(`/${slug}/analytics`)}
                        className="crm-muted inline-flex items-center gap-1 text-sm hover:text-fg"
                      >
                        {t('website.openAnalytics')} <ArrowRight className="size-3.5 rtl:rotate-180" />
                      </Link>
                    }
                  >
                    <Grid cols="g2">
                      <Stat label={t('website.visitors')} value={fmt.number(glance.visitors)} />
                      <Stat
                        label={t('website.conversion')}
                        value={fmt.percent(glance.visitors ? glance.booked / glance.visitors : 0)}
                        change={{ text: t('website.conversionSub', { count: glance.booked }) }}
                      />
                    </Grid>
                  </Card>
                )}
                {pagesCard}
                <Card
                  title={t('website.domain')}
                  actions={
                    can(ctx, 'settings.manage') && (
                      <Link
                        href={appPath(`/${slug}/settings/domains`)}
                        className="crm-muted inline-flex items-center gap-1 text-sm hover:text-fg"
                      >
                        {t('website.manageDomains')} <ArrowRight className="size-3.5 rtl:rotate-180" />
                      </Link>
                    )
                  }
                >
                  {hosts.length === 0 ? (
                    <ListRow
                      icon={<Globe className="size-4" />}
                      title={<span className="break-all">{host}</span>}
                      body={t('website.domainFree')}
                      end={
                        <Pill tone="ok" dot>
                          {t('website.sslOn')}
                        </Pill>
                      }
                    />
                  ) : (
                    hosts.map((d) => (
                      <ListRow
                        key={d.id}
                        icon={<Globe className="size-4" />}
                        title={<span className="break-all">{d.hostname}</span>}
                        body={[
                          enumLabel(t, 'domainKind', d.kind),
                          d.isPrimary ? t('website.primary') : null,
                          d.status === 'active'
                            ? `${t('website.ssl')}: ${d.kind === 'subdomain' || d.sslStatus === 'active' ? t('website.sslOn') : t('website.sslPending')}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        end={
                          <Pill
                            tone={d.status === 'active' ? 'ok' : d.status === 'failed' ? 'bad' : 'warn'}
                            dot
                          >
                            {enumLabel(t, 'domainStatus', d.status)}
                          </Pill>
                        }
                      />
                    ))
                  )}
                </Card>
              </Stack>
            </Grid>
            {canDesign && (
              <Card title={t('website.templates')} sub={t('website.templatesSub')}>
                {gallery}
              </Card>
            )}
          </>
        )}
      </PageBody>
    </>
  )
}
