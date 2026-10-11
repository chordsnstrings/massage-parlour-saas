import { IMPORT_FIELDS, type ImportKind, isImportKind } from '@spa/services'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ImportWizard } from '@/components/data/import-wizard'
import { IMPORT_PERMISSION } from '@/components/data/kinds'
import { PageHeader } from '@/components/ui/page'
import { getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }): Promise<Metadata> {
  const { kind } = await params
  const t = await getT()
  return { title: isImportKind(kind) ? t(`settings.data.page.title.${kind}`) : t('settings.data.title') }
}

const DONE_PATH: Record<ImportKind, string> = { clients: 'clients', menu: 'services', products: 'inventory' }

export default async function ImportPage({ params }: { params: Promise<{ tenant: string; kind: string }> }) {
  const { tenant, kind } = await params
  const ctx = await requireMember(tenant)
  if (!isImportKind(kind) || !can(ctx, IMPORT_PERMISSION[kind])) notFound()
  const slug = ctx.tenant.slug
  const t = await getT()
  return (
    <>
      <Link
        href={appPath(`/${slug}/settings/data`)}
        className="crm-muted mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" strokeWidth={1.5} /> {t('settings.data.title')}
      </Link>
      <PageHeader
        eyebrow={t(`settings.data.kinds.${kind}`)}
        title={t(`settings.data.page.title.${kind}`)}
        description={t(`settings.data.page.description.${kind}`)}
      />
      <ImportWizard
        kind={kind}
        fields={IMPORT_FIELDS[kind]}
        uploadUrl={appPath(`/${slug}/settings/data/upload`)}
        templateUrl={appPath(`/${slug}/settings/data/template?kind=${kind}`)}
        done={{ label: t(`settings.data.page.done.${kind}`), href: appPath(`/${slug}/${DONE_PATH[kind]}`) }}
        historyHref={appPath(`/${slug}/settings/data`)}
      />
    </>
  )
}
