// R23 console spa website page: the server-rendered cards (English, components/ui). Client sheets: website-client.tsx.
import type { ChangeRequestRow, listPosts, PageSummary } from '@spa/services'
import { ExternalLink, FileText, Globe, MessageSquare, Newspaper, PencilLine, Plus } from 'lucide-react'
import Link from 'next/link'
import { PAGE_TEMPLATES } from '@/components/site/presets'
import { ScaledFrame } from '@/components/site/scaled-frame'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { adminPath, studioPath } from '@/lib/paths'
import { formatDate, formatDateTime } from '@/lib/utils'
import type { CatalogTemplate } from '@/server/site-templates'
import { ImportSiteSheet } from './import-sheet'
import {
  AddPageSheet,
  ApplyTemplateSheet,
  ResolveRequestSheet,
  UseTemplateButton,
  VisibilityToggle,
} from './website-client'

type Post = Awaited<ReturnType<typeof listPosts>>[number]
type Domain = {
  id: string
  hostname: string
  kind: string
  status: string
  isPrimary: boolean
  sslStatus: string | null
}

/** Unpublished: page drafts and pending page renames (Claude MCP). */
export const pageUnpublished = (p: PageSummary) => p.hasDraft || p.pending !== null

const preview = (slug: string, query = '') => studioPath(slug, `/preview${query ? `?${query}` : ''}`)

