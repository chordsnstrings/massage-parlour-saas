// Brand fonts (same as the sign-in pages) + Thai; tokens in crm.css.
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/noto-sans-thai'
import '@fontsource-variable/space-grotesk'
import './crm.css'
import './crm-kit.css'
import { isSystemRole, type Permission } from '@spa/core'
import { branches, plans, platformDb, subscriptions, withTenant } from '@spa/db'
import { aiBudgetLevel, aiMonth, aiTenantTotals, billingAlert, logoUrl } from '@spa/services'
import { eq } from 'drizzle-orm'
import type { Metadata, Viewport } from 'next'
import { InstallMenuItem, PwaSetup } from '@/components/pwa/install-app'
import { SearchPalette } from '@/components/search/search-palette'
import { NotificationBell } from '@/components/shell/notification-bell'
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
import { EARLY_PROMPT_SCRIPT } from '@/lib/sw'
import { todayDubai } from '@/lib/utils'
import { can, isWritable, type MemberContext, requireMember } from '@/server/access'
import { navBadgeCounts } from '@/server/nav-counts'
import { bellData } from '@/server/notifications'
import { canonicalUrls } from '@/server/origin'
import { PWA_THEME, pwaFor } from '@/server/pwa'

// Each spa's dashboard installs as its own app (docs/PLAN.md §18.6): manifest, home-screen icon and title.
// Platform console and marketing keep the root manifest.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string }>
}): Promise<Metadata> {
  const ctx = await requireMember((await params).tenant)
  const app = pwaFor(ctx.tenant)
  return {
    manifest: app.manifestUrl,
    icons: { apple: [{ url: app.icon('apple-180'), sizes: '180x180', type: 'image/png' }] },
    appleWebApp: { capable: true, title: app.name, statusBarStyle: 'default' },
    // Next emits only the newer `mobile-web-app-capable`; older iOS still reads the apple- prefixed one.
    other: { 'apple-mobile-web-app-capable': 'yes' },
  }
}

export const viewport: Viewport = { themeColor: PWA_THEME }

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
      const spend = await aiTenantTotals(tx, aiMonth(), ctx.tenant.id)
      // Overdue platform invoices or an open payment reminder → the red bar (R11).
      const alert = await billingAlert(tx, ctx.tenant.id, todayDubai())
      return {
        branch,
        sub,
        aiSpendUsd: spend.costUsd,
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
  const i18n = await getI18n()
  const { locale, t, fmt, messages } = i18n
  const [data, bell, counts] = await Promise.all([shellData(ctx), bellData(ctx, t, fmt), navBadgeCounts(ctx)])
  const base = appPath(`/${ctx.tenant.slug}`)
  const app = pwaFor(ctx.tenant)

  // Menu per the design (crm-spec §2.1, §7) + Sales; pages without a design home are grouped as section tabs.
  // Coming next stays hidden until Phase 3 builds it.
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
  // Count badges (crm-spec §2.1 ③), already permission-filtered by navBadgeCounts.
  const badge = (items: ShellItem[], value: number, key: 'calendar' | 'bookings' | 'inbox') =>
    items.map((i) => ({ ...i, count: { value, label: t(`nav.count.${key}`, { count: value }) } }))

  const nav: ShellGroup[] = [
    ...group(t('nav.group.workspace'), [
      { href: base, label: t('nav.dashboard'), icon: 'dashboard', exact: true },
      ...badge(single('calendar', 'calendar.view', '/calendar', t('nav.calendar')), counts.today, 'calendar'),
      ...badge(
        single('bookings', 'calendar.view', '/bookings', t('nav.bookings')),
        counts.pending,
        'bookings',
      ),
      ...single('sales', 'pos.use', '/sales', t('nav.sales')),
      ...badge(
        item('inbox', t('nav.inbox'), [
          ...page('marketing.send', '/messages', t('nav.whatsapp')),
          ...page('marketing.send', '/inbox', t('nav.instagram')),
          ...page('marketing.campaigns', '/campaigns', t('nav.campaigns')),
        ]),
        counts.outboxDue + counts.igUnread,
        'inbox',
      ),
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
        ...page(
          ['timeclock.kiosk', 'timeclock.leave', 'timeclock.approve'],
          '/timeclock',
          t('timeclock.title'),
        ),
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
        ...page(['site.content', 'services.manage'], '/website', t('nav.site')),
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
      ...single('automations', 'settings.manage', '/automations', t('nav.automations')),
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
  // G18: one AI banner for whoever sees the AI meter — switched off, paused at 100 %, or warned at 80 %.
  const aiLevel = showAi ? aiBudgetLevel(data.aiSpendUsd, budget) : 'ok'
  const aiBanner = !showAi ? null : !ctx.tenant.aiEnabled ? (
    <SpaBanner tone="warning">{t('shell.banner.aiOff')}</SpaBanner>
  ) : aiLevel === 'over' ? (
    <SpaBanner tone="danger">{t('shell.banner.aiPaused')}</SpaBanner>
  ) : aiLevel === 'warn' ? (
    <SpaBanner tone="warning">
      {t('shell.banner.aiWarning', { percent: fmt.percent(aiPercent / 100) })}
    </SpaBanner>
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
  ) : (
    aiBanner
  )

  return (
    <div className="crm" lang={locale}>
      <script
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static inline listener, no user input
        dangerouslySetInnerHTML={{ __html: EARLY_PROMPT_SCRIPT }}
      />
      <I18nProvider locale={locale} messages={messages}>
        <PwaSetup app={app.name} />
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
          bell={<NotificationBell slug={ctx.tenant.slug} initial={bell} pageHref={`${base}/notifications`} />}
          search={<SearchPalette slug={ctx.tenant.slug} phoneSearch={can(ctx, 'clients.phone')} />}
          accountHref={appPath('/account')}
          switchHref={appPath()}
          platformHref={canonicalUrls().marketing()}
          install={<InstallMenuItem />}
        >
          {children}
        </SpaShell>
      </I18nProvider>
    </div>
  )
}
