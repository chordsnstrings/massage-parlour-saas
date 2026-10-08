import { platformDb, sites, tenants } from '@spa/db'
import { listStudioTemplates, type StudioTemplateRow } from '@spa/services'
import { asc, eq } from 'drizzle-orm'
import { Download, Eye, LayoutTemplate, PencilLine, Upload } from 'lucide-react'
import type { Metadata } from 'next'
import { TEMPLATE_KEYS, TEMPLATES } from '@/components/site/templates'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { adminPath } from '@/lib/paths'
import { formatDateTime } from '@/lib/utils'
import { requirePlatformAdmin } from '@/server/access'
import { importTemplateAction, saveSiteAsTemplateAction, updateTemplateAction } from './actions'

export const metadata: Metadata = { title: 'Site templates' }

function LinkButton({
  href,
  label,
  icon,
  download,
}: {
  href: string
  label: string
  icon: React.ReactNode
  download?: boolean
}) {
  return (
    <Button variant="ghost" size="sm" asChild className="h-11 min-w-11">
      <a
        href={href}
        aria-label={label}
        {...(download ? { download: true } : { target: '_blank', rel: 'noreferrer' })}
      >
        {icon}
        <span className="max-lg:sr-only">{label.split(' ')[0]}</span>
      </a>
    </Button>
  )
}

function EditSheet({ row }: { row: StudioTemplateRow }) {
  return (
    <FormSheet
      title={`Edit ${row.name}`}
      description={`Key: ${row.key}. Content changes come from saving a spa's site or importing JSON.`}
      trigger={
        <Button variant="secondary" size="sm" className="h-11 min-w-11" aria-label={`Edit ${row.name}`}>
          <PencilLine /> <span className="max-lg:sr-only">Edit</span>
        </Button>
      }
      action={updateTemplateAction.bind(null, row.id)}
    >
      <Field label="Name" name="name">
        <Input id="name" name="name" defaultValue={row.name} required />
      </Field>
      <Field label="Description" name="description" hint="Shown to spas under the template name.">
        <Textarea id="description" name="description" defaultValue={row.description ?? ''} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Sort order" name="sort">
          <Input id="sort" name="sort" type="number" min={0} defaultValue={row.sort} />
        </Field>
        <label className="flex min-h-11 items-center gap-2.5 self-end text-sm">
          <Checkbox name="active" defaultChecked={row.active} /> Spas can pick it
        </label>
      </div>
    </FormSheet>
  )
}

