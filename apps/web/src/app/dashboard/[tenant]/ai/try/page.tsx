import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page'
import { getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { ReceptionistChat } from './chat'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('ai.tryMeta') }
}

export default async function TryReceptionist({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'ai.approve')) notFound()
  const t = await getT()
  return (
    <>
      <Link
        href={appPath(`/${ctx.tenant.slug}/ai`)}
        className="crm-muted mb-4 inline-flex items-center gap-1.5 text-sm transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" strokeWidth={1.5} /> {t('ai.studio')}
      </Link>
      <PageHeader
        title={t('ai.tryTitle')}
        description={t('ai.tryDescription')}
      />
      <ReceptionistChat slug={ctx.tenant.slug} spaName={ctx.tenant.name} />
    </>
  )
}
