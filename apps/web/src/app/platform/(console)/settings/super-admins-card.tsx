import { platformDb } from '@spa/db'
import { superAdminRoster } from '@spa/services'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ActionForm, SubmitButton } from '@/components/ui/form'
import { DataTable } from '@/components/ui/table'
import { adminUrl } from '@/server/origin'
import { markAdminVerifiedAction } from '../actions'

/**
 * Super-admins (owner, 2026-10-09): who has console access (verified, 2FA) and which PLATFORM_ADMIN_EMAILS addresses
 * are not super-admins yet. Bootstrap without working email: "Mark email verified" on a listed login. No removal.
 */
export async function SuperAdminsCard({ meId }: { meId: string }) {
  const { admins, pending } = await superAdminRoster(platformDb())
  const join = await adminUrl('/join')
  return (
    <Card data-testid="super-admins">
      <CardHeader
        title="Super-admins"
        description={`PLATFORM_ADMIN_EMAILS addresses create their login at ${join.replace(/^https?:\/\//, '')} and become super-admins once their email is verified; each sets up two-step verification before the console opens. Without working email, confirm a listed login here.`}
      />
      <DataTable
        rows={admins}
        rowKey={(a) => a.userId}
        columns={[
          {
            key: 'email',
            header: 'Email',
            primary: true,
            cell: (a) => (
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.email}</span>
                {a.userId === meId && <Badge tone="accent">You</Badge>}
                {!a.listed && <Badge>Not in PLATFORM_ADMIN_EMAILS</Badge>}
              </span>
            ),
          },
          { key: 'name', header: 'Name', cell: (a) => a.name },
          {
            key: 'verified',
            header: 'Verified',
            cell: (a) =>
              a.verified ? (
                <Badge tone="success">Verified</Badge>
              ) : (
                <Badge tone="warning">Not verified</Badge>
              ),
          },
          {
            key: '2fa',
            header: 'Two-step',
            cell: (a) =>
              a.twoFactor ? <Badge tone="success">2FA on</Badge> : <Badge tone="warning">2FA off</Badge>,
          },
        ]}
      />
      {pending.length > 0 && (
        <CardBody className="space-y-3 border-t">
          <p className="text-sm font-medium">Listed, not a super-admin yet</p>
          <ul className="divide-y rounded-lg border">
            {pending.map((p) => (
              <li
                key={p.email}
                data-testid="listed-admin"
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.email}</span>
                  {!p.userId ? (
                    <Badge>No login yet</Badge>
                  ) : p.disabled ? (
                    <Badge tone="danger">Login closed</Badge>
                  ) : p.verified ? (
                    <Badge tone="accent">Verified · promoted on first console visit</Badge>
                  ) : (
                    <Badge tone="warning">Email not verified</Badge>
                  )}
                </span>
                {p.userId && !p.disabled && (
                  <ActionForm action={markAdminVerifiedAction.bind(null, p.userId)}>
                    <SubmitButton size="sm" variant="secondary">
                      {p.verified ? 'Make super-admin now' : 'Mark email verified'}
                    </SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </CardBody>
      )}
    </Card>
  )
}
