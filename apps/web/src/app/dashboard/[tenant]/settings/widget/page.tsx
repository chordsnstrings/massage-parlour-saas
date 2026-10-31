import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Card, Grid, Note, Stack } from '@/components/crm'
import { CopyButton } from '@/components/ui/copy-button'
import { PageHeader } from '@/components/ui/page'
import { getT } from '@/i18n/server'
import { can, requireMember } from '@/server/access'
import { publicSiteUrl } from '@/server/sites'
import { SettingsTabs } from '../settings-tabs'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('widget.title') }
}

/** The embeddable booking widget's copy-paste snippet (public/widget.js → /book/embed). */
function widgetSnippet(siteUrl: string, slug: string) {
  const origin = new URL(siteUrl).origin
  return `<script src="${origin}/widget.js" data-spa="${slug}" data-url="${siteUrl}/book/embed" data-lang="en" data-color="#5E7D6B" data-text="Book now" async></script>`
}

export default async function WidgetSettingsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'settings.manage')) notFound()
  const t = await getT()
  const siteUrl = await publicSiteUrl(ctx.tenant)
  const snippet = widgetSnippet(siteUrl, ctx.tenant.slug)
  const embedUrl = `${siteUrl}/book/embed`

  return (
    <>
      <PageHeader title={t('widget.title')} description={t('widget.description')} />
      <SettingsTabs ctx={ctx} value="widget" />
      <Grid cols="col-2">
        <Stack className="min-w-0">
          <Card
            title={t('widget.snippet')}
            sub={t('widget.snippetSub')}
            actions={<CopyButton value={snippet} />}
          >
            <pre
              data-testid="widget-snippet"
              className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-subtle p-3 font-mono text-xs"
              dir="ltr"
            >
              {snippet}
            </pre>
          </Card>
          <Card title={t('widget.options')} sub={t('widget.optionsSub')}>
            <ul className="list-disc space-y-1 ps-5 text-sm" dir="ltr">
              <li>{t('widget.optLang')}</li>
              <li>{t('widget.optColor')}</li>
              <li>{t('widget.optText')}</li>
            </ul>
          </Card>
        </Stack>
        <Stack className="min-w-0">
          <Card title={t('widget.preview')} sub={t('widget.previewSub')}>
            <a
              href={`${embedUrl}?src=widget`}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-accent underline-offset-4 hover:underline"
            >
              {t('widget.open')}
            </a>
          </Card>
          <Note>{t('widget.analytics')}</Note>
        </Stack>
      </Grid>
    </>
  )
}
