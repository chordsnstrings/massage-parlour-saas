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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { cn } from '@/lib/utils'
import { can, requireMember } from '@/server/access'

export const metadata: Metadata = { title: 'Inbox' }

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
  const f = one(sp.f)
  const filter: InboxFilter = FILTERS.some((x) => x.key === f) ? (f as InboxFilter) : 'open'
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
    ? 'Sandbox: Instagram isn’t set up on this server yet, so replies are saved here but not sent.'
    : !account
      ? 'Instagram isn’t connected, so replies are saved here but not sent.'
      : !connected
        ? 'The Instagram connection expired — reconnect it in Settings to send replies.'
        : null

  const status = !configured ? (
    <Badge>Instagram not configured</Badge>
  ) : connected ? (
    <Badge tone="success">
      <InstagramGlyph className="size-3" />
      {account?.username ? `@${account.username}` : 'Connected'}
    </Badge>
  ) : account ? (
    <Badge tone="warning">Needs reconnecting</Badge>
  ) : (
    <Badge>Not connected</Badge>
  )

  return (
    <>
      <InboxAutoRefresh />
      <PageHeader
        title="Inbox"
        description="Instagram DMs and comments in one place. The AI receptionist answers or drafts replies following your AI studio settings — take over any time."
        actions={
          <>
            {status}
            {can(ctx, 'ai.manage') && (
              <Button
                asChild
                variant="ghost"
                className="min-h-11 min-w-11 px-0 sm:min-h-10 sm:px-4"
                title="AI receptionist settings"
              >
                <Link href={appPath(`/${slug}/ai`)}>
                  <Bot /> <span className="sr-only sm:not-sr-only">Receptionist</span>
                </Link>
              </Button>
            )}
            {canSettings && (
              <Button
                asChild
                variant="ghost"
                className="min-h-11 min-w-11 px-0 sm:min-h-10 sm:px-4"
                title="Instagram connection"
              >
                <Link href={settingsHref}>
                  <Settings2 /> <span className="sr-only sm:not-sr-only">Instagram</span>
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
              title={connected ? 'No messages yet' : 'Connect Instagram to start'}
              description={
                connected
                  ? 'New Instagram DMs and comments appear here as they arrive. The AI receptionist drafts or sends replies depending on its mode in AI studio.'
                  : !configured
                    ? 'Instagram isn’t configured on this server yet. Once it is, connect your professional account in Settings → Instagram & Google and DMs and comments will land here.'
                    : 'Connect your Instagram professional account in Settings → Instagram & Google. DMs and comments then land here, with AI-drafted replies for you to approve.'
              }
              action={
                !connected && canSettings ? (
                  <Button asChild className="min-h-11">
                    <Link href={settingsHref}>
                      <InstagramGlyph /> Instagram settings
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-12">
            <Card
              className={cn(
                'overflow-hidden lg:col-span-5 lg:self-start xl:col-span-4',
                thread && 'hidden lg:block',
              )}
            >
              <div className="border-b p-3 sm:p-4">
                <InboxFilters slug={slug} active={filter} counts={counts} />
              </div>
              <div className="lg:max-h-[calc(100dvh-16rem)] lg:overflow-y-auto">
                <ConversationList
                  slug={slug}
                  rows={rows}
                  filter={filter}
                  selectedId={thread?.conversation.id}
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
                />
              ) : (
                <Card className="lg:min-h-96">
                  <EmptyState
                    icon={<MessagesSquare className="size-5" strokeWidth={1.5} />}
                    title={selected ? 'Conversation not found' : 'Pick a conversation'}
                    description={
                      counts.unread
                        ? `${counts.unread} unread ${counts.unread === 1 ? 'conversation' : 'conversations'}.`
                        : 'You’re all caught up.'
                    }
                  />
                </Card>
              )}
            </div>
          </div>
        )}
      </PageBody>
    </>
  )
}
