// R33: the spa website page's Redirects card (console, English): how many, the newest five, "Manage redirects" →
// the Redirects page (websites/[slug]/redirects). Loads its own rows.
import { withTenant } from '@spa/db'
import { listSiteRedirects } from '@spa/services'
import { ArrowRight, Route } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { studioPath } from '@/lib/paths'

export async function RedirectsCard({ slug, tenantId }: { slug: string; tenantId: string }) {
  const rows = await withTenant(tenantId, (tx) => listSiteRedirects(tx, tenantId))
  return (
    <Card data-testid="redirects-card">
      <CardHeader
        title="Redirects"
        description={
          rows.length
            ? `${rows.length} old ${rows.length === 1 ? 'address goes' : 'addresses go'} to pages of this site (301).`
            : 'Send old website addresses (e.g. Search Console’s 404 list) to the new pages.'
        }
        action={
          <Button variant="secondary" size="sm" asChild className="h-10">
            <Link href={studioPath(slug, '/redirects')}>
              <Route /> Manage redirects
            </Link>
          </Button>
        }
      />
      {rows.length > 0 && (
        <CardBody>
          <ul className="space-y-2 text-sm">
            {rows.slice(0, 5).map((r) => (
              <li key={r.id} className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate">
                  {r.fromQuery ? `${r.fromPath}?${r.fromQuery}` : r.fromPath}
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-muted" />
                <span className="min-w-0 truncate text-muted">{r.toPath}</span>
                {r.inactive && (
                  <Badge tone="warning" className="ms-auto">
                    Inactive
                  </Badge>
                )}
                {!r.inactive && r.targetMissing && (
                  <Badge tone="danger" className="ms-auto">
                    Page missing
                  </Badge>
                )}
              </li>
            ))}
          </ul>
          {rows.length > 5 && <p className="mt-3 text-xs text-muted">and {rows.length - 5} more</p>}
        </CardBody>
      )}
    </Card>
  )
}
