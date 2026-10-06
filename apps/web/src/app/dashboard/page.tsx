import { members, platformDb, roles, tenants } from '@spa/db'
import { and, asc, eq } from 'drizzle-orm'
import { ArrowRight, Plus } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Logo } from '@/components/brand'
import { UserMenu } from '@/components/shell/user-menu'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { appPath } from '@/lib/paths'
import { isPlatformAdmin } from '@/server/access'
import { requireUser } from '@/server/session'

export default async function DashboardIndex() {
  const session = await requireUser()
  const spas = await platformDb()
    .select({ slug: tenants.slug, name: tenants.name, role: roles.name })
    .from(members)
    .innerJoin(tenants, eq(members.tenantId, tenants.id))
    .innerJoin(roles, eq(members.roleId, roles.id))
    .where(and(eq(members.userId, session.user.id), eq(members.status, 'active')))
    .orderBy(asc(tenants.name))
  const admin = await isPlatformAdmin(session.user.id)
  if (spas.length === 1 && !admin) redirect(appPath(`/${spas[0]!.slug}`))
  if (spas.length === 0 && !admin) redirect(appPath('/signup'))
  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-5 py-8 sm:px-8 sm:py-14">
      <div className="mb-14 flex items-center justify-between">
        <Logo />
        <UserMenu user={session.user} compact />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a spa</h1>
      <p className="mt-1.5 text-[15px] text-muted">
        You have access to {spas.length} {spas.length === 1 ? 'spa' : 'spas'}.
      </p>
      <Stagger className="mt-8 grid gap-3">
        {spas.map((s) => (
          <StaggerItem key={s.slug}>
            <Link href={appPath(`/${s.slug}`)} className="group block">
              <Card className="flex items-center justify-between px-5 py-4 transition-[transform,box-shadow,border-color] duration-200 group-hover:-translate-y-0.5 group-hover:shadow-soft">
                <span>
                  <span className="block font-medium">{s.name}</span>
                  <span className="text-sm text-muted">{s.role}</span>
                </span>
                <ArrowRight
                  className="size-4 text-muted transition-transform duration-200 group-hover:translate-x-0.5"
                  strokeWidth={1.5}
                />
              </Card>
            </Link>
          </StaggerItem>
        ))}
      </Stagger>
      <Button variant="secondary" className="mt-6" asChild>
        <Link href={appPath('/signup')}>
          <Plus /> Add a spa
        </Link>
      </Button>
    </div>
  )
}
