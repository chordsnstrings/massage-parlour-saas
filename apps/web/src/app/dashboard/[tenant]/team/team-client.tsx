'use client'
import { MessageCircle, Plus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Checkbox, Input, Select } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { resultText, useT } from '@/i18n/client'
import { inviteAction, revokeInviteAction, updateMemberAction } from './actions'

/** `name` is already in the viewer's language (roleName on the server). */
type RoleOption = { id: string; key: string; name: string }
type BranchOption = { id: string; name: string }

/** "All branches" or a ticked list (G22). Renders nothing for single-branch spas. */
function BranchScope({
  branches,
  allBranches = true,
  branchIds = [],
}: {
  branches: BranchOption[]
  allBranches?: boolean
  branchIds?: string[]
}) {
  const t = useT()
  const [all, setAll] = useState(allBranches)
  if (branches.length < 2) return null
  return (
    <fieldset className="space-y-2">
      <legend className="text-[13px] font-medium">{t('team.edit.branches')}</legend>
      <input type="hidden" name="branchField" value="1" />
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          name="branchScope"
          value="all"
          checked={all}
          onChange={(e) => setAll(e.currentTarget.checked)}
        />
        {t('team.edit.allBranches')}
      </label>
      {!all && (
        <div className="space-y-2 ps-6">
          {branches.map((b) => (
            <label key={b.id} className="flex items-center gap-2 text-sm">
              <Checkbox name="branchIds" value={b.id} defaultChecked={branchIds.includes(b.id)} />
              {b.name}
            </label>
          ))}
        </div>
      )}
      <p className="text-[13px] text-muted">{t('team.edit.branchesHint')}</p>
    </fieldset>
  )
}

export function InviteSheet({
  slug,
  roles,
  branches,
}: {
  slug: string
  roles: RoleOption[]
  branches: BranchOption[]
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [created, setCreated] = useState<{ link: string; email: string; tenantName: string } | null>(null)
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setCreated(null)
      }}
      title={created ? t('team.invite.shareTitle') : t('team.invite.title')}
      description={
        created ? t('team.invite.shareDescription', { email: created.email }) : t('team.invite.description')
      }
      trigger={
        <Button>
          <Plus /> {t('team.invite.button')}
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
              <CopyButton value={created.link} label={t('team.invite.copy')} />
              <Button variant="secondary" size="sm" asChild>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(t('team.invite.message', { spa: created.tenantName, link: created.link }))}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle /> {t('team.invite.whatsapp')}
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
              <Field label={t('team.invite.email')} name="email">
                <Input id="email" name="email" type="email" required autoFocus />
              </Field>
              <Field label={t('team.invite.role')} name="roleId">
                <Select
                  id="roleId"
                  name="roleId"
                  defaultValue={roles.find((r) => r.key === 'receptionist')?.id}
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <BranchScope branches={branches} />
              <SubmitButton className="w-full">{t('team.invite.create')}</SubmitButton>
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
  branches,
}: {
  slug: string
  member: {
    id: string
    name: string
    roleId: string
    status: 'active' | 'disabled'
    allBranches: boolean
    branchIds: string[]
  }
  roles: RoleOption[]
  branches: BranchOption[]
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={member.name}
      description={t('team.edit.description')}
      trigger={
        <Button variant="ghost" size="sm">
          {t('common.edit')}
        </Button>
      }
    >
      <ActionForm
        action={updateMemberAction.bind(null, slug)}
        className="space-y-5"
        onSuccess={() => setOpen(false)}
      >
        <input type="hidden" name="memberId" value={member.id} />
        <Field label={t('team.invite.role')} name="roleId">
          <Select id="roleId" name="roleId" defaultValue={member.roleId}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('team.edit.access')} name="status">
          <Select id="status" name="status" defaultValue={member.status}>
            <option value="active">{t('team.edit.active')}</option>
            <option value="disabled">{t('team.edit.disabled')}</option>
          </Select>
        </Field>
        <BranchScope branches={branches} allBranches={member.allBranches} branchIds={member.branchIds} />
        <SubmitButton className="w-full">{t('common.save')}</SubmitButton>
      </ActionForm>
    </Sheet>
  )
}

export function RevokeButton({ slug, inviteId }: { slug: string; inviteId: string }) {
  const t = useT()
  const [pending, start] = useTransition()
  return (
    <Button
      variant="ghost"
      size="sm"
      pending={pending}
      onClick={() =>
        start(async () => {
          const r = await revokeInviteAction(slug, inviteId)
          if (r?.ok) toast.success(resultText(t, r) ?? '')
          else if (r) toast.error(resultText(t, r) ?? t('errors.generic'))
        })
      }
    >
      {t('team.revoke')}
    </Button>
  )
}
