import { branches, withTenant } from '@spa/db'
import { eq } from 'drizzle-orm'
import { ChevronRight, Clock } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { PageBody, PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { saveSettingsAction } from './actions'

export const metadata: Metadata = { title: 'Settings' }

export default async function SettingsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'settings.manage')) notFound()
  const [branch] = await withTenant(ctx.tenant.id, (tx) =>
    tx.select().from(branches).where(eq(branches.isDefault, true)).limit(1),
  )
  const t = ctx.tenant
  return (
    <>
      <PageHeader
        title="Settings"
        description="Business details shown on invoices, your website and WhatsApp links."
      />
      <PageBody>
        <ActionForm action={saveSettingsAction.bind(null, t.slug)} className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="Business" description="Legal details appear on tax invoices." />
            <CardBody className="grid gap-5 sm:grid-cols-2">
              <Field label="Spa name" name="name" className="sm:col-span-2">
                <Input id="name" name="name" defaultValue={t.name} required />
              </Field>
              <Field label="Legal name" name="legalName">
                <Input id="legalName" name="legalName" defaultValue={t.legalName ?? ''} />
              </Field>
              <Field label="TRN" name="trn" hint="15-digit VAT number, if registered.">
                <Input id="trn" name="trn" inputMode="numeric" defaultValue={t.trn ?? ''} />
              </Field>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Main branch" description="Where clients find you and how they reach you." />
            <CardBody className="grid gap-5 sm:grid-cols-2">
              <Field label="Branch name" name="branchName">
                <Input id="branchName" name="branchName" defaultValue={branch?.name ?? t.name} required />
              </Field>
              <Field label="Business day ends at" name="cutoff" hint="For late-night hours, e.g. 05:00.">
                <Input
                  id="cutoff"
                  name="cutoff"
                  type="time"
                  defaultValue={(branch?.businessDayCutoff ?? '05:00').slice(0, 5)}
                />
              </Field>
              <Field label="Address" name="address" className="sm:col-span-2">
                <Input
                  id="address"
                  name="address"
                  defaultValue={branch?.address ?? ''}
                  placeholder="Shop 4, Marina Walk, Dubai"
                />
              </Field>
              <Field label="Phone" name="phone">
                <Input id="phone" name="phone" type="tel" defaultValue={branch?.phone ?? ''} />
              </Field>
              <Field label="WhatsApp number" name="whatsapp" hint="Clients message this number.">
                <Input
                  id="whatsapp"
                  name="whatsapp"
                  type="tel"
                  defaultValue={branch?.whatsappE164 ? `+${branch.whatsappE164}` : ''}
                  placeholder="050 123 4567"
                />
              </Field>
            </CardBody>
          </Card>
          <div className="flex justify-end xl:col-span-2">
            <SubmitButton size="lg">Save changes</SubmitButton>
          </div>
        </ActionForm>
        <Link
          href={appPath(`/${t.slug}/settings/hours`)}
          className="group flex items-center gap-4 rounded-xl border bg-surface px-5 py-5 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-fg/20 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:px-6"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
            <Clock className="size-4" strokeWidth={1.5} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold tracking-tight">Opening hours</span>
            <span className="block text-sm text-muted">
              Per weekday and branch, including split shifts and late-night closing.
            </span>
          </span>
          <ChevronRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" />
        </Link>
      </PageBody>
    </>
  )
}
