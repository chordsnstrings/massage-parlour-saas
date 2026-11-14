import { branches, withTenant } from '@spa/db'
import { EXPORT_DATASETS, type ExportDataset, IMPORT_KINDS } from '@spa/services'
import { SectionTabs } from '@/components/crm'
import { IMPORT_PERMISSION } from '@/components/data/kinds'
import { canExportAll } from '@/components/data/server'
import { getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, type MemberContext } from '@/server/access'
import { hasFeature } from '@/server/entitlements'

/**
 * PLAN §18.8: Branches is a Premium page (`multiBranch`). A single-branch spa without it edits its branch under
 * Profile; a downgraded spa that still has other branches keeps the tab (to see, edit or archive them).
 */
export async function showBranches(ctx: MemberContext) {
  if (await hasFeature(ctx.tenant.id, 'multiBranch')) return true
  const rows = await withTenant(ctx.tenant.id, (tx) => tx.select({ id: branches.id }).from(branches).limit(2))
  return rows.length > 1
}

export type SettingsTab =
  | 'profile'
  | 'branches'
  | 'hours'
  | 'intake'
  | 'integrations'
  | 'domains'
  | 'widget'
  | 'data'
  | 'audit'

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
    branches: manage && (await showBranches(ctx)),
    hours: manage,
    intake: manage,
    integrations: manage || can(ctx, 'ai.manage'),
    domains: manage,
    widget: manage,
    data,
    audit: can(ctx, 'audit.view'),
  }
  const path: Record<SettingsTab, string> = {
    profile: 'settings',
    branches: 'settings/branches',
    hours: 'settings/hours',
    intake: 'settings/intake',
    integrations: 'settings/integrations',
    domains: 'settings/domains',
    widget: 'settings/widget',
    data: 'settings/data',
    audit: 'settings/audit',
  }
  const items = (Object.keys(path) as SettingsTab[])
    .filter((k) => show[k])
    .map((k) => ({
      value: k,
      label: k === 'audit' ? t('audit.tab') : k === 'widget' ? t('widget.tab') : t(`settings.tabs.${k}`),
      href: appPath(`/${ctx.tenant.slug}/${path[k]}`),
    }))
  if (items.length < 2) return null
  return <SectionTabs items={items} value={value} label={t('settings.tabs.label')} />
}
