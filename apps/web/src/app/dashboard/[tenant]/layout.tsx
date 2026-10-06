import type { Permission } from '@spa/core'
import { AppShell, Banner } from '@/components/shell/app-shell'
import type { NavItem } from '@/components/shell/nav'
import { appPath } from '@/lib/paths'
import { can, isWritable, requireMember } from '@/server/access'

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ tenant: string }>
}) {
  const { tenant: slug } = await params
  const ctx = await requireMember(slug)
  const base = appPath(`/${ctx.tenant.slug}`)
  const item = (perm: Permission | null, path: string, label: string, icon: NavItem['icon']): NavItem[] =>
    perm === null || can(ctx, perm) ? [{ href: `${base}${path}`, label, icon }] : []
  const nav: NavItem[] = [
    { href: base, label: 'Home', icon: 'home', exact: true },
    ...item('calendar.view', '/calendar', 'Calendar', 'calendar'),
    ...item('clients.view', '/clients', 'Clients', 'clients'),
    ...item('pos.use', '/sales', 'Sales', 'sales'),
    ...item('marketing.send', '/messages', 'WhatsApp', 'messages'),
    ...item('services.manage', '/services', 'Services & rooms', 'services'),
    ...item('services.manage', '/packages', 'Packages & gifts', 'packages'),
    ...item('staff.view', '/staff', 'Staff', 'staff'),
    ...item('site.content', '/website', 'Website', 'website'),
    ...item('accounting.view', '/accounts', 'Accounts', 'accounts'),
    ...item('reports.view', '/analytics', 'Analytics', 'analytics'),
    ...item('ai.approve', '/ai', 'AI studio', 'ai'),
    ...item('team.manage', '/team', 'Team', 'team'),
    ...item('settings.manage', '/settings', 'Settings', 'settings'),
    ...item('billing.view', '/billing', 'Subscription', 'billing'),
    { href: appPath('/account'), label: 'Account', icon: 'account' },
  ]
  const banner = ctx.impersonating ? (
    <Banner tone="accent">Viewing as super-admin — every change is recorded in the audit log.</Banner>
  ) : !isWritable(ctx.tenant) ? (
    <Banner tone="warning">This account is read-only. Contact support to restore full access.</Banner>
  ) : null
  return (
    <AppShell
      title={ctx.tenant.name}
      subtitle={ctx.member?.roleName ?? 'Super-admin'}
      homeHref={base}
      nav={nav}
      user={ctx.user}
      banner={banner}
      switchHref={appPath()}
    >
      {children}
    </AppShell>
  )
}
