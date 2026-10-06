import { clients, intakeTemplates, withTenant } from '@spa/db'
import { desc, eq } from 'drizzle-orm'
import { ArrowLeft, ClipboardList } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, PageBody } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { cn } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { IntakeForm } from './intake-form'

export const metadata: Metadata = { title: 'Intake form' }

export default async function IntakePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; id: string }>
  searchParams: Promise<{ lang?: string }>
}) {
  const { tenant, id } = await params
  const ctx = await requireMember(tenant)
  if (!can(ctx, 'clients.manage')) notFound()
  if (!z.uuid().safeParse(id).success) notFound()
  const slug = ctx.tenant.slug
  const { client, template } = await withTenant(ctx.tenant.id, async (tx) => {
    const [client] = await tx
      .select({ id: clients.id, name: clients.name, language: clients.language })
      .from(clients)
      .where(eq(clients.id, id))
    const [template] = await tx
      .select()
      .from(intakeTemplates)
      .where(eq(intakeTemplates.active, true))
      .orderBy(desc(intakeTemplates.version))
      .limit(1)
    return { client, template }
  })
  if (!client) notFound()
  const requested = (await searchParams).lang
  const lang: 'en' | 'ar' =
    requested === 'ar' || requested === 'en' ? requested : client.language === 'ar' ? 'ar' : 'en'
  const profile = appPath(`/${slug}/clients/${client.id}`)

  return (
    <PageBody className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={profile}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted hover:text-fg"
        >
          <ArrowLeft className="size-4" /> {client.name}
        </Link>
        <nav aria-label="Form language" className="inline-flex rounded-lg border bg-surface p-1">
          {(['en', 'ar'] as const).map((l) => (
            <Link
              key={l}
              href={`${profile}/intake?lang=${l}`}
              aria-current={l === lang ? 'true' : undefined}
              className={cn(
                'grid h-10 min-w-16 place-items-center rounded-md px-3 text-sm transition-colors',
                l === lang ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:text-fg',
              )}
            >
              {l === 'en' ? 'English' : 'العربية'}
            </Link>
          ))}
        </nav>
      </div>
      {template ? (
        <IntakeForm
          key={lang}
          slug={slug}
          clientId={client.id}
          clientName={client.name}
          spaName={ctx.tenant.name}
          lang={lang}
          template={{
            name: template.name,
            fields: template.fields,
            waiver: template.waiver,
            version: template.version,
          }}
        />
      ) : (
        <Card>
          <EmptyState
            icon={<ClipboardList className="size-5" />}
            title="No intake form yet"
            description="Create the questions and waiver clients sign before their treatment."
            action={
              can(ctx, 'settings.manage') ? (
                <Button asChild>
                  <Link href={appPath(`/${slug}/settings/intake`)}>Set up intake form</Link>
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}
    </PageBody>
  )
}
