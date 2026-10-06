import { DEFAULT_HOURS } from '@spa/core'
import { branches, withTenant } from '@spa/db'
import { asc, desc } from 'drizzle-orm'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { PageBody, PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { HoursForm } from './hours-client'

export const metadata: Metadata = { title: 'Opening hours' }

export default async function HoursPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'settings.manage')) notFound()
  const slug = ctx.tenant.slug
  const rows = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .select({
        id: branches.id,
        name: branches.name,
        openingHours: branches.openingHours,
        cutoff: branches.businessDayCutoff,
      })
      .from(branches)
      .orderBy(desc(branches.isDefault), asc(branches.createdAt)),
  )
  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={appPath(`/${slug}/settings`)}
            className="inline-flex items-center gap-1 transition-colors hover:text-fg"
          >
            <ArrowLeft className="size-3.5" /> Settings
          </Link>
        }
        title="Opening hours"
        description="When clients can book. Add a second interval for split shifts; a closing time earlier than opening runs past midnight."
      />
      <PageBody>
        {rows.map((b) => {
          const configured = Object.keys(b.openingHours ?? {}).length > 0
          return (
            <Card key={b.id}>
              <CardHeader
                title={b.name}
                description={
                  configured
                    ? `Business day ends at ${b.cutoff.slice(0, 5)} — late-night sales count toward the previous day.`
                    : 'Not set yet — showing the default (10:00–midnight daily). Save to confirm.'
                }
              />
              <CardBody>
                <HoursForm
                  slug={slug}
                  branchId={b.id}
                  initial={configured ? b.openingHours : DEFAULT_HOURS}
                />
              </CardBody>
            </Card>
          )
        })}
      </PageBody>
    </>
  )
}
