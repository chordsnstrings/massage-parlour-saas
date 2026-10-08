import { AppShell } from '@/components/shell/app-shell'
import { adminPath } from '@/lib/paths'
import { requirePlatformAdmin } from '@/server/access'
import { appUrl } from '@/server/origin'

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requirePlatformAdmin()
  return (
    <AppShell
      title="Platform console"
      homeHref={adminPath()}
      user={user}
      accountHref={await appUrl('/account')}
      nav={[
        { href: adminPath(), label: 'Overview', icon: 'home', exact: true },
        { href: adminPath('/tenants'), label: 'Spas', icon: 'tenants' },
        { href: adminPath('/websites'), label: 'Websites', icon: 'studio' },
        { href: adminPath('/plans'), label: 'Plans & prices', icon: 'plans' },
        { href: adminPath('/settings'), label: 'Company', icon: 'company' },
        { href: adminPath('/ai'), label: 'AI models', icon: 'ai' },
        { href: adminPath('/domains'), label: 'Domains', icon: 'website' },
        { href: adminPath('/templates'), label: 'Site templates', icon: 'templates' },
        { href: adminPath('/audit'), label: 'Audit log', icon: 'audit' },
      ]}
    >
      {children}
    </AppShell>
  )
}
