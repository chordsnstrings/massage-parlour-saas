'use client'
import { CheckCircle2, MessageSquarePlus, Send, Undo2 } from 'lucide-react'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Select, Textarea } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import {
  approveSiteAction,
  requestChangeAction,
  resolveChangeAction,
  setReviewAction,
} from './studio-actions'

/** Spa → studio: "please change …", optionally about one page. */
export function RequestChangeSheet({
  slug,
  pages,
  label = 'Request a change',
}: {
  slug: string
  pages: { id: string; title: string }[]
  label?: string
}) {
  return (
    <FormSheet
      title="Request a change"
      description="Tell the studio what you'd like changed. They'll update your site and let you know here."
      trigger={
        <Button variant="secondary">
          <MessageSquarePlus /> {label}
        </Button>
      }
      action={requestChangeAction.bind(null, slug)}
      submitLabel="Send to studio"
    >
      {pages.length > 0 && (
        <Field label="Page (optional)" name="pageId">
          <Select id="pageId" name="pageId" defaultValue="">
            <option value="">Whole site</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field
        label="What should change?"
        name="body"
        hint="New photos? Send them to Media first and mention them here."
      >
        <Textarea
          id="body"
          name="body"
          required
          minLength={3}
          maxLength={2000}
          placeholder="e.g. Use our new opening hours banner on the home page and swap the hero photo."
        />
      </Field>
    </FormSheet>
  )
}

export function ApproveSiteSheet({ slug }: { slug: string }) {
  return (
    <FormSheet
      title="Approve your website?"
      description="The studio will publish it as you see it in the preview. You can still ask for changes later."
      trigger={
        <Button>
          <CheckCircle2 /> Approve
        </Button>
      }
      action={() => approveSiteAction(slug)}
      submitLabel="Approve website"
    >
      <p className="text-sm text-muted">
        Prices, team and opening hours always show live data from your dashboard.
      </p>
    </FormSheet>
  )
}

/** Studio: hand the site to the spa for review, or pull it back. */
export function ReviewButton({ slug, review }: { slug: string; review: boolean }) {
  const [pending, start] = useTransition()
  return (
    <Button
      variant={review ? 'primary' : 'secondary'}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setReviewAction(slug, review)
          if (r?.ok) toast.success(r.message ?? 'Saved')
          else if (r) toast.error(r.error)
        })
      }
    >
      {review ? <Send /> : <Undo2 />} {review ? 'Send for review' : 'Withdraw review'}
    </Button>
  )
}

export function ResolveRequestSheet({ slug, id }: { slug: string; id: string }) {
  return (
    <FormSheet
      title="Close this request"
      description="The spa sees your note next to their request."
      trigger={
        <Button variant="secondary" size="sm" className="h-10">
          Resolve
        </Button>
      }
      action={resolveChangeAction.bind(null, slug)}
      submitLabel="Close request"
    >
      <input type="hidden" name="id" value={id} />
      <Field label="Outcome" name="status">
        <Select id="status" name="status" defaultValue="done">
          <option value="done">Done</option>
          <option value="declined">Declined</option>
        </Select>
      </Field>
      <Field label="Note to the spa (optional)" name="response">
        <Textarea id="response" name="response" maxLength={2000} />
      </Field>
    </FormSheet>
  )
}
