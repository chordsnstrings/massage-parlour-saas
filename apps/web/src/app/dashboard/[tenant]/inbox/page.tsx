import { withTenant } from '@spa/db'
import {
  getThread,
  type InboxFilter,
  inboxCounts,
  instagramStatus,
  listInbox,
  metaConfig,
} from '@spa/services'
import { Bot, MessagesSquare, Settings2 } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { ConversationList, FILTERS, InboxFilters } from '@/components/inbox/conversation-list'
import { InstagramGlyph } from '@/components/inbox/icons'
import { ThreadView } from '@/components/inbox/thread'
import { InboxAutoRefresh } from '@/components/inbox/thread-client'
import { Card, Grid, Pill, Stat } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { cn } from '@/lib/utils'
import { can, requireMember } from '@/server/access'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('inbox.title') }
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** Instagram DMs + comments: conversation list and thread (list → thread navigation on phones). */
export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'marketing.send')) notFound()
  const slug = ctx.tenant.slug
  const sp = await searchParams
  const { t, fmt } = await getI18n()
  const f = one(sp.f)
  const filter: InboxFilter = FILTERS.includes(f as InboxFilter) ? (f as InboxFilter) : 'open'
  const selected = z.uuid().safeParse(one(sp.c)).data

  const { rows, counts, thread, account } = await withTenant(ctx.tenant.id, async (tx) => ({
    rows: await listInbox(tx, filter),
    counts: await inboxCounts(tx),
    thread: selected ? await getThread(tx, selected) : null,
    account: await instagramStatus(tx),
  }))
  const configured = metaConfig() !== null
  const connected = account?.status === 'connected'
  const canSettings = can(ctx, 'ai.manage') || can(ctx, 'settings.manage')
  const settingsHref = appPath(`/${slug}/settings/integrations`)
  const sendNotice = !configured
    ? t('inbox.notice.sandbox')
    : !account
      ? t('inbox.notice.notConnected')
      : !connected
        ? t('inbox.notice.expired')
        : null

  const status = !configured ? (
    <Pill>{t('inbox.status.notConfigured')}</Pill>
  ) : connected ? (
    <Pill tone="ok">
      <InstagramGlyph className="size-3" />
      {account?.username ? `@${account.username}` : t('inbox.status.connected')}
    </Pill>
  ) : account ? (
    <Pill tone="warn">{t('inbox.status.reconnect')}</Pill>
  ) : (
    <Pill>{t('inbox.status.notConnected')}</Pill>
  )

  return (
    <>
      <InboxAutoRefresh />
      <PageHeader
        title={t('inbox.title')}
        description={t('inbox.description')}
        actions={
          <>
            {status}
            {can(ctx, 'ai.manage') && (
              <Button
                asChild
                variant="ghost"
                className="min-h-11 min-w-11 px-0 sm:min-h-10 sm:px-4"
                title={t('inbox.receptionistTitle')}
              >
                <Link href={appPath(`/${slug}/ai`)}>
                  <Bot /> <span className="sr-only sm:not-sr-only">{t('inbox.receptionist')}</span>
                </Link>
              </Button>
            )}
            {canSettings && (
              <Button
                asChild
                variant="ghost"
                className="min-h-11 min-w-11 px-0 sm:min-h-10 sm:px-4"
                title={t('inbox.instagramTitle')}
              >
                <Link href={settingsHref}>
                  <Settings2 /> <span className="sr-only sm:not-sr-only">{t('inbox.instagram')}</span>
                </Link>
              </Button>
            )}
          </>
        }
      />
      <PageBody>
        {counts.total === 0 && !thread ? (
          <Card>
            <EmptyState
              icon={<MessagesSquare className="size-5" strokeWidth={1.5} />}
              title={connected ? t('inbox.empty.noMessagesTitle') : t('inbox.empty.connectTitle')}
              description={
                connected
                  ? t('inbox.empty.noMessagesBody')
                  : !configured
                    ? t('inbox.empty.notConfiguredBody')
                    : t('inbox.empty.connectBody')
              }
              action={
                !connected && canSettings ? (
                  <Button asChild className="min-h-11">
                    <Link href={settingsHref}>
                      <InstagramGlyph /> {t('inbox.empty.settings')}
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <>
          <Grid cols="g3" className={cn(thread && 'hidden lg:grid')}>
            <Stat label={t('inbox.stats.open')} value={fmt.number(counts.open)} />
            <Stat label={t('inbox.stats.unread')} value={fmt.number(counts.unread)} />
            <Stat label={t('inbox.stats.flagged')} value={fmt.number(counts.flagged)} />
          </Grid>
          <div className="grid gap-[var(--crm-gap)] lg:grid-cols-12">
            <Card
              flush
              className={cn(
                'overflow-hidden lg:col-span-5 lg:self-start xl:col-span-4',
                thread && 'hidden lg:block',
              )}
            >
              <div className="border-b border-[var(--crm-line)] p-3">
                <InboxFilters slug={slug} active={filter} counts={counts} t={t} fmt={fmt} />
              </div>
              <div className="lg:max-h-[calc(100dvh-16rem)] lg:overflow-y-auto">
                <ConversationList
                  slug={slug}
                  rows={rows}
                  filter={filter}
                  selectedId={thread?.conversation.id}
                  t={t}
                  fmt={fmt}
                />
              </div>
            </Card>
            <div className={cn('min-w-0 lg:col-span-7 xl:col-span-8', !thread && 'hidden lg:block')}>
              {thread ? (
                <ThreadView
                  key={thread.conversation.id}
                  slug={slug}
                  thread={thread}
                  filter={filter}
                  sendNotice={sendNotice}
                  canLinkClient={can(ctx, 'clients.manage')}
                  canViewClients={can(ctx, 'clients.view')}
                  t={t}
                  fmt={fmt}
                />
              ) : (
                <Card className="lg:min-h-96">
                  <EmptyState
                    icon={<MessagesSquare className="size-5" strokeWidth={1.5} />}
                    title={selected ? t('inbox.empty.notFound') : t('inbox.empty.pick')}
                    description={
                      counts.unread
                        ? t('inbox.empty.unread', { count: counts.unread })
                        : t('inbox.empty.caughtUp')
                    }
                  />
                </Card>
              )}
            </div>
          </div>
          </>
        )}
      </PageBody>
    </>
  )
}
