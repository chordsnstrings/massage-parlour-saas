import { socialPosts, withTenant } from '@spa/db'
import { desc } from 'drizzle-orm'
import { ArrowLeft, Image as ImageIcon, Sparkles } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
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
  const posts = await withTenant(ctx.tenant.id, (tx) =>
    tx.select().from(socialPosts).orderBy(desc(socialPosts.createdAt)).limit(30),
  )
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
        description="AI-written posts in English and Arabic with an image. Approve, schedule, or copy them into Instagram."
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
                      <Badge tone={tone[p.status] ?? 'neutral'}>{p.status.replace('_', ' ')}</Badge>
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
                    <PostActions slug={slug} postId={p.id} status={p.status} caption={p.caption} />
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
