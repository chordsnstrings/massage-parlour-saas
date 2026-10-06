import { siteUrl } from '@spa/core'
import { branches, members, subscriptions, withTenant } from '@spa/db'
import { count, eq } from 'drizzle-orm'
import { ArrowUpRight, Check, Circle } from 'lucide-react'
import Link from 'next/link'
import { Badge, statusTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { PageBody, PageHeader } from '@/components/ui/page'
import { formatDate } from '@/lib/utils'
import { can, requireMember } from '@/server/access'

function greeting() {
  const h = Number(
    new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Dubai' }),
  )
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default async function TenantHome({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  const { tenant } = ctx
  const data = await withTenant(tenant.id, async (tx) => {
    const [branch] = await tx.select().from(branches).where(eq(branches.isDefault, true)).limit(1)
    const [team] = await tx.select({ n: count() }).from(members)
    const [sub] = await tx.select().from(subscriptions).limit(1)
    return { branch, teamSize: team?.n ?? 0, sub }
  })
  const site = siteUrl(tenant.slug, process.env.ROOT_DOMAIN ?? 'localhost:3000')
  const steps = [
    {
      done: Boolean(data.branch?.whatsappE164 && data.branch.address),
      label: 'Add your address and WhatsApp number',
      href: `/${tenant.slug}/settings`,
      show: can(ctx, 'settings.manage'),
    },
    {
      done: data.teamSize > 1,
      label: 'Invite your team',
      href: `/${tenant.slug}/team`,
      show: can(ctx, 'team.manage'),
    },
    { done: false, label: 'Add services, rooms and therapists', note: 'Coming in the next update' },
    { done: false, label: 'Design and publish your website', note: 'Coming in the next update' },
  ].filter((s) => s.show !== false)
  const doneCount = steps.filter((s) => s.done).length

  return (
    <>
      <PageHeader
        eyebrow={tenant.name}
        title={`${greeting()}, ${ctx.user.name.split(' ')[0]}`}
        description="Here's where your spa stands today."
        actions={
          <Button variant="secondary" asChild>
            <a href={site} target="_blank" rel="noreferrer">
              View website <ArrowUpRight />
            </a>
          </Button>
        }
      />
      <PageBody>
        <Stagger className="grid gap-6 lg:grid-cols-12">
          <StaggerItem className="lg:col-span-8">
            <Card className="h-full">
              <CardHeader
                title="Get set up"
                description={`${doneCount} of ${steps.length} done`}
                action={
                  <div className="h-1.5 w-28 overflow-hidden rounded-full bg-subtle">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-700"
                      style={{ width: `${(doneCount / steps.length) * 100}%` }}
                    />
                  </div>
                }
              />
              <CardBody>
                <ul className="divide-y">
                  {steps.map((s) => {
                    const row = (
                      <span className="flex items-center gap-3 py-3.5">
                        {s.done ? (
                          <span className="grid size-5 place-items-center rounded-full bg-accent text-accent-fg">
                            <Check className="size-3" strokeWidth={2.5} />
                          </span>
                        ) : (
                          <Circle className="size-5 text-border" strokeWidth={1.5} />
                        )}
                        <span className={s.done ? 'text-muted line-through decoration-border' : ''}>
                          {s.label}
                        </span>
                        {s.note && <span className="ms-auto text-xs text-muted">{s.note}</span>}
                      </span>
                    )
                    return (
                      <li key={s.label}>
                        {s.href && !s.done ? (
                          <Link href={s.href} className="block transition-colors hover:text-accent">
                            {row}
                          </Link>
                        ) : (
                          row
                        )}
                      </li>
                    )
                  })}
                </ul>
              </CardBody>
            </Card>
          </StaggerItem>
          <StaggerItem className="space-y-6 lg:col-span-4">
            <Card>
              <CardHeader title="Your website" description="Live now — design tools arrive next." />
              <CardBody className="space-y-3">
                <p className="truncate rounded-lg bg-subtle px-3 py-2 font-mono text-[13px]">
                  {site.replace(/^https?:\/\//, '')}
                </p>
                <Button variant="secondary" size="sm" asChild>
                  <a href={site} target="_blank" rel="noreferrer">
                    Open <ArrowUpRight />
                  </a>
                </Button>
              </CardBody>
            </Card>
            {data.sub && can(ctx, 'billing.view') && (
              <Card>
                <CardHeader
                  title="Subscription"
                  action={<Badge tone={statusTone(data.sub.status)}>{data.sub.status}</Badge>}
                />
                <CardBody className="text-sm text-muted">
                  {data.sub.status === 'trialing' ? 'Trial ends' : 'Renews'} on{' '}
                  <span className="text-fg">{formatDate(data.sub.currentPeriodEnd)}</span>
                </CardBody>
              </Card>
            )}
          </StaggerItem>
        </Stagger>
      </PageBody>
    </>
  )
}
