'use client'
import { PERMISSION_GROUPS } from '@spa/core'
import { Plus } from 'lucide-react'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Checkbox, Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { deleteRoleAction, saveRoleAction } from './actions'

type Role = { id: string; name: string; description: string | null; permissions: string[]; isSystem: boolean }

export function RoleSheet({ slug, role }: { slug: string; role?: Role }) {
  const [open, setOpen] = useState(false)
  const readOnly = role?.isSystem
  const granted = new Set(role?.permissions ?? [])
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={role ? role.name : 'New role'}
      description={
        readOnly
          ? 'System roles are fixed. Create a custom role to adjust access.'
          : 'Choose exactly what this role can do.'
      }
      className="md:max-w-2xl"
      trigger={
        role ? (
          <Button variant="ghost" size="sm">
            {readOnly ? 'View' : 'Edit'}
          </Button>
        ) : (
          <Button>
            <Plus /> New role
          </Button>
        )
      }
    >
      <ActionForm
        action={saveRoleAction.bind(null, slug)}
        className="space-y-6"
        onSuccess={() => setOpen(false)}
      >
        {role && <input type="hidden" name="id" value={role.id} />}
        {!readOnly && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" name="name">
              <Input id="name" name="name" defaultValue={role?.name} required />
            </Field>
            <Field label="Description" name="description">
              <Input id="description" name="description" defaultValue={role?.description ?? ''} />
            </Field>
          </div>
        )}
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {Object.entries(PERMISSION_GROUPS).map(([resource, group]) => (
            <fieldset key={resource} className="space-y-2.5">
              <legend className="mb-1 text-xs font-medium uppercase tracking-[0.06em] text-muted">
                {group.label}
              </legend>
              {Object.entries(group.actions).map(([action, label]) => {
                const key = `${resource}.${action}`
                return (
                  <label key={key} className="flex items-center gap-2.5 text-sm">
                    <Checkbox
                      name="permissions"
                      value={key}
                      defaultChecked={granted.has(key)}
                      disabled={readOnly}
                    />
                    {label}
                  </label>
                )
              })}
            </fieldset>
          ))}
        </div>
        {!readOnly && (
          <div className="flex flex-wrap justify-between gap-2 border-t pt-5">
            {role ? <DeleteRole slug={slug} roleId={role.id} onDone={() => setOpen(false)} /> : <span />}
            <SubmitButton>Save role</SubmitButton>
          </div>
        )}
      </ActionForm>
    </Sheet>
  )
}

function DeleteRole({ slug, roleId, onDone }: { slug: string; roleId: string; onDone: () => void }) {
  const [pending, start] = useTransition()
  return (
    <Button
      type="button"
      variant="danger"
      pending={pending}
      onClick={() =>
        start(async () => {
          const r = await deleteRoleAction(slug, roleId)
          if (r?.ok) {
            toast.success('Role deleted')
            onDone()
          } else if (r) toast.error(r.error)
        })
      }
    >
      Delete
    </Button>
  )
}