export default async function TemplatesStudioPage() {
  await requirePlatformAdmin()
  const db = platformDb()
  const rows = await listStudioTemplates(db)
  // Super-admin cross-tenant list: spas that have a website to copy from.
  const spas = await db
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
    .from(sites)
    .innerJoin(tenants, eq(tenants.id, sites.tenantId))
    .orderBy(asc(tenants.name))
    .limit(500)

  return (
    <>
      <PageHeader
        title="Site templates"
        description="Templates spas can pick next to the 8 built-ins. A studio template with a built-in key replaces it."
        actions={
          <>
            <FormSheet
              title="Import a template"
              description="Upload a template exported from this or another environment."
              trigger={
                <Button variant="secondary">
                  <Upload /> Import JSON
                </Button>
              }
              action={importTemplateAction}
              submitLabel="Import"
            >
              <Field label="Template file" name="file">
                <Input
                  id="file"
                  name="file"
                  type="file"
                  accept="application/json,.json"
                  className="h-auto py-2.5"
                />
              </Field>
              <label className="flex items-start gap-3 rounded-xl border p-4 text-sm">
                <Checkbox name="replace" className="mt-0.5" />
                <span className="space-y-1">
                  <span className="block font-medium">Replace a template with the same key</span>
                  <span className="block text-muted">
                    Needed to override a built-in. Spas already using it keep their own pages.
                  </span>
                </span>
              </label>
              <label className="flex min-h-11 items-center gap-2.5 text-sm">
                <Checkbox name="active" /> Spas can pick it right away (otherwise check the preview first)
              </label>
            </FormSheet>
            <FormSheet
              title="Save a spa's site as a template"
              description="Copies the spa's theme and live pages. Its name, photos, links, phone numbers and emails are removed and client reviews become sample quotes; prices, team and hours stay live for each spa. Check the preview for anything else spa-specific before switching it on."
              trigger={
                <Button>
                  <LayoutTemplate /> Save a spa's site
                </Button>
              }
              action={saveSiteAsTemplateAction}
              submitLabel="Save template"
            >
              <Field label="Spa" name="tenantId">
                <Select id="tenantId" name="tenantId" defaultValue="">
                  <option value="" disabled>
                    Choose a spa with a website
                  </option>
                  {spas.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.slug})
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Template name" name="name">
                  <Input id="name" name="name" placeholder="e.g. Marina Calm" required />
                </Field>
                <Field label="Key" name="key" hint="Optional — made from the name.">
                  <Input id="key" name="key" placeholder="marina-calm" />
                </Field>
              </div>
              <Field label="Description" name="description">
                <Textarea id="description" name="description" placeholder="Shown to spas under the name" />
              </Field>
              <label className="flex min-h-11 items-center gap-2.5 text-sm">
                <Checkbox name="active" /> Spas can pick it right away (otherwise check the preview first)
              </label>
            </FormSheet>
          </>
        }
      />
      <PageBody>
        <Card>
          <CardHeader title="Studio templates" description={`${rows.length} saved`} />
          <div className="mt-4 border-t">
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              empty={
                <EmptyState
                  icon={<LayoutTemplate className="size-5" />}
                  title="No studio templates yet"
                  description="Design a site for a demo spa, then save it here as a template."
                />
              }
              columns={[
                {
                  key: 'name',
                  header: 'Template',
                  primary: true,
                  cell: (r) => (
                    <span className="block min-w-0">
                      <span className="block truncate font-medium">{r.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {r.key}
                        {r.description ? ` · ${r.description}` : ''}
                      </span>
                    </span>
                  ),
                },
                {
                  key: 'pages',
                  header: 'Pages',
                  cell: (r) => <span className="tabular">{(r.pages as unknown[]).length}</span>,
                },
                {
                  key: 'status',
                  header: 'Status',
                  cell: (r) => (r.active ? <Badge tone="success">Active</Badge> : <Badge>Hidden</Badge>),
                },
                { key: 'sort', header: 'Order', cell: (r) => <span className="tabular">{r.sort}</span> },
                {
                  key: 'updated',
                  header: 'Updated',
                  cell: (r) => <span className="text-muted tabular">{formatDateTime(r.updatedAt)}</span>,
                },
                {
                  key: 'actions',
                  header: <span className="sr-only">Actions</span>,
                  className: 'text-end',
                  cell: (r) => (
                    <span className="inline-flex flex-wrap justify-end gap-1">
                      <LinkButton
                        href={adminPath(`/templates/${r.id}/preview`)}
                        label={`Preview ${r.name}`}
                        icon={<Eye />}
                      />
                      <LinkButton
                        href={adminPath(`/templates/${r.id}/export`)}
                        label={`Export ${r.name}`}
                        icon={<Download />}
                        download
                      />
                      <EditSheet row={r} />
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Built-in templates"
            description="Shipped with the app. Export one to start a new studio template from it."
          />
          <CardBody>
            <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {TEMPLATE_KEYS.map((key) => {
                const t = TEMPLATES[key]
                const overridden = rows.some((r) => r.key === key && r.active)
                return (
                  <StaggerItem key={key}>
                    <div className="flex h-full flex-col gap-3 rounded-xl border p-4">
                      {/* biome-ignore lint/performance/noImgElement: static public thumbnail */}
                      <img
                        src={`/site-templates/${key}.webp`}
                        alt=""
                        loading="lazy"
                        width={640}
                        height={480}
                        className="aspect-[4/3] w-full rounded-lg border bg-subtle object-cover object-top"
                      />
                      <span
                        aria-hidden
                        className="flex h-10 overflow-hidden rounded-lg border"
                        style={{ background: String(t.theme.bg) }}
                      >
                        {[t.theme.surface, t.theme.subtle, t.theme.accent, t.theme.inverseBg].map((c) => (
                          <span key={String(c)} className="flex-1" style={{ background: String(c) }} />
                        ))}
                      </span>
                      <div className="flex-1 space-y-0.5">
                        <p className="flex items-center justify-between gap-2 text-sm font-medium">
                          {t.name} {overridden && <Badge tone="accent">Replaced</Badge>}
                        </p>
                        <p className="text-[13px] text-muted">{t.feel}</p>
                        <p className="text-xs text-muted">
                          {t.pages.length} pages · {key}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <LinkButton
                          href={adminPath(`/templates/${key}/preview`)}
                          label={`Preview ${t.name}`}
                          icon={<Eye />}
                        />
                        <LinkButton
                          href={adminPath(`/templates/${key}/export`)}
                          label={`Export ${t.name}`}
                          icon={<Download />}
                          download
                        />
                      </div>
                    </div>
                  </StaggerItem>
                )
              })}
            </Stagger>
          </CardBody>
        </Card>
      </PageBody>
    </>
  )
}
