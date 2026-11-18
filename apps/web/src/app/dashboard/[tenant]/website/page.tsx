import { enumLabel } from '@spa/core/i18n'
import { withTenant } from '@spa/db'
import { getSite, listChangeRequests, listPages } from '@spa/services'
import { Globe, MessageSquare } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { Card, Grid, ListRow, Pill, SiteFrame, Stack, type Tone } from '@/components/crm'
import { ScaledFrame } from '@/components/site/scaled-frame'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, isStudio, requireMember } from '@/server/access'
import { publicSiteUrl } from '@/server/sites'
import { studioUrl } from '@/server/studio'
import { RequestChangeForm } from './request-change'
import { ServicesPricesCard } from './services-prices'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('website.title') }
}

const REQUEST_TONE: Record<string, Tone> = { open: 'warn', done: 'ok', declined: 'neutral' }

/**
 * The spa's Website page (R23): a preview of its site, services + prices (live on the site, no publish) and change
 * requests to the studio. The studio itself (templates, pages, publish) lives in the platform console.
 */
export default async function WebsitePage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  // R23: the Website Studio lives in the platform console; super-admins (acting on the spa or members) go there.
  if (await isStudio(ctx)) redirect(await studioUrl(ctx.tenant.slug))
  if (!can(ctx, 'site.content') && !can(ctx, 'services.manage')) notFound()
  const { t, fmt } = await getI18n()
  const slug = ctx.tenant.slug
  const [{ site, pages, requests }, publicUrl] = await Promise.all([
    withTenant(ctx.tenant.id, async (tx) => ({
      site: await getSite(tx, ctx.tenant.id),
      pages: await listPages(tx, ctx.tenant.id),
      requests: await listChangeRequests(tx, ctx.tenant.id, 30),
    })),
    publicSiteUrl(ctx.tenant),
  ])
  const live = pages.some((p) => p.publishedAt)
  const host = publicUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const preview = appPath(`/${slug}/website/preview${live ? '?live=1' : ''}`)

  return (
    <>
      <PageHeader
        title={t('website.title')}
        description={t('website.descSpa')}
        actions={
          live && (
            <>
              <CopyButton value={publicUrl} label={t('website.copyLink')} />
              <Button asChild>
                <a href={publicUrl} target="_blank" rel="noreferrer">
                  <Globe /> {t('website.menu.viewLive')}
                </a>
              </Button>
            </>
          )
        }
      />
      <PageBody>
        <Grid cols="col-2b">
          <Stack>
            <Card
              title={t('website.preview.title')}
              sub={site ? host : undefined}
              actions={
                site && (
                  <Pill tone={live ? 'ok' : 'info'} dot>
                    {live ? t('website.live') : t('website.preview.building')}
                  </Pill>
                )
              }
            >
              {site ? (
                <>
                  <SiteFrame url={host}>
                    <ScaledFrame
                      src={preview}
                      title={t('website.preview.frame')}
                      className="aspect-[16/11]"
                    />
                  </SiteFrame>
                  {!live && <p className="crm-muted mt-3 text-sm">{t('website.preview.draftNote')}</p>}
                </>
              ) : (
                <EmptyState
                  icon={<Globe className="size-5" />}
                  title={t('website.craftingTitle')}
                  description={t('website.craftingBody')}
                />
              )}
            </Card>
            <ServicesPricesCard ctx={ctx} />
          </Stack>
          <Stack>
            <Card title={t('website.request.title')} sub={t('website.request.sub')}>
              <RequestChangeForm slug={slug} pages={pages.map((p) => ({ id: p.id, title: p.title.en }))} />
            </Card>
            <Card title={t('website.requests')}>
              {requests.length === 0 ? (
                <EmptyState
                  icon={<MessageSquare className="size-5" />}
                  title={t('website.noRequests')}
                  description={t('website.noRequestsBody')}
                />
              ) : (
                requests.map((r) => (
                  <ListRow
                    key={r.id}
                    title={r.pageTitle?.en ?? t('website.wholeSite')}
                    body={
                      <>
                        <span className="block whitespace-pre-line break-words">{r.body}</span>
                        {r.response && (
                          <span className="mt-1 block whitespace-pre-line break-words">
                            {t('website.studioReply', { text: r.response })}
                          </span>
                        )}
                      </>
                    }
                    time={fmt.date(r.createdAt)}
                    end={
                      <Pill tone={REQUEST_TONE[r.status]} dot>
                        {enumLabel(t, 'changeRequestStatus', r.status)}
                      </Pill>
                    }
                  />
                ))
              )}
            </Card>
          </Stack>
        </Grid>
      </PageBody>
    </>
  )
}
