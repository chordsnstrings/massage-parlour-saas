import { AppShell } from '@/components/shell/app-shell'
import { adminPath, appUrl } from '@/lib/paths'
import { requirePlatformAdmin } from '@/server/access'

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requirePlatformAdmin()
  return (
    <AppShell
      title="Platform console"
      subtitle="spamanagement.ae"
      homeHref={adminPath()}
      user={user}
      accountHref={appUrl('/account')}
      nav={[
        { href: adminPath(), label: 'Overview', icon: 'home', exact: true },
        { href: adminPath('/tenants'), label: 'Spas', icon: 'tenants' },
        { href: adminPath('/plans'), label: 'Plans & prices', icon: 'plans' },
        { href: adminPath('/settings'), label: 'Company', icon: 'company' },
        { href: adminPath('/ai'), label: 'AI models', icon: 'ai' },
        { href: adminPath('/audit'), label: 'Audit log', icon: 'audit' },
      ]}
    >
      {children}
    </AppShell>
  )
}
