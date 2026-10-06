import { intakeTemplates, withTenant } from '@spa/db'
import { desc, eq } from 'drizzle-orm'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageBody, PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { formatDate } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { IntakeEditor, RecommendedButton } from './intake-editor'

export const metadata: Metadata = { title: 'Intake form' }

export default async function IntakeSettingsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'settings.manage')) notFound()
  const slug = ctx.tenant.slug
  const [template] = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .select()
      .from(intakeTemplates)
      .where(eq(intakeTemplates.active, true))
      .orderBy(desc(intakeTemplates.version))
      .limit(1),
  )
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={appPath(`/${slug}/settings`)} className="inline-flex items-center gap-1 hover:text-fg">
            <ArrowLeft className="size-3.5 rtl:rotate-180" /> Settings
          </Link>
        }
        title="Intake & waiver"
        description="The health questions and consent clients sign on the reception tablet before their first treatment."
        actions={
          <>
            {template && (
              <Badge tone="accent" className="h-8 px-3">
                Version {template.version} · {formatDate(template.updatedAt)}
              </Badge>
            )}
            <RecommendedButton slug={slug} hasTemplate={Boolean(template)} />
          </>
        }
      />
      <PageBody>
        {!template && (
          <div className="rounded-xl border border-dashed bg-surface px-5 py-4 text-sm text-muted sm:px-6">
            No intake form yet. Start from the recommended UAE massage intake, or write your own below.
          </div>
        )}
        <IntakeEditor
          key={template ? `${template.id}` : 'new'}
          slug={slug}
          initial={
            template
              ? { name: template.name, fields: template.fields, waiver: template.waiver }
              : { name: 'Massage intake & consent', fields: [], waiver: { en: '' } }
          }
        />
        <p className="text-[13px] text-muted">
          Saving creates a new version. Earlier signatures keep the exact questions and waiver they signed.
          <Button variant="ghost" size="sm" asChild className="ms-1">
            <Link href={appPath(`/${slug}/clients`)}>Go to clients</Link>
          </Button>
        </p>
      </PageBody>
    </>
  )
}
