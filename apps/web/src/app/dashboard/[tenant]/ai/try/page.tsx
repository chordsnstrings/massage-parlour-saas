import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { ReceptionistChat } from './chat'

export const metadata: Metadata = { title: 'Try the AI receptionist' }

export default async function TryReceptionist({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'ai.approve')) notFound()
  return (
    <>
      <Link
        href={appPath(`/${ctx.tenant.slug}/ai`)}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" strokeWidth={1.5} /> AI studio
      </Link>
      <PageHeader
        title="Try your AI receptionist"
        description="This is how clients will be answered on Instagram once your account is connected."
      />
      <ReceptionistChat slug={ctx.tenant.slug} spaName={ctx.tenant.name} />
    </>
  )
}
