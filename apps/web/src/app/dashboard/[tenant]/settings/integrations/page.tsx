import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GbpCard } from '@/components/integrations/gbp-card'
import { InstagramCard } from '@/components/integrations/instagram-card'
import { PageBody, PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'

export const metadata: Metadata = { title: 'Instagram & Google' }

/** Integration hub: each provider card is owned by its own module (components/integrations/*). */
export default async function IntegrationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'ai.manage') && !can(ctx, 'settings.manage')) notFound()
  const sp = await searchParams
  return (
    <>
      <Link
        href={appPath(`/${ctx.tenant.slug}/settings`)}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" strokeWidth={1.5} /> Settings
      </Link>
      <PageHeader
        title="Instagram & Google"
        description="Connect your accounts so the AI agents can answer DMs and comments, publish posts and reply to Google reviews — always within the rules you set in AI studio."
      />
      <PageBody className="grid gap-6 lg:grid-cols-2">
        <InstagramCard ctx={ctx} searchParams={sp} />
        <GbpCard ctx={ctx} searchParams={sp} />
      </PageBody>
    </>
  )
}
