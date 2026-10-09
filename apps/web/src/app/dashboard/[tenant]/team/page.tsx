import { type Permission, resolvePermissions } from '@spa/core'
import { enumLabel, roleName } from '@spa/core/i18n'
import { invitations, memberBranches, members, platformDb, roles, user, withTenant } from '@spa/db'
import { dubaiToday, listBranches, trackedDocuments } from '@spa/services'
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm'
import { BellRing, Check, Minus, ShieldCheck, Users } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, Grid, ListRow, Note, Pill, Stack, statusTone, TName } from '@/components/crm'
import { docTypeLabel } from '@/components/documents/labels'
import { Button } from '@/components/ui/button'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { EditMemberSheet, InviteSheet, RevokeButton } from './team-client'

export async function generateMetadata() {
  return { title: (await getT())('team.title') }
}

const SYSTEM_ORDER = ['owner', 'manager', 'receptionist', 'therapist', 'accountant'] as const
/** Design matrix columns (crm-spec §5.7): sees phone · accounts · settings. */
const MATRIX: { key: 'phone' | 'accounts' | 'settings'; permission: Permission }[] = [
  { key: 'phone', permission: 'clients.phone' },
  { key: 'accounts', permission: 'accounting.view' },
  { key: 'settings', permission: 'settings.manage' },
]
/** The expiry card lists documents due within this many days (plus expired ones). */
const EXPIRY_WINDOW = 60

