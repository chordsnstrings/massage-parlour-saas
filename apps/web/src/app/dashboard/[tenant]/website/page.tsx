import { withTenant } from '@spa/db'
import { getSite, listPages } from '@spa/services'
import { ExternalLink, FileText, Globe, PencilLine } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ScaledFrame } from '@/components/site/scaled-frame'
import { TEMPLATE_KEYS, TEMPLATES } from '@/components/site/templates'
import { normalizeTheme } from '@/components/site/theme'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { CopyButton } from '@/components/ui/copy-button'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { appPath } from '@/lib/paths'
import { formatDateTime } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { publicSiteUrl } from '@/server/sites'
import {
  ApplyTemplateSheet,
  PublishSiteSheet,
  ThemeSheet,
  UseTemplateButton,
  VisibilityToggle,
} from './website-client'

export const metadata: Metadata = { title: 'Website' }

export default async function WebsitePage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'site.content') && !can(ctx, 'site.design') && !can(ctx, 'site.publish')) notFound()
  const slug = ctx.tenant.slug
  const { site, pages } = await withTenant(ctx.tenant.id, async (tx) => ({
    site: await getSite(tx, ctx.tenant.id),
    pages: await listPages(tx, ctx.tenant.id),
  }))
  const canDesign = can(ctx, 'site.design')
  const canPublish = can(ctx, 'site.publish')
  const publicUrl = await publicSiteUrl(ctx.tenant)
  const pending = pages.filter((p) => p.hasDraft).length
  const hasLive = pages.some((p) => p.publishedAt)
  const preview = (template: string) => appPath(`/${slug}/website/preview?template=${template}`)
  const current = site ? TEMPLATES[site.templateKey as keyof typeof TEMPLATES] : null

  const gallery = (
    <Stagger className="grid gap-5 md:grid-cols-3">
      {TEMPLATE_KEYS.map((key) => {
        const t = TEMPLATES[key]
        const isCurrent = site?.templateKey === key
        return (
          <StaggerItem key={key}>
            <article className="group overflow-hidden rounded-xl border bg-surface transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-fg/15 hover:shadow-soft">
              <ScaledFrame src={preview(key)} title={`${t.name} preview`} className="aspect-[4/3] border-b" />
              <div className="space-y-4 p-5">
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-[15px] font-semibold tracking-tight">{t.name}</h3>
                    {isCurrent && <Badge tone="accent">Current</Badge>}
                  </div>
                  <p className="text-sm text-muted">{t.feel}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" asChild className="flex-1">
                    <a href={preview(key)} target="_blank" rel="noreferrer">
                      Try on <ExternalLink />
                    </a>
                  </Button>
                  {canDesign && !isCurrent && (
                    <div className="flex-1">
                      {site ? (
                        <ApplyTemplateSheet
                          slug={slug}
                          template={key}
                          name={t.name}
                          hasLiveContent={hasLive}
                        />
                      ) : (
                        <UseTemplateButton slug={slug} template={key} name={t.name} />
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

  return (
    <>
      <PageHeader
        title="Website"
        description="Your spa's public site. Prices, team and opening hours stay in sync with your dashboard."
        actions={
          site && (
            <>
              <Button variant="secondary" asChild>
                <a href={publicUrl} target="_blank" rel="noreferrer">
                  <Globe /> View site
                </a>
              </Button>
              {canPublish && pending > 0 && <PublishSiteSheet slug={slug} pending={pending} />}
            </>
          )
        }
      />
      <PageBody>
        {!site ? (
          <Card>
            <CardHeader
              title="Choose a template"
              description="Each preview uses your own services, team and hours. You can switch later without losing your words."
            />
            <CardBody>
              {canDesign ? (
                gallery
              ) : (
                <EmptyState
                  icon={<Globe className="size-5" />}
                  title="No website yet"
                  description="Ask the owner or a manager to choose a template first."
                />
              )}
            </CardBody>
          </Card>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-12">
              <Card className="lg:col-span-8">
                <CardHeader
                  title="Pages"
                  description={
                    pending > 0
                      ? `${pending} ${pending === 1 ? 'page has' : 'pages have'} unpublished changes`
                      : 'Everything is live'
                  }
                />
                <div className="mt-4 border-t">
                  <DataTable
                    rows={pages}
                    rowKey={(p) => p.id}
                    empty={<EmptyState icon={<FileText className="size-5" />} title="No pages yet" />}
                    columns={[
                      {
                        key: 'page',
                        header: 'Page',
                        primary: true,
                        cell: (p) => (
                          <span className="flex min-w-0 items-center justify-between gap-3">
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{p.title.en}</span>
                              <span className="block truncate text-xs text-muted">/{p.slug}</span>
                            </span>
                            <Button variant="secondary" size="sm" asChild className="h-10 md:hidden">
                              <Link href={appPath(`/${slug}/website/editor/${p.id}`)}>
                                <PencilLine /> Edit
                              </Link>
                            </Button>
                          </span>
                        ),
                      },
                      {
                        key: 'status',
                        header: 'Status',
                        cell: (p) => (
                          <span className="inline-flex flex-col items-end gap-1 md:items-start">
                            {!p.publishedAt ? (
                              <Badge tone="warning">Not published</Badge>
                            ) : p.hasDraft ? (
                              <Badge tone="accent">Unpublished changes</Badge>
                            ) : (
                              <Badge tone="success">Live</Badge>
                            )}
                            {p.publishedAt && (
                              <span className="text-xs text-muted tabular">
                                Published {formatDateTime(p.publishedAt)}
                              </span>
                            )}
                          </span>
                        ),
                      },
                      {
                        key: 'visible',
                        header: 'In menu',
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
                        header: <span className="sr-only">Actions</span>,
                        className: 'text-end',
                        hideOnMobile: true,
                        cell: (p) => (
                          <Button variant="secondary" size="sm" asChild>
                            <Link
                              href={appPath(`/${slug}/website/editor/${p.id}`)}
                              aria-label={`Edit ${p.title.en}`}
                            >
                              <PencilLine /> Edit
                            </Link>
                          </Button>
                        ),
                      },
                    ]}
                  />
                </div>
              </Card>
              <Card className="overflow-hidden lg:col-span-4">
                <ScaledFrame
                  src={preview(site.templateKey)}
                  title="Your home page"
                  className="aspect-[16/11] border-b"
                />
                <CardBody className="space-y-4">
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted">Template</p>
                    <p className="text-[15px] font-semibold tracking-tight">
                      {current?.name ?? site.templateKey}
                    </p>
                  </div>
                  <div className="flex min-w-0 items-center gap-2 rounded-lg bg-subtle px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-muted">
                      {publicUrl.replace(/^https?:\/\//, '')}
                    </span>
                    <CopyButton value={publicUrl} label="Copy link" />
                  </div>
                  {canDesign && <ThemeSheet slug={slug} theme={normalizeTheme(site.theme)} />}
                </CardBody>
              </Card>
            </div>
            <Card>
              <CardHeader
                title="Templates"
                description="Try a new look with your own content. Switching keeps your words and images."
              />
              <CardBody>{gallery}</CardBody>
            </Card>
          </>
        )}
      </PageBody>
    </>
  )
}
