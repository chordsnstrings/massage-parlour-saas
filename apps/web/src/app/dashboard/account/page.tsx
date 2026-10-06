import { pushConfig } from '@spa/services'
import type { Metadata } from 'next'
import { NotificationsCard } from '@/components/push/enable-notifications'
import { AppShell } from '@/components/shell/app-shell'
import { PageBody, PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { requireUser } from '@/server/session'
import { PasswordCard, ProfileCard, TwoFactorCard } from './account-client'

export const metadata: Metadata = { title: 'Account' }

export default async function AccountPage() {
  const { user } = await requireUser()
  return (
    <AppShell
      title="Your account"
      homeHref={appPath()}
      user={user}
      nav={[
        { href: appPath(), label: 'My spas', icon: 'home', exact: true },
        { href: appPath('/account'), label: 'Account', icon: 'account' },
      ]}
    >
      <PageHeader title="Account & security" description={user.email} />
      <PageBody className="grid max-w-3xl gap-6 space-y-0 sm:space-y-0">
        <ProfileCard name={user.name} />
        <PasswordCard />
        <TwoFactorCard enabled={Boolean((user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled)} />
        <NotificationsCard publicKey={pushConfig()?.publicKey ?? null} />
      </PageBody>
    </AppShell>
  )
}
