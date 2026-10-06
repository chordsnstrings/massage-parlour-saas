import { AppShell } from '@/components/shell/app-shell'
import { requirePlatformAdmin } from '@/server/access'

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requirePlatformAdmin()
  return (
    <AppShell
      title="Platform console"
      subtitle="spamanagement.ae"
      homeHref="/"
      user={user}
      accountHref={`${process.env.APP_URL ?? ''}/account`}
      nav={[
        { href: '/', label: 'Overview', icon: 'home', exact: true },
        { href: '/tenants', label: 'Spas', icon: 'tenants' },
        { href: '/plans', label: 'Plans & prices', icon: 'plans' },
        { href: '/settings', label: 'Company', icon: 'company' },
        { href: '/ai', label: 'AI models', icon: 'ai' },
        { href: '/audit', label: 'Audit log', icon: 'audit' },
      ]}
    >
      {children}
    </AppShell>
  )
}
