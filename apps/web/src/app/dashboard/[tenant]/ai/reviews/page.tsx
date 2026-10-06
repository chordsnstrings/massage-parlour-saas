import { reviews, withTenant } from '@spa/db'
import { desc } from 'drizzle-orm'
import { ArrowLeft, Plus, Star } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { formatDate } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { addReviewAction, saveReplyAction } from '../actions'
import { DraftReplyButton } from './draft-button'

export const metadata: Metadata = { title: 'Review replies' }

const stars = (n: number) => (
  <span className="inline-flex gap-0.5 text-warning" aria-label={`${n} stars`}>
    {Array.from({ length: 5 }, (_, i) => (
      <Star key={i} className="size-3.5" fill={i < n ? 'currentColor' : 'none'} strokeWidth={1.5} />
    ))}
  </span>
)

export default async function ReviewsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'ai.approve')) notFound()
  const slug = ctx.tenant.slug
  const rows = await withTenant(ctx.tenant.id, (tx) =>
    tx.select().from(reviews).orderBy(desc(reviews.reviewedAt)).limit(50),
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
        title="Google review replies"
        description="Until Google approves API access, paste new reviews here — the AI drafts a reply you can copy into Google."
        actions={
          <FormSheet
            title="Add a review"
            action={addReviewAction.bind(null, slug)}
            trigger={
              <Button>
                <Plus /> Add review
              </Button>
            }
          >
            <Field label="Reviewer" name="author">
              <Input id="author" name="author" />
            </Field>
            <Field label="Rating" name="rating">
              <Select id="rating" name="rating" defaultValue="5">
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n} stars
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Review text" name="text">
              <Textarea id="text" name="text" dir="auto" />
            </Field>
          </FormSheet>
        }
      />
      <PageBody>
        {rows.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Star className="size-5" />}
              title="No reviews yet"
              description="Add your latest Google reviews to draft replies."
            />
          </Card>
        ) : (
          <Stagger className="grid gap-4 lg:grid-cols-2">
            {rows.map((r) => (
              <StaggerItem key={r.id}>
                <Card className="space-y-4 p-5 sm:p-6">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{r.author ?? 'Guest'}</p>
                      {stars(r.rating)}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        tone={
                          r.replyStatus === 'posted'
                            ? 'success'
                            : r.replyStatus === 'none'
                              ? 'neutral'
                              : 'accent'
                        }
                      >
                        {r.replyStatus === 'none' ? 'No reply' : r.replyStatus}
                      </Badge>
                      {r.reviewedAt && <span className="text-xs text-muted">{formatDate(r.reviewedAt)}</span>}
                    </div>
                  </div>
                  {r.text && (
                    <p dir="auto" className="text-[15px] leading-relaxed text-muted">
                      {r.text}
                    </p>
                  )}
                  {r.replyText ? (
                    <ActionForm action={saveReplyAction.bind(null, slug)} className="space-y-3">
                      <input type="hidden" name="reviewId" value={r.id} />
                      <Textarea name="reply" defaultValue={r.replyText} dir="auto" aria-label="Reply" />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-sm text-muted">
                          <Checkbox name="posted" defaultChecked={r.replyStatus === 'posted'} /> Posted on
                          Google
                        </label>
                        <SubmitButton size="sm">Save</SubmitButton>
                      </div>
                    </ActionForm>
                  ) : (
                    <DraftReplyButton slug={slug} reviewId={r.id} />
                  )}
                </Card>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </PageBody>
    </>
  )
}
