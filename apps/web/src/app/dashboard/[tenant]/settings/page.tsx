import { branches, withTenant } from '@spa/db'
import { IMPORT_KINDS, listAuditLog, logoUrl } from '@spa/services'
import { eq } from 'drizzle-orm'
import { Download, History, MessageCircle, ShieldCheck, Upload } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Card, Grid, ListRow, Pill, Stack, Toggle } from '@/components/crm'
import { IMPORT_PERMISSION } from '@/components/data/kinds'
import { canExportAll } from '@/components/data/server'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { saveSecurityAction, saveSettingsAction } from './actions'
import { actorLabel } from './audit/labels'
import { LogoForm } from './logo-form'
import { SettingsTabs } from './settings-tabs'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('settings.profile.title') }
}

export default async function SettingsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'settings.manage')) notFound()
  const { t, fmt } = await getI18n()
  const canAudit = can(ctx, 'audit.view')
  const [[branch], recent] = await withTenant(ctx.tenant.id, async (tx) => [
    await tx.select().from(branches).where(eq(branches.isDefault, true)).limit(1),
    canAudit ? (await listAuditLog(tx, { pageSize: 5 })).entries : [],
  ])
  const tenant = ctx.tenant
  const base = `/${tenant.slug}`
  const canImport = IMPORT_KINDS.some((k) => can(ctx, IMPORT_PERMISSION[k]))
  const canExport = canExportAll(ctx)
  const twoFactor = ctx.user.twoFactorEnabled
  return (
    <>
      <PageHeader title={t('settings.profile.title')} description={t('settings.profile.description')} />
      <SettingsTabs ctx={ctx} value="profile" />
      <Grid cols="col-2">
        <Stack>
          <ActionForm action={saveSettingsAction.bind(null, tenant.slug)} className="crm-stack">
            <Card title={t('settings.profile.card')} sub={t('settings.profile.cardSub')}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('settings.profile.name')} name="name" className="sm:col-span-2">
                  <Input id="name" name="name" defaultValue={tenant.name} required />
                </Field>
                <Field label={t('settings.profile.legalName')} name="legalName">
                  <Input id="legalName" name="legalName" defaultValue={tenant.legalName ?? ''} />
                </Field>
                <Field label={t('settings.profile.trn')} name="trn" hint={t('settings.profile.trnHint')}>
                  <Input id="trn" name="trn" inputMode="numeric" defaultValue={tenant.trn ?? ''} />
                </Field>
                <Field label={t('settings.profile.currency')} name="currency" className="sm:col-span-2">
                  <Input id="currency" value={t('settings.profile.currencyValue')} readOnly disabled />
                </Field>
              </div>
            </Card>
            <Card title={t('settings.profile.branch')} sub={t('settings.profile.branchSub')}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('settings.profile.branchName')} name="branchName">
                  <Input
                    id="branchName"
                    name="branchName"
                    defaultValue={branch?.name ?? tenant.name}
                    required
                  />
                </Field>
                <Field
                  label={t('settings.profile.cutoff')}
                  name="cutoff"
                  hint={t('settings.profile.cutoffHint')}
                >
                  <Input
                    id="cutoff"
                    name="cutoff"
                    type="time"
                    defaultValue={(branch?.businessDayCutoff ?? '05:00').slice(0, 5)}
                  />
                </Field>
                <Field label={t('settings.profile.address')} name="address" className="sm:col-span-2">
                  <Input
                    id="address"
                    name="address"
                    defaultValue={branch?.address ?? ''}
                    placeholder={t('settings.profile.addressPlaceholder')}
                  />
                </Field>
                <Field label={t('settings.profile.phone')} name="phone">
                  <Input id="phone" name="phone" type="tel" defaultValue={branch?.phone ?? ''} />
                </Field>
                <Field
                  label={t('settings.profile.whatsapp')}
                  name="whatsapp"
                  hint={t('settings.profile.whatsappHint')}
                >
                  <Input
                    id="whatsapp"
                    name="whatsapp"
                    type="tel"
                    defaultValue={branch?.whatsappE164 ? `+${branch.whatsappE164}` : ''}
                    placeholder={t('settings.profile.whatsappPlaceholder')}
                  />
                </Field>
              </div>
              <div className="mt-4 flex items-center justify-between gap-4 border-t pt-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t('settings.profile.showPrices')}</p>
                  <p className="crm-muted text-[13px]">{t('settings.profile.showPricesHint')}</p>
                </div>
                <Toggle
                  name="showPrices"
                  label={t('settings.profile.showPrices')}
                  defaultChecked={!tenant.settings.hidePrices}
                />
              </div>
              <div className="mt-4 flex justify-end">
                <SubmitButton>{t('settings.profile.save')}</SubmitButton>
              </div>
            </Card>
          </ActionForm>
          {(canImport || canExport) && (
            <Card title={t('settings.profile.data.title')}>
              <div className="grid gap-2 sm:grid-cols-2">
                {canImport && (
                  <Button asChild variant="secondary">
                    <a href={appPath(`${base}/settings/data`)}>
                      <Upload aria-hidden /> {t('settings.profile.data.import')}
                    </a>
                  </Button>
                )}
                {canExport && (
                  <Button asChild variant="secondary">
                    <a href={appPath(`${base}/settings/data/export?type=full`)}>
                      <Download aria-hidden /> {t('settings.profile.data.export')}
                    </a>
                  </Button>
                )}
              </div>
              <p className="crm-muted mt-2.5 text-xs">{t('settings.profile.data.note')}</p>
            </Card>
          )}
        </Stack>
        <Stack>
          <LogoForm slug={tenant.slug} current={logoUrl(tenant.logoFileId)} />
          <Card title={t('settings.profile.security.title')}>
            <ListRow
              icon={<ShieldCheck aria-hidden />}
              title={t('settings.profile.security.twoFactor')}
              body={
                twoFactor
                  ? t('settings.profile.security.twoFactorOn')
                  : t('settings.profile.security.twoFactorOff')
              }
              end={
                <Pill tone={twoFactor ? 'ok' : 'neutral'}>
                  {twoFactor ? t('settings.profile.security.on') : t('settings.profile.security.off')}
                </Pill>
              }
              href={appPath('/account')}
            />
            <ActionForm action={saveSecurityAction.bind(null, tenant.slug)} className="mt-3 border-t pt-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t('audit.security.require2fa')}</p>
                  <p className="crm-muted text-[13px]">{t('audit.security.require2faSub')}</p>
                </div>
                <Toggle
                  name="require2fa"
                  label={t('audit.security.require2fa')}
                  defaultChecked={Boolean(tenant.settings.require2fa)}
                />
              </div>
              <div className="mt-3 flex justify-end">
                <SubmitButton>{t('audit.security.save')}</SubmitButton>
              </div>
            </ActionForm>
            {canAudit && (
              <div className="mt-3 border-t pt-3">
                <p className="crm-muted mb-1 text-[12px] font-semibold uppercase tracking-wide">
                  {t('audit.recent')}
                </p>
                {recent.length === 0 ? (
                  <p className="crm-muted text-[13px]">{t('audit.none')}</p>
                ) : (
                  recent.map((e) => (
                    <ListRow
                      key={e.id}
                      icon={<History aria-hidden />}
                      title={e.action}
                      body={actorLabel(t, e)}
                      time={fmt.dateTime(e.at)}
                    />
                  ))
                )}
                <Button asChild variant="secondary" className="mt-2 w-full">
                  <a href={appPath(`${base}/settings/audit`)}>{t('audit.viewAll')}</a>
                </Button>
              </div>
            )}
          </Card>
          <Card title={t('settings.profile.messages.title')}>
            <ListRow
              icon={<MessageCircle aria-hidden />}
              title={t('settings.profile.messages.templates')}
              body={t('settings.profile.messages.templatesSub')}
              href={appPath(`${base}/messages/templates`)}
            />
          </Card>
        </Stack>
      </Grid>
    </>
  )
}
