import '@fontsource-variable/noto-sans-thai'
import './crm.css'
import './crm-kit.css'
import { dubaiMonthStart } from '@spa/ai'
import { isSystemRole, type Permission } from '@spa/core'
import { aiUsage, branches, plans, platformDb, subscriptions, withTenant } from '@spa/db'
import { billingAlert, logoUrl } from '@spa/services'
import { and, eq, gte, sql } from 'drizzle-orm'
import { SearchPalette } from '@/components/search/search-palette'
import {
  type ShellGroup,
  type ShellItem,
  type ShellLink,
  SpaBanner,
  SpaShell,
} from '@/components/shell/spa-shell'
import { I18nProvider } from '@/i18n/client'
import { getI18n } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { todayDubai } from '@/lib/utils'
import { can, isWritable, type MemberContext, requireMember } from '@/server/access'

/** Default branch, subscription and this month's AI spend for the sidebar (one tenant transaction). */
async function shellData(ctx: MemberContext) {
  const [data, plan] = await Promise.all([
    withTenant(ctx.tenant.id, async (tx) => {
      const [branch] = await tx
        .select({ name: branches.name, address: branches.address })
        .from(branches)
        .where(eq(branches.isDefault, true))
        .limit(1)
      const [sub] = await tx.select().from(subscriptions).limit(1)
      const [spend] = await tx
        .select({ usd: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)` })
        .from(aiUsage)
        .where(and(eq(aiUsage.tenantId, ctx.tenant.id), gte(aiUsage.createdAt, dubaiMonthStart())))
      // Overdue platform invoices or an open payment reminder → the red bar (R11).
      const alert = await billingAlert(tx, ctx.tenant.id, todayDubai())
      return {
        branch,
        sub,
        aiSpendUsd: Number(spend?.usd ?? 0),
        pastDue: alert.overdue.length > 0 || !!alert.reminder,
      }
    }),
    // The plan catalogue is platform data (same lookup as the Billing page).
    can(ctx, 'billing.view') && ctx.tenant.planId
      ? platformDb().query.plans.findFirst({
          where: eq(plans.id, ctx.tenant.planId),
          columns: { name: true },
        })
      : undefined,
  ])
  return { ...data, planName: plan?.name ?? null }
}

/** "Spa · city" line under the name: the branch name when it differs from the spa's, else the address's last part. */
function tagline(spaName: string, branch: { name: string; address: string | null } | undefined) {
  if (!branch) return null
  if (branch.name.trim().toLowerCase() !== spaName.trim().toLowerCase()) return branch.name
  return branch.address?.split(',').at(-1)?.trim() || null
}

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ tenant: string }>
}) {
  const { tenant: slug } = await params
  const ctx = await requireMember(slug)
  const [{ locale, t, fmt, messages }, data] = await Promise.all([getI18n(), shellData(ctx)])
  const base = appPath(`/${ctx.tenant.slug}`)

  // Menu per the design (crm-spec §2.1, §7) + Sales; pages without a design home are grouped as section tabs.
  // Automations and Coming next stay hidden until Phase 3 builds them.
  const allowed = (perm: Permission | Permission[] | null) =>
    perm === null || (Array.isArray(perm) ? perm.some((p) => can(ctx, p)) : can(ctx, perm))
  const page = (
    perm: Permission | Permission[] | null,
    path: string,
    label: string,
    extra?: Partial<ShellLink>,
  ) => (allowed(perm) ? [{ href: `${base}${path}`, label, ...extra }] : [])
  const item = (icon: ShellItem['icon'], label: string, pages: ShellLink[]): ShellItem[] =>
    pages.length === 0
      ? []
      : [{ ...pages[0]!, icon, label, ...(pages.length > 1 || pages[0]!.label !== label ? { pages } : {}) }]
  const single = (icon: ShellItem['icon'], perm: Permission | null, path: string, label: string) =>
    item(icon, label, page(perm, path, label))
  const group = (label: string, items: ShellItem[]): ShellGroup[] => (items.length ? [{ label, items }] : [])

  const nav: ShellGroup[] = [
    ...group(t('nav.group.workspace'), [
      { href: base, label: t('nav.dashboard'), icon: 'dashboard', exact: true },
      ...single('calendar', 'calendar.view', '/calendar', t('nav.calendar')),
      ...single('bookings', 'calendar.view', '/bookings', t('nav.bookings')),
      ...single('sales', 'pos.use', '/sales', t('nav.sales')),
      ...item('inbox', t('nav.inbox'), [
        ...page('marketing.send', '/messages', t('nav.whatsapp')),
        ...page('marketing.send', '/inbox', t('nav.instagram')),
        ...page('marketing.campaigns', '/campaigns', t('nav.campaigns')),
      ]),
    ]),
    ...group(t('nav.group.people'), [
      ...single('clients', 'clients.view', '/clients', t('nav.clients')),
      ...item('services', t('nav.services'), [
        ...page('services.manage', '/services', t('nav.servicesRooms')),
        ...page('services.manage', '/packages', t('nav.packages')),
        ...page(['inventory.manage', 'inventory.adjust'], '/inventory', t('nav.inventory')),
        ...page('inventory.purchase', '/purchases', t('nav.purchases')),
        ...page('inventory.manage', '/warehouse', t('nav.warehouse')),
      ]),
      ...item('team', t('nav.team'), [
        ...page('staff.view', '/staff', t('nav.staff')),
        ...page('team.manage', '/team', t('nav.access')),
        ...page('staff.manage', '/documents', t('nav.documents')),
      ]),
    ]),
    ...group(t('nav.group.growth'), [
      ...item('marketing', t('nav.marketing'), [
        ...page('ai.approve', '/ai/content', t('nav.socialPosts')),
        ...page('reports.view', '/analytics', t('nav.analytics')),
        // AI studio sits here, not under Settings: AI roles (e.g. receptionist) shouldn't get a Settings item.
        ...page(['ai.approve', 'ai.manage'], '/ai', t('nav.aiStudio'), {
          exact: true,
          match: [`${base}/ai/try`],
        }),
      ]),
      ...item('website', t('nav.website'), [
        ...page('site.content', '/website', t('nav.site')),
        ...page('site.content', '/media', t('nav.media')),
      ]),
      ...single('reviews', 'ai.approve', '/ai/reviews', t('nav.reviews')),
    ]),
    ...group(t('nav.group.finance'), [
      ...single('accounts', 'accounting.view', '/accounts', t('nav.accounts')),
      ...single('vat', 'staff.manage', '/payroll', t('nav.vatPayroll')),
      ...single('billing', 'billing.view', '/billing', t('nav.billing')),
    ]),
    ...group(t('nav.group.system'), [
      ...single('settings', 'settings.manage', '/settings', t('nav.settings')),
    ]),
  ]

  // Plan card (crm-spec §2.1 ④): plan + renewal for billing.view; the AI meter for anyone who works with AI.
  const budget = Number(ctx.tenant.aiBudgetUsd)
  const showAi = budget > 0 && (can(ctx, 'billing.view') || can(ctx, 'ai.approve') || can(ctx, 'ai.manage'))
  const aiPercent = showAi ? Math.round((data.aiSpendUsd / budget) * 100) : 0
  const sub = can(ctx, 'billing.view') ? data.sub : undefined
  const renewal = sub
    ? sub.status === 'trialing'
      ? t('shell.plan.trialEnds', { date: fmt.date(sub.currentPeriodEnd) })
      : t('shell.plan.renews', {
          date: fmt.date(sub.currentPeriodEnd),
          price: fmt.aed(sub.priceAed),
          interval: t('shell.plan.interval.year'), // subscription price is annual (R3)
        })
    : null
  const plan =
    showAi || renewal
      ? {
          name: can(ctx, 'billing.view') ? data.planName : null,
          ai: showAi
            ? {
                percent: aiPercent,
                text:
                  aiPercent >= 100
                    ? t('shell.plan.aiPaused')
                    : t('shell.plan.aiAllowance', { percent: fmt.percent(aiPercent / 100) }),
              }
            : null,
          renewal,
        }
      : null

  const roleKey = ctx.member?.roleKey
  const role = !ctx.member
    ? t('shell.superAdmin')
    : roleKey && isSystemRole(roleKey)
      ? t(`role.${roleKey}`)
      : ctx.member.roleName // custom roles stay as typed

  const notice = ctx.impersonating ? (
    <SpaBanner tone="accent">{t('shell.banner.impersonating')}</SpaBanner>
  ) : ctx.tenant.status === 'read_only' ? (
    <SpaBanner tone="warning">{t('shell.banner.paused')}</SpaBanner>
  ) : !isWritable(ctx.tenant) ? (
    <SpaBanner tone="warning">{t('shell.banner.readOnly')}</SpaBanner>
  ) : null
  const alert = data.pastDue ? (
    <SpaBanner tone="danger">
      {t('shell.banner.overdue')}
      {can(ctx, 'billing.view') && (
        <>
          {' '}
          <a href={`${base}/billing`}>{t('shell.banner.payNow')}</a>
        </>
      )}
    </SpaBanner>
  ) : null

  return (
    <div className="crm" lang={locale}>
      <I18nProvider locale={locale} messages={messages}>
        <SpaShell
          spa={{
            name: ctx.tenant.name,
            tagline: tagline(ctx.tenant.name, data.branch),
            logoUrl: logoUrl(ctx.tenant.logoFileId),
            homeHref: base,
          }}
          user={{ name: ctx.user.name, role }}
          nav={nav}
          plan={plan}
          banner={notice}
          alert={alert}
          search={<SearchPalette slug={ctx.tenant.slug} phoneSearch={can(ctx, 'clients.phone')} />}
          accountHref={appPath('/account')}
          switchHref={appPath()}
        >
          {children}
        </SpaShell>
      </I18nProvider>
    </div>
  )
}
