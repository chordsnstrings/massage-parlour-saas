import { pushConfig } from '@spa/services'
import type { Messages } from '@spa/core/i18n'
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

export default async function AccountPage() {
  const { user } = await requireUser()
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
