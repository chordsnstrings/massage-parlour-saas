import { EXPORT_DATASETS, type ExportDataset, IMPORT_KINDS } from '@spa/services'
import { SectionTabs } from '@/components/crm'
import { IMPORT_PERMISSION } from '@/components/data/kinds'
import { canExportAll } from '@/components/data/server'
import { getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, type MemberContext } from '@/server/access'

export type SettingsTab = 'profile' | 'hours' | 'intake' | 'integrations' | 'domains' | 'data'

/** Settings sub-pages as in-page tabs (crm-spec §7: settings subpages → Settings tabs), filtered by permission. */
export async function SettingsTabs({ ctx, value }: { ctx: MemberContext; value: SettingsTab }) {
  const t = await getT()
  const manage = can(ctx, 'settings.manage')
  const data =
    IMPORT_KINDS.some((k) => can(ctx, IMPORT_PERMISSION[k])) ||
    (Object.keys(EXPORT_DATASETS) as ExportDataset[]).some((d) => can(ctx, EXPORT_DATASETS[d].permission)) ||
    canExportAll(ctx)
  const show: Record<SettingsTab, boolean> = {
    profile: manage,
    hours: manage,
    intake: manage,
    integrations: manage || can(ctx, 'ai.manage'),
    domains: manage,
    data,
  }
  const path: Record<SettingsTab, string> = {
    profile: 'settings',
    hours: 'settings/hours',
    intake: 'settings/intake',
    integrations: 'settings/integrations',
    domains: 'settings/domains',
    data: 'settings/data',
  }
  const items = (Object.keys(path) as SettingsTab[])
    .filter((k) => show[k])
    .map((k) => ({ value: k, label: t(`settings.tabs.${k}`), href: appPath(`/${ctx.tenant.slug}/${path[k]}`) }))
  if (items.length < 2) return null
  return <SectionTabs items={items} value={value} label={t('settings.tabs.label')} />
}
