import { mcpResourceUrl } from '@spa/auth'
import { oauthClient, oauthConsent, oauthRefreshToken, platformDb, siteAiEditorStatus } from '@spa/db'
import { type WebsiteOverviewRow, websiteOverview } from '@spa/services'
import { and, desc, eq, max } from 'drizzle-orm'
import { PanelsTopLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { StatCard } from '@/components/ui/stat-card'
import { DataTable } from '@/components/ui/table'
import { studioPath } from '@/lib/paths'
import { formatDateTime } from '@/lib/utils'
import { requirePlatformAdmin } from '@/server/access'
import { siteUrlFrom } from '@/server/sites'
import { type ClaudeClient, ConnectClaudeCard } from './connect-claude'
import { NextStepButton, WebsiteStatusBadge } from './next-step'

export const metadata: Metadata = { title: 'Websites' }

/** List order: open requests first, then the furthest from live, then name. */
const ORDER = (r: WebsiteOverviewRow) =>
  r.status === 'none' ? 0 : r.status === 'template' ? 1 : r.status === 'draft' ? 2 : r.unpublished ? 3 : 4

/** The signed-in super-admin's connected Claude (MCP) clients: consent + newest refresh-token sign-in. */
async function claudeClients(userId: string): Promise<ClaudeClient[]> {
  const rows = await platformDb()
    .select({
      clientId: oauthConsent.clientId,
      name: oauthClient.name,
      connectedAt: oauthConsent.createdAt,
      lastUsedAt: max(oauthRefreshToken.createdAt),
    })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .leftJoin(
      oauthRefreshToken,
      and(eq(oauthRefreshToken.clientId, oauthConsent.clientId), eq(oauthRefreshToken.userId, userId)),
    )
    .where(eq(oauthConsent.userId, userId))
    .groupBy(oauthConsent.clientId, oauthClient.name, oauthConsent.createdAt)
    .orderBy(desc(oauthConsent.createdAt))
  return rows.map((r) => ({
    clientId: r.clientId,
    name: r.name?.trim() || 'Claude',
    connectedAt: r.connectedAt?.toISOString() ?? null,
    lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt).toISOString() : null,
  }))
}

export default async function PlatformWebsitesPage() {
  const { user } = await requirePlatformAdmin()
  const [claudeEnabled, clients, overview] = await Promise.all([
    siteAiEditorStatus(platformDb(), user.id).then((s) => s === 'ok'),
    claudeClients(user.id),
    websiteOverview(),
  ])
  const rows = overview.sort(
    (a, b) => b.openRequests - a.openRequests || ORDER(a) - ORDER(b) || a.name.localeCompare(b.name),
  )
  const open = rows.reduce((n, r) => n + r.openRequests, 0)
  return (
    <>
      <PageHeader
        title="Websites"
        description="Every spa's website, built and published here. The spa sends change requests."
      />
      <PageBody>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Not started" value={rows.filter((r) => r.status === 'none').length} />
          <StatCard
            label="In progress"
            value={rows.filter((r) => r.status === 'template' || r.status === 'draft').length}
          />
          <StatCard label="Live" value={rows.filter((r) => r.status === 'live').length} />
          <StatCard label="Open change requests" value={open} />
        </div>
        <Card>
          <DataTable
            rows={rows}
            rowKey={(r) => r.tenantId}
            empty={<EmptyState icon={<PanelsTopLeft className="size-5" />} title="No spas yet" />}
            columns={[
              {
                key: 'spa',
                header: 'Spa',
                primary: true,
                cell: (r) => (
                  <span className="block min-w-0">
                    <Link
                      href={studioPath(r.slug)}
                      className="block truncate font-medium underline-offset-4 hover:underline"
                    >
                      {r.name}
                    </Link>
                    <span className="block truncate text-xs text-muted">
                      /{r.slug} ·{' '}
                      {r.livePages
                        ? `${r.livePages} live ${r.livePages === 1 ? 'page' : 'pages'}`
                        : 'Not live'}
                      {r.updatedAt ? ` · updated ${formatDateTime(r.updatedAt)}` : ''}
                    </span>
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'Website',
                cell: (r) => <WebsiteStatusBadge status={r.status} unpublished={r.unpublished} />,
              },
              {
                key: 'requests',
                header: 'Requests',
                cell: (r) =>
                  r.openRequests ? (
                    <Link href={studioPath(r.slug, '#requests')} aria-label={`Open requests for ${r.name}`}>
                      <Badge tone="accent">{r.openRequests} open</Badge>
                    </Link>
                  ) : (
                    <span className="text-sm text-muted">—</span>
                  ),
              },
              {
                key: 'next',
                header: 'Next step',
                className: 'md:text-end',
                cell: (r) => <NextStepButton row={r} url={siteUrlFrom(r.slug, r.primaryHost)} />,
              },
            ]}
          />
        </Card>
        <ConnectClaudeCard url={mcpResourceUrl()} enabled={claudeEnabled} clients={clients} />
      </PageBody>
    </>
  )
}
