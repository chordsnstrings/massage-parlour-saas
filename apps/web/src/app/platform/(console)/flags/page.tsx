import { platformDb, tenants } from '@spa/db'
import { type FlagListRow, listFlags } from '@spa/services'
import { asc, isNull } from 'drizzle-orm'
import { Plus, ToggleRight } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { adminPath } from '@/lib/paths'
import { formatDateTime } from '@/lib/utils'
import { deleteFlagAction, saveFlagAction, setFlagOverrideAction } from './actions'

export const metadata: Metadata = { title: 'Feature flags' }

function FlagFields({ flag }: { flag?: FlagListRow }) {
  return (
    <div className="grid gap-4">
      <Field
        label="Key"
        name="key"
        hint={
          flag
            ? 'Fixed once created.'
            : 'Lower-case dotted name, e.g. calendar.newDayView. Code reads it with flag() once the key is in FEATURE_FLAGS.'
        }
      >
        <Input id="key" name="key" defaultValue={flag?.key} readOnly={Boolean(flag)} required />
      </Field>
      <Field label="Description" name="description">
        <Textarea id="description" name="description" defaultValue={flag?.description ?? ''} />
      </Field>
      <label className="flex items-center gap-2.5 text-sm">
        <Checkbox name="defaultOn" defaultChecked={flag?.defaultOn ?? false} /> On for every spa (unless
        overridden)
      </label>
    </div>
  )
}

export default async function FlagsPage() {
  const db = platformDb()
  const [flags, spas] = await Promise.all([
    listFlags(db),
    db
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
      .from(tenants)
      .where(isNull(tenants.deletedAt))
      .orderBy(asc(tenants.name)),
  ])
  return (
    <>
      <PageHeader
        title="Feature flags"
        description="On/off switches for features: one default for every spa, plus per-spa overrides. Changes apply on the next page load and are audited."
        actions={
          <FormSheet
            title="New flag"
            action={saveFlagAction}
            trigger={
              <Button>
                <Plus /> New flag
              </Button>
            }
          >
            <FlagFields />
          </FormSheet>
        }
      />
      <PageBody>
        {flags.length === 0 && <EmptyState icon={<ToggleRight className="size-5" />} title="No flags yet" />}
        {flags.map((f) => (
          <Card key={f.key} data-testid={`flag-${f.key}`}>
            <CardHeader
              title={<code className="font-mono text-[0.95em]">{f.key}</code>}
              description={f.description ?? undefined}
              action={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Badge tone={f.inCode ? 'success' : 'neutral'}>
                    {f.inCode ? 'read by code' : 'not read by code yet'}
                  </Badge>
                  <Badge tone={f.defaultOn ? 'success' : 'warning'}>
                    default {f.defaultOn ? 'on' : 'off'}
                  </Badge>
                </div>
              }
            />
            <CardBody className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <FormSheet
                  title={`Edit ${f.key}`}
                  action={saveFlagAction}
                  trigger={
                    <Button variant="secondary" size="sm">
                      Edit default
                    </Button>
                  }
                >
                  <FlagFields flag={f} />
                </FormSheet>
                {!f.inCode && (
                  <ActionForm action={deleteFlagAction.bind(null, f.key)}>
                    <SubmitButton variant="ghost" size="sm">
                      Delete flag
                    </SubmitButton>
                  </ActionForm>
                )}
                <span className="text-xs text-muted">
                  {f.saved
                    ? `Updated ${f.updatedAt ? formatDateTime(f.updatedAt) : ''}`
                    : 'Not saved yet — the code default applies.'}
                </span>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium">Per-spa overrides</h3>
                {f.overrides.length === 0 ? (
                  <p className="text-sm text-muted">None — every spa uses the default.</p>
                ) : (
                  <ul className="divide-y rounded-[var(--radius)] border">
                    {f.overrides.map((o) => (
                      <li key={o.tenantId} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                        <Link
                          href={adminPath(`/tenants/${o.tenantId}`)}
                          className="font-medium hover:text-accent"
                        >
                          {o.name}
                        </Link>
                        <span className="text-muted">{o.slug}</span>
                        <Badge tone={o.enabled ? 'success' : 'warning'}>{o.enabled ? 'on' : 'off'}</Badge>
                        <ActionForm action={setFlagOverrideAction.bind(null, f.key)} className="ms-auto">
                          <input type="hidden" name="tenantId" value={o.tenantId} />
                          <input type="hidden" name="value" value="default" />
                          <SubmitButton variant="ghost" size="sm">
                            Use default
                          </SubmitButton>
                        </ActionForm>
                      </li>
                    ))}
                  </ul>
                )}
                <ActionForm
                  action={setFlagOverrideAction.bind(null, f.key)}
                  className="mt-3 flex flex-wrap items-end gap-3"
                >
                  <label className="grid min-w-56 flex-1 gap-1.5 text-sm">
                    <span className="font-medium">Spa</span>
                    <Select name="tenantId" defaultValue="" required>
                      <option value="" disabled>
                        Choose a spa…
                      </option>
                      {spas.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.slug})
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="grid gap-1.5 text-sm">
                    <span className="font-medium">Value</span>
                    <Select name="value" defaultValue={f.defaultOn ? 'off' : 'on'}>
                      <option value="on">On</option>
                      <option value="off">Off</option>
                    </Select>
                  </label>
                  <SubmitButton variant="secondary">Set override</SubmitButton>
                </ActionForm>
              </div>
            </CardBody>
          </Card>
        ))}
      </PageBody>
    </>
  )
}
