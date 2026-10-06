'use client'
import { MessageCircle, Plus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input, Select } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { inviteAction, revokeInviteAction, updateMemberAction } from './actions'

type RoleOption = { id: string; name: string }

export function InviteSheet({ slug, roles }: { slug: string; roles: RoleOption[] }) {
  const [open, setOpen] = useState(false)
  const [created, setCreated] = useState<{ link: string; email: string; tenantName: string } | null>(null)
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setCreated(null)
      }}
      title={created ? 'Share the invitation' : 'Invite a team member'}
      description={
        created
          ? `We emailed ${created.email}. You can also send the link on WhatsApp.`
          : 'They’ll get a link to join.'
      }
      trigger={
        <Button>
          <Plus /> Invite
        </Button>
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        {created ? (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <p className="break-all rounded-lg bg-subtle px-3 py-2.5 font-mono text-[13px]">{created.link}</p>
            <div className="flex flex-wrap gap-2">
              <CopyButton value={created.link} label="Copy link" />
              <Button variant="secondary" size="sm" asChild>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`You're invited to join ${created.tenantName} on spamanagement.ae: ${created.link}`)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle /> Share on WhatsApp
                </a>
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="form" exit={{ opacity: 0, y: -8 }}>
            <ActionForm
              action={inviteAction.bind(null, slug)}
              className="space-y-5"
              onSuccess={(r) => setCreated(r.data as { link: string; email: string; tenantName: string })}
            >
              <Field label="Email" name="email">
                <Input id="email" name="email" type="email" required autoFocus />
              </Field>
              <Field label="Role" name="roleId">
                <Select
                  id="roleId"
                  name="roleId"
                  defaultValue={roles.find((r) => r.name === 'Receptionist')?.id}
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <SubmitButton className="w-full">Create invitation</SubmitButton>
            </ActionForm>
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  )
}

export function EditMemberSheet({
  slug,
  member,
  roles,
}: {
  slug: string
  member: { id: string; name: string; roleId: string; status: 'active' | 'disabled' }
  roles: RoleOption[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={member.name}
      description="Change role or access."
      trigger={
        <Button variant="ghost" size="sm">
          Edit
        </Button>
      }
    >
      <ActionForm
        action={updateMemberAction.bind(null, slug)}
        className="space-y-5"
        onSuccess={() => setOpen(false)}
      >
        <input type="hidden" name="memberId" value={member.id} />
        <Field label="Role" name="roleId">
          <Select id="roleId" name="roleId" defaultValue={member.roleId}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Access" name="status">
          <Select id="status" name="status" defaultValue={member.status}>
            <option value="active">Active</option>
            <option value="disabled">Disabled — can’t sign in to this spa</option>
          </Select>
        </Field>
        <SubmitButton className="w-full">Save</SubmitButton>
      </ActionForm>
    </Sheet>
  )
}

export function RevokeButton({ slug, inviteId }: { slug: string; inviteId: string }) {
  const [pending, start] = useTransition()
  return (
    <Button
      variant="ghost"
      size="sm"
      pending={pending}
      onClick={() =>
        start(async () => {
          const r = await revokeInviteAction(slug, inviteId)
          if (r?.ok) toast.success('Invitation revoked')
          else if (r) toast.error(r.error)
        })
      }
    >
      Revoke
    </Button>
  )
}
