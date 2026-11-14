'use client'
import { PERMISSION_GROUPS, RESTRICTED_PERMISSION } from '@spa/core'
import { permissionGroupLabel, permissionLabel } from '@spa/core/i18n/labels'
import { Plus } from 'lucide-react'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Checkbox, Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { resultText, useT } from '@/i18n/client'
import { deleteRoleAction, saveRoleAction } from './actions'

/** `name`/`description` arrive in the viewer's language (roleName/roleDescription on the server). */
type Role = { id: string; name: string; description: string | null; permissions: string[]; isSystem: boolean }

export function RoleSheet({ slug, role }: { slug: string; role?: Role }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const readOnly = role?.isSystem
  const granted = new Set(role?.permissions ?? [])
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={role ? role.name : t('roles.sheet.new')}
      description={readOnly ? t('roles.sheet.fixed') : t('roles.sheet.choose')}
      className="md:max-w-2xl"
      trigger={
        role ? (
          <Button variant="ghost" size="sm">
            {readOnly ? t('roles.sheet.view') : t('common.edit')}
          </Button>
        ) : (
          <Button>
            <Plus /> {t('roles.sheet.new')}
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
            <Field label={t('roles.sheet.name')} name="name">
              <Input id="name" name="name" defaultValue={role?.name} required />
            </Field>
            <Field label={t('roles.sheet.description')} name="description">
              <Input id="description" name="description" defaultValue={role?.description ?? ''} />
            </Field>
          </div>
        )}
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {Object.entries(PERMISSION_GROUPS).map(([resource, group]) => (
            <fieldset key={resource} className="space-y-2.5">
              <legend className="mb-1 text-xs font-medium uppercase tracking-[0.06em] text-muted">
                {permissionGroupLabel(t, resource)}
              </legend>
              {Object.keys(group.actions).map((action) => {
                const key = `${resource}.${action}`
                // Client phones can't be given to a custom role (owner rule); system roles still show it read-only.
                if (key === RESTRICTED_PERMISSION && !readOnly) return null
                return (
                  <label key={key} className="flex items-center gap-2.5 text-sm">
                    <Checkbox
                      name="permissions"
                      value={key}
                      defaultChecked={granted.has(key)}
                      disabled={readOnly}
                    />
                    {permissionLabel(t, key)}
                  </label>
                )
              })}
            </fieldset>
          ))}
        </div>
        {!readOnly && (
          <div className="flex flex-wrap justify-between gap-2 border-t pt-5">
            {role ? <DeleteRole slug={slug} roleId={role.id} onDone={() => setOpen(false)} /> : <span />}
            <SubmitButton>{t('roles.sheet.save')}</SubmitButton>
          </div>
        )}
      </ActionForm>
    </Sheet>
  )
}

function DeleteRole({ slug, roleId, onDone }: { slug: string; roleId: string; onDone: () => void }) {
  const t = useT()
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
            toast.success(resultText(t, r) ?? '')
            onDone()
          } else if (r) toast.error(resultText(t, r) ?? t('errors.generic'))
        })
      }
    >
      {t('common.delete')}
    </Button>
  )
}
