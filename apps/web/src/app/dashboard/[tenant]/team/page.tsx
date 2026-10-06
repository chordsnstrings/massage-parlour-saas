import { invitations, members, platformDb, roles, user, withTenant } from '@spa/db'
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm'
import { ShieldCheck, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge, statusTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { appPath } from '@/lib/paths'
import { formatDate, initials } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { EditMemberSheet, InviteSheet, RevokeButton } from './team-client'

export const metadata: Metadata = { title: 'Team' }

export default async function TeamPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'team.manage')) notFound()
  const slug = ctx.tenant.slug
  const { memberRows, roleRows, inviteRows } = await withTenant(ctx.tenant.id, async (tx) => ({
    memberRows: await tx
      .select({
        id: members.id,
        userId: members.userId,
        status: members.status,
        roleId: roles.id,
        roleName: roles.name,
        createdAt: members.createdAt,
      })
      .from(members)
      .innerJoin(roles, eq(members.roleId, roles.id))
      .orderBy(asc(members.createdAt)),
    roleRows: await tx
      .select({ id: roles.id, name: roles.name, key: roles.key })
      .from(roles)
      .orderBy(asc(roles.createdAt)),
    inviteRows: await tx
      .select({
        id: invitations.id,
        email: invitations.email,
        roleId: invitations.roleId,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .where(
        and(
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      ),
  }))
  // Profiles live in the platform-scoped auth table.
  const profiles = memberRows.length
    ? await platformDb()
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(
          inArray(
            user.id,
            memberRows.map((m) => m.userId),
          ),
        )
    : []
  const byId = new Map(profiles.map((p) => [p.id, p]))
  const roleName = new Map(roleRows.map((r) => [r.id, r.name]))
  const people = memberRows.map((m) => ({
    ...m,
    name: byId.get(m.userId)?.name ?? 'Unknown',
    email: byId.get(m.userId)?.email ?? '',
  }))

  return (
    <>
      <PageHeader
        title="Team"
        description="Who can sign in, and what each person can see and do."
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href={appPath(`/${slug}/team/roles`)}>
                <ShieldCheck /> Roles
              </Link>
            </Button>
            <InviteSheet slug={slug} roles={roleRows} />
          </>
        }
      />
      <PageBody>
        <Card>
          <CardHeader
            title="Members"
            description={`${people.length} ${people.length === 1 ? 'person' : 'people'}`}
          />
          <div className="mt-4 border-t">
            <DataTable
              rows={people}
              rowKey={(r) => r.id}
              empty={<EmptyState icon={<Users className="size-5" />} title="No members yet" />}
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  primary: true,
                  cell: (r) => (
                    <span className="flex items-center gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                        {initials(r.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{r.name}</span>
                        <span className="block truncate text-xs text-muted">{r.email}</span>
                      </span>
                    </span>
                  ),
                },
                { key: 'role', header: 'Role', cell: (r) => r.roleName },
                {
                  key: 'status',
                  header: 'Status',
                  cell: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
                },
                {
                  key: 'since',
                  header: 'Joined',
                  cell: (r) => <span className="text-muted">{formatDate(r.createdAt)}</span>,
                  hideOnMobile: true,
                },
                {
                  key: 'actions',
                  header: <span className="sr-only">Actions</span>,
                  className: 'text-end',
                  cell: (r) => (
                    <EditMemberSheet
                      slug={slug}
                      member={{ id: r.id, name: r.name, roleId: r.roleId, status: r.status }}
                      roles={roleRows}
                    />
                  ),
                },
              ]}
            />
          </div>
        </Card>
        {inviteRows.length > 0 && (
          <Card>
            <CardHeader title="Pending invitations" description="Links expire after 7 days." />
            <div className="mt-4 border-t">
              <DataTable
                rows={inviteRows}
                rowKey={(r) => r.id}
                columns={[
                  { key: 'email', header: 'Email', primary: true, cell: (r) => r.email },
                  { key: 'role', header: 'Role', cell: (r) => roleName.get(r.roleId) },
                  {
                    key: 'expires',
                    header: 'Expires',
                    cell: (r) => <span className="text-muted">{formatDate(r.expiresAt)}</span>,
                  },
                  {
                    key: 'actions',
                    header: <span className="sr-only">Actions</span>,
                    className: 'text-end',
                    cell: (r) => <RevokeButton slug={slug} inviteId={r.id} />,
                  },
                ]}
              />
            </div>
          </Card>
        )}
      </PageBody>
    </>
  )
}
