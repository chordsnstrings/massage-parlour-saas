import { resolvePermissions } from '@spa/core'
import { members, roles, withTenant } from '@spa/db'
import { asc, count, eq } from 'drizzle-orm'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { PageBody, PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { RoleSheet } from './role-editor'

export const metadata: Metadata = { title: 'Roles' }

export default async function RolesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'team.manage')) notFound()
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
    .map((r) => ({ ...r, permissions: [...resolvePermissions(r)] as string[] }))
    .sort((a, b) => Number(b.isSystem) - Number(a.isSystem))
  return (
    <>
      <Link
        href={appPath(`/${slug}/team`)}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" strokeWidth={1.5} /> Team
      </Link>
      <PageHeader
        title="Roles"
        description="Six ready-made roles, plus your own custom roles."
        actions={<RoleSheet slug={slug} />}
      />
      <PageBody>
        <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((r) => (
            <StaggerItem key={r.id}>
              <Card className="flex h-full flex-col p-5 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-soft sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold tracking-tight">{r.name}</h3>
                  <Badge tone={r.isSystem ? 'neutral' : 'accent'}>{r.isSystem ? 'System' : 'Custom'}</Badge>
                </div>
                <p className="mt-2 flex-1 text-sm text-muted">{r.description}</p>
                <div className="mt-5 flex items-center justify-between text-sm">
                  <span className="text-muted">
                    {r.people} {r.people === 1 ? 'person' : 'people'} · {r.permissions.length} permissions
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
