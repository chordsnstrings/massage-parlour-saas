import type { Messages } from '@spa/core/i18n'
import { pushConfig } from '@spa/services'
import type { Metadata } from 'next'
import { NotificationsCard } from '@/components/push/enable-notifications'
import { AppShell } from '@/components/shell/app-shell'
import { PageBody, PageHeader } from '@/components/ui/page'
import { I18nProvider } from '@/i18n/client'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { requireUser } from '@/server/session'
import { PasswordCard, ProfileCard, TwoFactorCard } from './account-client'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('account.meta') }
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { user } = await requireUser()
  // Sent here by the spa's "Require 2FA" policy (server/access.ts requireMember).
  const required = (await searchParams).require2fa
  const requiredSlug = typeof required === 'string' && /^[a-z0-9-]{1,63}$/.test(required) ? required : null
  const { locale, t, messages } = await getI18n()
  // Outside the spa shell: send only the namespaces these cards use.
  const { account, auth, common, errors, ui } = messages
  const subset = { account, auth, common, errors, ui } as unknown as Messages
  return (
    <AppShell
      title={t('account.title')}
      homeHref={appPath()}
      user={user}
      nav={[
        { href: appPath(), label: t('account.nav.spas'), icon: 'home', exact: true },
        { href: appPath('/account'), label: t('account.nav.account'), icon: 'account' },
      ]}
    >
      <I18nProvider locale={locale} messages={subset}>
        <PageHeader title={t('account.heading')} description={user.email} />
        <PageBody className="grid max-w-3xl gap-6 space-y-0 sm:space-y-0">
          {requiredSlug && (
            <div role="alert" className="rounded-lg border border-warning bg-warning-soft p-4 text-sm">
              <p>{t('audit.security.required')}</p>
              <a
                className="mt-2 inline-block font-medium text-accent hover:underline"
                href={appPath(`/${requiredSlug}`)}
              >
                {t('audit.security.backToSpa')}
              </a>
            </div>
          )}
          <ProfileCard name={user.name} />
          <PasswordCard />
          <TwoFactorCard
            enabled={Boolean((user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled)}
          />
          <NotificationsCard publicKey={pushConfig()?.publicKey ?? null} />
        </PageBody>
      </I18nProvider>
    </AppShell>
  )
}
