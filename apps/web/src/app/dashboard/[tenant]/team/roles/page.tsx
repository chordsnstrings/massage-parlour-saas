import { resolvePermissions } from '@spa/core'
import { roleDescription, roleName } from '@spa/core/i18n'
import { members, roles, withTenant } from '@spa/db'
import { asc, count, eq } from 'drizzle-orm'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, Pill } from '@/components/crm'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { PageBody, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { RoleSheet } from './role-editor'

export async function generateMetadata() {
  return { title: (await getT())('roles.title') }
}

export default async function RolesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'team.manage')) notFound()
  const { t } = await getI18n()
  const slug = ctx.tenant.slug
  const rows = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .select({
        id: roles.id,
        key: roles.key,
        name: roles.name,
        description: roles.description,
        isSystem: roles.isSystem,
        permissions: roles.permissions,
        people: count(members.id),
      })
      .from(roles)
      .leftJoin(members, eq(members.roleId, roles.id))
      .groupBy(roles.id)
      .orderBy(asc(roles.isSystem), asc(roles.createdAt)),
  )
  const list = rows
    .map((r) => ({
      ...r,
      name: roleName(t, r),
      description: roleDescription(t, r) || null,
      permissions: [...resolvePermissions(r, ctx.tenant.settings.roleOverrides)] as string[],
    }))
    .sort((a, b) => Number(b.isSystem) - Number(a.isSystem))
  return (
    <>
      <Link
        href={appPath(`/${slug}/team`)}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4 rtl:-scale-x-100" strokeWidth={1.5} /> {t('roles.back')}
      </Link>
      <PageHeader
        title={t('roles.title')}
        description={t('roles.description')}
        actions={<RoleSheet slug={slug} />}
      />
      <PageBody>
        <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((r) => (
            <StaggerItem key={r.id}>
              <Card
                as="article"
                title={r.name}
                actions={
                  <Pill tone={r.isSystem ? 'neutral' : 'acc'}>
                    {r.isSystem ? t('roles.system') : t('roles.custom')}
                  </Pill>
                }
                className="flex h-full flex-col"
              >
                <p className="crm-muted flex-1 text-sm">{r.description}</p>
                <div className="mt-4 flex items-center justify-between gap-2 text-sm">
                  <span className="crm-muted">
                    {t('team.peopleCount', { count: r.people })} ·{' '}
                    {t('roles.permissionsCount', { count: r.permissions.length })}
                  </span>
                  <RoleSheet slug={slug} role={r} />
                </div>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      </PageBody>
    </>
  )
}
