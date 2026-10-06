import { socialPosts, withTenant } from '@spa/db'
import { gbpConnectionView, getGbpAccount, instagramStatus, metaConfig, publicImageUrl } from '@spa/services'
import { desc } from 'drizzle-orm'
import { ArrowLeft, Image as ImageIcon, Sparkles } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { InstagramGlyph } from '@/components/inbox/icons'
import { GbpPostButton } from '@/components/integrations/gbp-post-button'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Checkbox, Textarea } from '@/components/ui/input'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { formatDateTime } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { draftPostAction } from '../actions'
import { PostActions } from './post-actions'

export const metadata: Metadata = { title: 'Instagram drafts' }

const tone: Record<string, 'accent' | 'warning' | 'success' | 'neutral' | 'danger'> = {
  pending_approval: 'warning',
  scheduled: 'accent',
  published: 'success',
  draft: 'neutral',
  failed: 'danger',
}

export default async function ContentPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'ai.approve')) notFound()
  const slug = ctx.tenant.slug
  const { posts, ig, gbp } = await withTenant(ctx.tenant.id, async (tx) => ({
    posts: await tx.select().from(socialPosts).orderBy(desc(socialPosts.createdAt)).limit(30),
    ig: await instagramStatus(tx),
    gbp: gbpConnectionView(await getGbpAccount(tx, ctx.tenant.id)),
  }))
  // Why "Publish to Instagram" can't run for a post (null = ready).
  const accountBlocker = !metaConfig()
    ? 'Instagram publishing isn’t configured on this server yet — copy the caption instead.'
    : ig?.status !== 'connected'
      ? 'Connect Instagram in Settings → Instagram & Google to publish from here.'
      : null
  const publishBlocker = (p: (typeof posts)[number]) => {
    if (accountBlocker) return accountBlocker
    if (!p.media[0]?.url) return 'Instagram posts need an image.'
    if (!publicImageUrl(p.media[0].url))
      return 'The image isn’t on a public https link, so Instagram can’t fetch it.'
    return null
  }
  return (
    <>
      <Link
        href={appPath(`/${slug}/ai`)}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" strokeWidth={1.5} /> AI studio
      </Link>
      <PageHeader
        title="Instagram drafts"
        description="AI-written posts in English and Arabic with an image. Approve, then publish to Instagram now, schedule them, or copy the caption."
      />
      <PageBody>
        <Card>
          <CardHeader
            title="New draft"
            description="Give an idea, or leave it empty for a fresh suggestion. Images take about 15 seconds."
          />
          <CardBody>
            <ActionForm
              action={draftPostAction.bind(null, slug)}
              className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end"
              resetOnSuccess
            >
              <Field label="Idea" name="brief">
                <Textarea
                  id="brief"
                  name="brief"
                  className="min-h-20"
                  placeholder="Weekday afternoon offer on our 90-minute Thai massage"
                />
              </Field>
              <div className="flex flex-col gap-3 md:items-end">
                <label className="flex items-center gap-2.5 text-sm">
                  <Checkbox name="image" defaultChecked /> Create an image
                </label>
                <SubmitButton>
                  <Sparkles /> Draft post
                </SubmitButton>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
        {posts.length === 0 ? (
          <Card>
            <EmptyState
              icon={<ImageIcon className="size-5" />}
              title="No drafts yet"
              description="Your first AI post will appear here for review."
            />
          </Card>
        ) : (
          <Stagger className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {posts.map((p) => (
              <StaggerItem key={p.id}>
                <Card className="flex h-full flex-col overflow-hidden">
                  {p.media[0] ? (
                    // biome-ignore lint/performance/noImgElement: remote AI image URL
                    <img
                      src={p.media[0].url}
                      alt={p.media[0].alt ?? ''}
                      className="aspect-square w-full bg-subtle object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="grid aspect-square place-items-center bg-subtle text-muted">
                      <ImageIcon className="size-6" strokeWidth={1.5} />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Badge tone={tone[p.status] ?? 'neutral'}>{p.status.replace('_', ' ')}</Badge>
                        {p.platform === 'gbp' && <Badge>Google</Badge>}
                      </span>
                      <span className="text-xs text-muted">
                        {p.scheduledAt
                          ? `Scheduled ${formatDateTime(p.scheduledAt)}`
                          : formatDateTime(p.createdAt)}
                      </span>
                    </div>
                    <p
                      dir="auto"
                      className="line-clamp-[10] flex-1 whitespace-pre-wrap text-sm leading-relaxed"
                    >
                      {p.caption}
                    </p>
                    {p.status === 'failed' && p.error && (
                      <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{p.error}</p>
                    )}
                    {p.status === 'published' && p.externalId && (
                      <p className="flex items-center gap-1.5 text-[13px] text-muted">
                        <InstagramGlyph className="size-3.5" /> Published to Instagram
                        {p.publishedAt ? ` · ${formatDateTime(p.publishedAt)}` : ''}
                      </p>
                    )}
                    {p.status === 'scheduled' && p.scheduledAt && !publishBlocker(p) && (
                      <p className="text-[13px] text-muted">Publishes automatically at the scheduled time.</p>
                    )}
                    <PostActions
                      slug={slug}
                      postId={p.id}
                      status={p.status}
                      caption={p.caption}
                      publishBlocker={
                        p.platform === 'instagram'
                          ? publishBlocker(p)
                          : 'Only Instagram posts can be published here.'
                      }
                    />
                    {gbp?.status === 'connected' &&
                      p.platform !== 'gbp' &&
                      (p.status === 'scheduled' || p.status === 'published') && (
                        <GbpPostButton slug={slug} postId={p.id} />
                      )}
                  </div>
                </Card>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </PageBody>
    </>
  )
}
