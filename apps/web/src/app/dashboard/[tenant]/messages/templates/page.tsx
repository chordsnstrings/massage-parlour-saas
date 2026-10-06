import { dubaiInstant, dubaiParts } from '@spa/core'
import { messageTemplates, services, withTenant } from '@spa/db'
import { DEFAULT_TEMPLATES } from '@spa/services'
import { asc } from 'drizzle-orm'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { TEMPLATE_KINDS } from '@/components/messages/shared'
import { TemplateEditor } from '@/components/messages/template-editor'
import { Button } from '@/components/ui/button'
import { PageBody, PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { publicSiteUrl } from '@/server/sites'

export const metadata: Metadata = { title: 'Message templates' }

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export default async function TemplatesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'marketing.send')) notFound()
  const slug = ctx.tenant.slug
  const { overrides, service } = await withTenant(ctx.tenant.id, async (tx) => ({
    overrides: await tx.select().from(messageTemplates),
    service: (
      await tx.select({ name: services.name }).from(services).orderBy(asc(services.sort)).limit(1)
    )[0],
  }))

  const defaults = Object.fromEntries(TEMPLATE_KINDS.map((k) => [k, DEFAULT_TEMPLATES[k]]))
  const saved = Object.fromEntries(
    TEMPLATE_KINDS.map((k) => {
      const pick = (lang: 'en' | 'ar') =>
        overrides.find((o) => o.kind === k && o.lang === lang)?.body ?? DEFAULT_TEMPLATES[k][lang]
      return [k, { en: pick('en'), ar: pick('ar') }]
    }),
  )

  // Sample values: tomorrow at 18:30 Dubai time, formatted like the real messages.
  const sampleAt = dubaiInstant(addDays(dubaiParts(new Date()).date, 1), 18 * 60 + 30)
  const fmt = (lang: 'en' | 'ar') => ({
    day: sampleAt.toLocaleDateString(lang === 'ar' ? 'ar-AE' : 'en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Dubai',
    }),
    time: sampleAt.toLocaleTimeString(lang === 'ar' ? 'ar-AE' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Dubai',
    }),
  })
  const common = { spa: ctx.tenant.name, ref: 'K7Q2M', link: await publicSiteUrl(ctx.tenant), text: '' }
  const samples = {
    en: {
      ...common,
      ...fmt('en'),
      first_name: 'Fatima',
      name: 'Fatima Al Mansoori',
      service: service?.name.en || 'Swedish massage',
    },
    ar: {
      ...common,
      ...fmt('ar'),
      first_name: 'فاطمة',
      name: 'فاطمة المنصوري',
      service: service?.name.ar || service?.name.en || 'مساج سويدي',
    },
  }

  return (
    <>
      <PageHeader
        eyebrow="WhatsApp"
        title="Message templates"
        description="The words your team sends, in English and Arabic. Clients get the language set on their profile."
        actions={
          <Button variant="secondary" asChild>
            <Link href={appPath(`/${slug}/messages`)}>
              <ArrowLeft className="rtl:rotate-180" /> Outbox
            </Link>
          </Button>
        }
      />
      <PageBody>
        <TemplateEditor
          slug={slug}
          kinds={[...TEMPLATE_KINDS]}
          defaults={defaults}
          saved={saved}
          samples={samples}
        />
        <p className="max-w-2xl text-[13px] text-muted">
          Only message clients who have booked or visited, and always press send yourself — automated or bulk
          WhatsApp tools get numbers banned.
        </p>
      </PageBody>
    </>
  )
}