export default async function TeamPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'team.manage')) notFound()
  const { t, fmt } = await getI18n()
  const slug = ctx.tenant.slug
  const showDocs = can(ctx, 'staff.manage')
  const { memberRows, roleRows, inviteRows, docs, branchRows, scopes } = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
      memberRows: await tx
        .select({
          id: members.id,
          userId: members.userId,
          status: members.status,
          roleId: roles.id,
          allBranches: members.allBranches,
          createdAt: members.createdAt,
        })
        .from(members)
        .innerJoin(roles, eq(members.roleId, roles.id))
        .orderBy(asc(members.createdAt)),
      roleRows: await tx
        .select({ id: roles.id, name: roles.name, key: roles.key, permissions: roles.permissions })
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
      docs: showDocs ? await trackedDocuments(tx, dubaiToday()) : [],
      branchRows: await listBranches(tx),
      scopes: await tx.select().from(memberBranches),
    }),
  )
  // Branch assignment (G22) only matters once the spa has more than one open branch.
  const branchOptions = branchRows.map((b) => ({ id: b.id, name: b.name }))
  const multiBranch = branchOptions.length > 1
  const branchName = new Map(branchOptions.map((b) => [b.id, b.name]))
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
  const roleOptions = roleRows.map((r) => ({ id: r.id, key: r.key, name: roleName(t, r) }))
  const roleLabel = new Map(roleOptions.map((r) => [r.id, r.name]))
  const people = memberRows.map((m) => ({
    ...m,
    roleName: roleLabel.get(m.roleId) ?? '',
    name: byId.get(m.userId)?.name ?? t('team.unknown'),
    email: byId.get(m.userId)?.email ?? '',
    branchIds: scopes.filter((x) => x.memberId === m.id && branchName.has(x.branchId)).map((x) => x.branchId),
  }))
  const rank = (key: string) => {
    const i = (SYSTEM_ORDER as readonly string[]).indexOf(key)
    return i < 0 ? SYSTEM_ORDER.length : i
  }
  const matrix = [...roleRows]
    .sort((a, b) => rank(a.key) - rank(b.key))
    .map((r) => ({
      id: r.id,
      name: roleName(t, r),
      granted: resolvePermissions(r),
    }))
  const expiring = docs
    .filter((d) => d.ownerActive && d.days !== null && d.days <= EXPIRY_WINDOW)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
  const systemNames = SYSTEM_ORDER.map((key) => roleName(t, { key, name: key })).join(' · ')

  return (
    <>
      <PageHeader
        title={t('team.title')}
        description={t('team.description')}
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href={appPath(`/${slug}/team/roles`)}>
                <ShieldCheck /> {t('team.rolesButton')}
              </Link>
            </Button>
            <InviteSheet slug={slug} roles={roleOptions} branches={multiBranch ? branchOptions : []} />
          </>
        }
      />
      <PageBody>
        <Note icon={<Users aria-hidden strokeWidth={1.8} />}>
          {t('team.rolesNote', { roles: systemNames })}
        </Note>
        <Grid cols="col-2">
          <Stack>
            <Card title={t('team.members')} sub={t('team.peopleCount', { count: people.length })} flush>
              <DataTable
                rows={people}
                rowKey={(r) => r.id}
                empty={<EmptyState icon={<Users className="size-5" />} title={t('team.noMembers')} />}
                columns={[
                  {
                    key: 'name',
                    header: t('team.col.name'),
                    primary: true,
                    cell: (r) => <TName name={r.name} sub={r.email} />,
                  },
                  { key: 'role', header: t('team.col.role'), cell: (r) => r.roleName },
                  ...(multiBranch
                    ? [
                        {
                          key: 'branches',
                          header: t('team.col.branches'),
                          hideOnMobile: true,
                          cell: (r: (typeof people)[number]) => (
                            <span className="crm-muted">
                              {r.allBranches
                                ? t('team.edit.allBranches')
                                : r.branchIds.map((id) => branchName.get(id)).join(', ')}
                            </span>
                          ),
                        },
                      ]
                    : []),
                  {
                    key: 'status',
                    header: t('team.col.status'),
                    cell: (r) => (
                      <Pill tone={r.status === 'active' ? 'ok' : statusTone(r.status)} dot>
                        {enumLabel(t, 'memberStatus', r.status)}
                      </Pill>
                    ),
                  },
                  {
                    key: 'since',
                    header: t('team.col.joined'),
                    cell: (r) => <span className="crm-muted">{fmt.date(r.createdAt)}</span>,
                    hideOnMobile: true,
                  },
                  {
                    key: 'actions',
                    header: <span className="sr-only">{t('team.col.actions')}</span>,
                    className: 'text-end',
                    cell: (r) => (
                      <EditMemberSheet
                        slug={slug}
                        member={{
                          id: r.id,
                          name: r.name,
                          roleId: r.roleId,
                          status: r.status,
                          allBranches: r.allBranches,
                          branchIds: r.branchIds,
                        }}
                        roles={roleOptions}
                        branches={multiBranch ? branchOptions : []}
                      />
                    ),
                  },
                ]}
              />
            </Card>
            {inviteRows.length > 0 && (
              <Card title={t('team.pending')} sub={t('team.pendingHint')} flush>
                <DataTable
                  rows={inviteRows}
                  rowKey={(r) => r.id}
                  columns={[
                    { key: 'email', header: t('team.col.email'), primary: true, cell: (r) => r.email },
                    { key: 'role', header: t('team.col.role'), cell: (r) => roleLabel.get(r.roleId) },
                    {
                      key: 'expires',
                      header: t('team.col.expires'),
                      cell: (r) => <span className="crm-muted">{fmt.date(r.expiresAt)}</span>,
                    },
                    {
                      key: 'actions',
                      header: <span className="sr-only">{t('team.col.actions')}</span>,
                      className: 'text-end',
                      cell: (r) => <RevokeButton slug={slug} inviteId={r.id} />,
                    },
                  ]}
                />
              </Card>
            )}
          </Stack>

          <Stack>
            <Card
              title={t('team.matrix.title')}
              actions={
                <Link href={appPath(`/${slug}/team/roles`)} className="crm-muted text-sm hover:underline">
                  {t('team.matrix.manage')}
                </Link>
              }
              flush
            >
              <div className="crm-tbl-wrap">
                <table className="crm-tbl">
                  <thead>
                    <tr>
                      <th>{t('team.matrix.role')}</th>
                      {MATRIX.map((c) => (
                        <th key={c.key}>{t(`team.matrix.${c.key}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.map((r) => (
                      <tr key={r.id}>
                        <td className="font-semibold">{r.name}</td>
                        {MATRIX.map((c) =>
                          r.granted.has(c.permission) ? (
                            <td key={c.key}>
                              <Pill tone="ok" title={t('team.matrix.allowed')}>
                                <Check className="size-3" aria-hidden />
                                <span className="sr-only">{t('team.matrix.allowed')}</span>
                              </Pill>
                            </td>
                          ) : (
                            <td key={c.key}>
                              <Pill title={t('team.matrix.notAllowed')}>
                                <Minus className="size-3" aria-hidden />
                                <span className="sr-only">{t('team.matrix.notAllowed')}</span>
                              </Pill>
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {showDocs && (
              <Card
                title={t('team.expiry.title')}
                actions={
                  expiring.length > 0 ? (
                    <Pill tone="warn">{t('team.expiry.soon', { count: expiring.length })}</Pill>
                  ) : undefined
                }
              >
                {expiring.length === 0 ? (
                  <p className="crm-muted text-sm">{t('team.expiry.none')}</p>
                ) : (
                  expiring.slice(0, 6).map((d) => {
                    const days = d.days ?? 0
                    const type = docTypeLabel(t, d.type, d.typeLabel)
                    const date = fmt.date(`${d.expiresOn}T12:00:00Z`)
                    return (
                      <ListRow
                        key={d.id}
                        title={d.scope === 'staff' ? d.owner : t('team.expiry.company')}
                        body={t(days < 0 ? 'team.expiry.expiredLine' : 'team.expiry.line', { type, date })}
                        end={
                          <Pill tone={days < 0 ? 'bad' : days <= 30 ? 'warn' : 'ok'}>
                            {days < 0 ? t('team.expiry.expired') : t('team.expiry.days', { count: days })}
                          </Pill>
                        }
                      />
                    )
                  })
                )}
                <div className="mt-3 text-sm">
                  <Link href={appPath(`/${slug}/documents`)} className="text-accent hover:underline">
                    {t('team.expiry.viewAll')}
                  </Link>
                </div>
                <Note tone="acc" icon={<BellRing aria-hidden strokeWidth={1.8} />} className="mt-3">
                  {t('team.expiry.alerts')}
                </Note>
              </Card>
            )}
          </Stack>
        </Grid>
      </PageBody>
    </>
  )
}
