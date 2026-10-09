import { mcpResourceUrl } from '@spa/auth'
import { oauthClient, oauthConsent, oauthRefreshToken, platformDb, siteAiEditorStatus } from '@spa/db'
import { studioOverview } from '@spa/services'
import { and, desc, eq, max } from 'drizzle-orm'
import { ArrowUpRight, PanelsTopLeft } from 'lucide-react'
import type { Metadata } from 'next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { StatCard } from '@/components/ui/stat-card'
import { DataTable } from '@/components/ui/table'
import { formatDateTime } from '@/lib/utils'
import { requirePlatformAdmin } from '@/server/access'
import { requestUrls } from '@/server/origin'
import { type ClaudeClient, ConnectClaudeCard } from './connect-claude'

export const metadata: Metadata = { title: 'Websites' }

const STATUS = {
  none: { label: 'Not started', tone: 'warning' },
  building: { label: 'In the studio', tone: 'neutral' },
  review: { label: 'With the spa', tone: 'accent' },
  approved: { label: 'Approved', tone: 'success' },
} as const

/** Website Studio (PLAN §14.4): every spa's site, its review state and open change requests. */
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
  const [claudeEnabled, clients] = await Promise.all([
    siteAiEditorStatus(platformDb(), user.id).then((s) => s === 'ok'),
    claudeClients(user.id),
  ])
  const urls = await requestUrls()
  const rows = (await studioOverview()).sort(
    (a, b) => b.openRequests - a.openRequests || Number(a.hasSite) - Number(b.hasSite),
  )
  const open = rows.reduce((n, r) => n + r.openRequests, 0)
  return (
    <>
      <PageHeader
        title="Websites"
        description="Every spa's site is built here as a bespoke service. Open a studio to design, then send it for review."
      />
      <PageBody>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Not started" value={rows.filter((r) => !r.hasSite).length} />
          <StatCard
            label="Waiting on the spa"
            value={rows.filter((r) => r.studioStatus === 'review').length}
          />
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
                    <span className="block truncate font-medium">{r.name}</span>
                    <span className="block truncate text-xs text-muted">
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
                header: 'Studio',
                cell: (r) => {
                  const s = STATUS[r.hasSite ? (r.studioStatus ?? 'building') : 'none']
                  return <Badge tone={s.tone}>{s.label}</Badge>
                },
              },
              {
                key: 'requests',
                header: 'Requests',
                cell: (r) =>
                  r.openRequests ? (
                    <Badge tone="accent">{r.openRequests} open</Badge>
                  ) : (
                    <span className="text-sm text-muted">—</span>
                  ),
              },
              {
                key: 'open',
                header: <span className="sr-only">Actions</span>,
                className: 'text-end',
                cell: (r) => (
                  <Button variant="secondary" size="sm" asChild className="h-10">
                    <a href={urls.app(`/${r.slug}/website`)} aria-label={`Open studio for ${r.name}`}>
                      Open studio <ArrowUpRight />
                    </a>
                  </Button>
                ),
              },
            ]}
          />
        </Card>
        <ConnectClaudeCard url={mcpResourceUrl()} enabled={claudeEnabled} clients={clients} />
      </PageBody>
    </>
  )
}
