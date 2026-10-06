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
  const nav: NavItem[] = [
    { href: base, label: 'Home', icon: 'home', exact: true },
    ...(can(ctx, 'team.manage') ? [{ href: `${base}/team`, label: 'Team', icon: 'team' } as const] : []),
    ...(can(ctx, 'settings.manage')
      ? [{ href: `${base}/settings`, label: 'Settings', icon: 'settings' } as const]
      : []),
    ...(can(ctx, 'billing.view')
      ? [{ href: `${base}/billing`, label: 'Subscription', icon: 'billing' } as const]
      : []),
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