/** Template gallery: try on (new tab), first pick or switch (with side-by-side + undo). */
export function TemplatesCard({
  slug,
  catalog,
  site,
  hasLive,
  canDesign,
}: {
  slug: string
  catalog: CatalogTemplate[]
  site: { templateKey: string } | null
  hasLive: boolean
  canDesign: boolean
}) {
  const current = site ? catalog.find((t) => t.key === site.templateKey) : null
  return (
    <Card id="templates" className="scroll-mt-6">
      <CardHeader
        title={site ? 'Templates' : 'Choose a template'}
        description={
          site
            ? "Try a new look with the spa's own content. Switching keeps words and images, and can be undone."
            : "Each preview uses the spa's own services, team and hours. You can switch later without losing words."
        }
      />
      <CardBody>
        <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {catalog.map((tpl) => {
            const isCurrent = site?.templateKey === tpl.key
            return (
              <StaggerItem key={tpl.key}>
                <article
                  aria-label={tpl.name}
                  className="group flex h-full flex-col overflow-hidden rounded-xl border bg-surface transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-soft motion-reduce:hover:translate-y-0"
                >
                  {tpl.source === 'builtin' ? (
                    // Built-ins ship a static thumbnail (public/site-templates, e2e/template-thumbs.spec.ts THUMBS=1).
                    // biome-ignore lint/performance/noImgElement: static public asset, fixed size
                    <img
                      src={`/site-templates/${tpl.key}.webp`}
                      alt={`${tpl.name} preview`}
                      loading="lazy"
                      width={640}
                      height={480}
                      className="aspect-[4/3] w-full border-b bg-subtle object-cover object-top"
                    />
                  ) : (
                    <ScaledFrame
                      src={preview(slug, `template=${tpl.key}&starter=1`)}
                      title={`${tpl.name} preview`}
                      className="aspect-[4/3] border-b"
                    />
                  )}
                  <div className="flex flex-1 flex-col gap-3 p-4">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="truncate text-[15px] font-semibold">{tpl.name}</h3>
                        <span className="flex shrink-0 gap-1.5">
                          {tpl.source === 'studio' && <Badge>Studio</Badge>}
                          {isCurrent && <Badge tone="accent">Current</Badge>}
                        </span>
                      </div>
                      <p className="text-sm text-muted">{tpl.feel}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" asChild className="h-11 flex-1">
                        <a
                          href={preview(slug, site ? `template=${tpl.key}` : `template=${tpl.key}&starter=1`)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Try on ${tpl.name}`}
                        >
                          Try on <ExternalLink />
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
                              nowSrc={preview(slug)}
                              keepSrc={preview(slug, `template=${tpl.key}`)}
                              starterSrc={preview(slug, `template=${tpl.key}&starter=1`)}
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
      </CardBody>
    </Card>
  )
}

const REQUEST_TONE = { open: 'accent', done: 'success', declined: 'neutral' } as const
const REQUEST_LABEL = { open: 'Open', done: 'Done', declined: 'Declined' } as const

/** What the spa asked for (open first); the studio closes each as done or declined with a note. */
export function RequestsCard({
  slug,
  requests,
  canEdit,
}: {
  slug: string
  requests: ChangeRequestRow[]
  canEdit: boolean
}) {
  const rows = [...requests].sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open'))
  const open = rows.filter((r) => r.status === 'open').length
  return (
    <Card id="requests" className="scroll-mt-6">
      <CardHeader
        title="Change requests"
        description={open ? `${open} open · what the spa asked for` : 'What the spa asked for.'}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="size-5" />}
          title="No requests yet"
          description="The spa sends change requests from its Website page."
        />
      ) : (
        <ul className="mt-3 divide-y border-t">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-3 px-[var(--ui-card-pad,1.25rem)] py-4 sm:flex-row sm:items-start sm:justify-between sm:px-[var(--ui-card-pad-sm,1.5rem)]"
            >
              <div className="min-w-0 space-y-1">
                <p className="whitespace-pre-line break-words text-sm">{r.body}</p>
                <p className="text-xs text-muted">
                  {r.pageTitle?.en ?? 'Whole site'} · {formatDateTime(r.createdAt)}
                </p>
                {r.response && (
                  <p className="whitespace-pre-line break-words text-xs text-muted">Studio: {r.response}</p>
                )}
              </div>
              <span className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                <Badge tone={REQUEST_TONE[r.status]}>{REQUEST_LABEL[r.status]}</Badge>
                {canEdit && r.status === 'open' && <ResolveRequestSheet slug={slug} id={r.id} />}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** Pages: status, menu visibility, full-screen editor; import + add page. */
export function PagesCard({
  slug,
  pages,
  themePending,
  canEdit,
  canDesign,
  importAi,
}: {
  slug: string
  pages: PageSummary[]
  themePending: boolean
  canEdit: boolean
  canDesign: boolean
  importAi: boolean
}) {
  const pending = pages.filter(pageUnpublished).length
  const editHref = (p: PageSummary) => studioPath(slug, `/editor/${p.id}`)
  return (
    <Card>
      <CardHeader
        title="Pages"
        description={
          [
            pending > 0
              ? `${pending} ${pending === 1 ? 'page has' : 'pages have'} unpublished changes`
              : null,
            themePending ? 'Site theme changes are waiting to be published' : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'Everything is live'
        }
        action={
          canDesign && (
            <div className="flex flex-wrap gap-2">
              <ImportSiteSheet slug={slug} aiAvailable={importAi} />
              <AddPageSheet
                slug={slug}
                templates={PAGE_TEMPLATES.map((tpl) => ({
                  key: tpl.key,
                  name: tpl.name,
                  description: tpl.description,
                  slug: tpl.slug,
                }))}
              />
            </div>
          )
        }
      />
      <div className="mt-3">
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
                  {canEdit && (
                    <Button variant="secondary" size="sm" asChild className="h-10 md:hidden">
                      <Link href={editHref(p)} aria-label={`Edit ${p.title.en}`}>
                        <PencilLine /> Edit
                      </Link>
                    </Button>
                  )}
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
                  ) : pageUnpublished(p) ? (
                    <Badge tone="accent">Unpublished changes</Badge>
                  ) : (
                    <Badge tone="success">Live</Badge>
                  )}
                  {p.publishedAt && (
                    <span className="text-xs text-muted tabular-nums">
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
              cell: (p) =>
                canEdit && (
                  <Button variant="secondary" size="sm" asChild>
                    <Link href={editHref(p)} aria-label={`Edit ${p.title.en}`}>
                      <PencilLine /> Edit
                    </Link>
                  </Button>
                ),
            },
          ]}
        />
      </div>
    </Card>
  )
}

/** F15 blog: posts live at /blog/{slug}; the BlogList block shows the published ones. */
export function BlogCard({ slug, posts, canEdit }: { slug: string; posts: Post[]; canEdit: boolean }) {
  return (
    <Card>
      <CardHeader
        title="Blog"
        description="Articles at /blog on the site. A post shows in the Blog list block, search results and the sitemap once published."
        action={
          canEdit && (
            <Button variant="secondary" size="sm" asChild className="h-10">
              <Link href={studioPath(slug, '/blog/new')}>
                <Plus /> New post
              </Link>
            </Button>
          )
        }
      />
      <div className="mt-3">
        <DataTable
          rows={posts}
          rowKey={(p) => p.id}
          empty={
            <EmptyState
              icon={<Newspaper className="size-5" />}
              title="No posts yet"
              description="Write the first article — it stays a draft until you publish it."
            />
          }
          columns={[
            {
              key: 'post',
              header: 'Post',
              primary: true,
              cell: (p) => (
                <span className="block min-w-0">
                  <span className="block truncate font-medium">{p.title.en}</span>
                  <span className="block truncate text-xs text-muted">/blog/{p.slug}</span>
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              cell: (p) => (
                <span className="inline-flex flex-col items-end gap-1 md:items-start">
                  <Badge tone={p.status === 'published' ? 'success' : 'warning'}>
                    {p.status === 'published' ? 'Published' : 'Draft'}
                  </Badge>
                  {p.publishedAt && (
                    <span className="text-xs text-muted tabular-nums">
                      Published {formatDate(p.publishedAt)}
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: 'edit',
              header: <span className="sr-only">Actions</span>,
              className: 'text-end',
              cell: (p) =>
                canEdit && (
                  <Button variant="secondary" size="sm" asChild>
                    <Link href={studioPath(slug, `/blog/${p.id}`)} aria-label={`Edit ${p.title.en}`}>
                      <PencilLine /> Edit
                    </Link>
                  </Button>
                ),
            },
          ]}
        />
      </div>
    </Card>
  )
}

const DOMAIN_TONE = { active: 'success', failed: 'danger' } as const

/** Read-only: the spa's addresses (custom domains are managed in Console → Domains). */
export function DomainCard({ host, domains }: { host: string; domains: Domain[] }) {
  return (
    <Card>
      <CardHeader
        title="Domain & security"
        action={
          <Link href={adminPath('/domains')} className="text-sm text-muted hover:text-fg">
            Manage domains
          </Link>
        }
      />
      <ul className="mt-3 divide-y border-t">
        {(domains.length
          ? domains
          : [
              {
                id: 'free',
                hostname: host,
                kind: 'subdomain',
                status: 'active',
                isPrimary: true,
                sslStatus: null,
              },
            ]
        ).map((d) => (
          <li
            key={d.id}
            className="flex items-start justify-between gap-3 px-[var(--ui-card-pad,1.25rem)] py-3.5 sm:px-[var(--ui-card-pad-sm,1.5rem)]"
          >
            <span className="flex min-w-0 items-start gap-3">
              <Globe className="mt-0.5 size-4 shrink-0 text-muted" />
              <span className="min-w-0">
                <span className="block break-all text-sm font-medium">{d.hostname}</span>
                <span className="block text-xs text-muted">
                  {[
                    d.id === 'free' ? 'Free address' : d.kind === 'custom' ? 'Own domain' : 'Subdomain',
                    d.isPrimary && d.id !== 'free' ? 'Primary' : null,
                    d.status === 'active'
                      ? d.kind === 'subdomain' || d.sslStatus === 'active'
                        ? 'Secure (https)'
                        : 'SSL setting up'
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            </span>
            <Badge tone={DOMAIN_TONE[d.status as keyof typeof DOMAIN_TONE] ?? 'warning'}>{d.status}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  )
}
