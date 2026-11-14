import { SectionTabs } from '@/components/crm'
import { getT } from '@/i18n/server'

const TABS = [
  { key: 'overview', path: '' },
  { key: 'expenses', path: '/expenses' },
  { key: 'journal', path: '/journal' },
] as const

/** Section tabs shared by the accounting pages; the month carries over. */
export async function AccountsTabs({
  base,
  month,
  active,
}: {
  base: string
  month: string
  active: (typeof TABS)[number]['key']
}) {
  const t = await getT()
  return (
    <SectionTabs
      label={t('accounts.tabs.label')}
      value={active}
      items={TABS.map((tab) => ({
        value: tab.key,
        label: t(`accounts.tabs.${tab.key}`),
        href: `${base}${tab.path}?month=${month}`,
      }))}
    />
  )
}
