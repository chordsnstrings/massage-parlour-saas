import { platformDb } from '@spa/db'
import { newEnquiryCount, pendingApplicationCount } from '@spa/services'
import { AppShell } from '@/components/shell/app-shell'
import { adminPath } from '@/lib/paths'
import { requirePlatformAdmin } from '@/server/access'
import { appUrl } from '@/server/origin'

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requirePlatformAdmin()
  const db = platformDb()
  const [pending, enquiries] = await Promise.all([pendingApplicationCount(db), newEnquiryCount(db)])
  return (
    <AppShell
      title="Platform console"
      homeHref={adminPath()}
      user={user}
      accountHref={await appUrl('/account')}
      nav={[
        { href: adminPath(), label: 'Overview', icon: 'home', exact: true },
        { href: adminPath('/applications'), label: 'Applications', icon: 'applications', badge: pending },
        { href: adminPath('/enquiries'), label: 'Enquiries', icon: 'enquiries', badge: enquiries },
        { href: adminPath('/tenants'), label: 'Spas', icon: 'tenants' },
        { href: adminPath('/performance'), label: 'Performance', icon: 'analytics' },
        { href: adminPath('/websites'), label: 'Websites', icon: 'studio' },
        { href: adminPath('/plans'), label: 'Plans & prices', icon: 'plans' },
        { href: adminPath('/announcements'), label: 'Announcements', icon: 'announcements' },
        { href: adminPath('/flags'), label: 'Feature flags', icon: 'flags' },
        { href: adminPath('/settings'), label: 'Company', icon: 'company' },
        { href: adminPath('/ai'), label: 'AI models', icon: 'ai', exact: true },
        { href: adminPath('/ai/usage'), label: 'AI usage', icon: 'analytics' },
        { href: adminPath('/domains'), label: 'Domains', icon: 'website' },
        { href: adminPath('/templates'), label: 'Site templates', icon: 'templates' },
        { href: adminPath('/audit'), label: 'Audit log', icon: 'audit' },
      ]}
    >
      {children}
    </AppShell>
  )
}
