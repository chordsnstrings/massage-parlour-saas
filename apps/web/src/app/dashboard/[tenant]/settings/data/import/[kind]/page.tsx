import { IMPORT_FIELDS, type ImportKind, isImportKind } from '@spa/services'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ImportWizard } from '@/components/data/import-wizard'
import { IMPORT_LABEL, IMPORT_PERMISSION } from '@/components/data/kinds'
import { PageBody, PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'

export const metadata: Metadata = { title: 'Import' }

const COPY: Record<ImportKind, { title: string; description: string; done: string; donePath: string }> = {
  clients: {
    title: 'Import clients',
    description:
      'Upload a CSV, check how its columns match, and we add new clients or update the ones you already have.',
    done: 'View clients',
    donePath: 'clients',
  },
  menu: {
    title: 'Import your menu',
    description:
      'One row per service and duration. Rows with the same service name become one service with several options.',
    done: 'View services',
    donePath: 'services',
  },
  products: {
    title: 'Import products',
    description:
      'Retail products and treatment consumables with cost, price and the stock you have on hand today.',
    done: 'View inventory',
    donePath: 'inventory',
  },
}

export default async function ImportPage({ params }: { params: Promise<{ tenant: string; kind: string }> }) {
  const { tenant, kind } = await params
  const ctx = await requireMember(tenant)
  if (!isImportKind(kind) || !can(ctx, IMPORT_PERMISSION[kind])) notFound()
  const slug = ctx.tenant.slug
  const copy = COPY[kind]
  return (
    <>
      <Link
        href={appPath(`/${slug}/settings/data`)}
        className="mb-6 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" strokeWidth={1.5} /> Import &amp; export
      </Link>
      <PageHeader eyebrow={IMPORT_LABEL[kind]} title={copy.title} description={copy.description} />
      <PageBody>
        <ImportWizard
          kind={kind}
          fields={IMPORT_FIELDS[kind]}
          uploadUrl={appPath(`/${slug}/settings/data/upload`)}
          templateUrl={appPath(`/${slug}/settings/data/template?kind=${kind}`)}
          done={{ label: copy.done, href: appPath(`/${slug}/${copy.donePath}`) }}
          historyHref={appPath(`/${slug}/settings/data`)}
        />
      </PageBody>
    </>
  )
}
