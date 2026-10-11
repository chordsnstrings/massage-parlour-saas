import { intakeTemplates, withTenant } from '@spa/db'
import { desc, eq } from 'drizzle-orm'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Note, Pill, Stack } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { SettingsTabs } from '../settings-tabs'
import { IntakeEditor, RecommendedButton } from './intake-editor'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('settings.intake.title') }
}

export default async function IntakeSettingsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'settings.manage')) notFound()
  const slug = ctx.tenant.slug
  const { t, fmt } = await getI18n()
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
        title={t('settings.intake.title')}
        description={t('settings.intake.description')}
        actions={
          <>
            {template && (
              <Pill tone="acc">
                {t('settings.intake.version', {
                  version: template.version,
                  date: fmt.date(template.updatedAt),
                })}
              </Pill>
            )}
            <RecommendedButton slug={slug} hasTemplate={Boolean(template)} />
          </>
        }
      />
      <SettingsTabs ctx={ctx} value="intake" />
      <Stack>
        {!template && <Note tone="acc">{t('settings.intake.empty')}</Note>}
        <IntakeEditor
          key={template ? `${template.id}` : 'new'}
          slug={slug}
          initial={
            template
              ? { name: template.name, fields: template.fields, waiver: template.waiver }
              : { name: 'Massage intake & consent', fields: [], waiver: { en: '' } }
          }
        />
        <p className="crm-muted text-[13px]">
          {t('settings.intake.footer')}
          <Button variant="ghost" size="sm" asChild className="ms-1">
            <Link href={appPath(`/${slug}/clients`)}>{t('settings.intake.goClients')}</Link>
          </Button>
        </p>
      </Stack>
    </>
  )
}
