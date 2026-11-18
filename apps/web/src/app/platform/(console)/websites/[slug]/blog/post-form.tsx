'use client'
// F15 blog post editor (Website Studio in the console, R23 — English): EN + AR side by side, cover from the media
// library, search fields. Saving never publishes; Publish / Unpublish / Delete are separate (site.publish).
import { ExternalLink, Eye, EyeOff, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useConfirmAction } from '@/app/dashboard/[tenant]/services/services-client'
import { ImageInput } from '@/components/media/image-input'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ActionForm, FieldError, SubmitButton } from '@/components/ui/form'
import { Input, Label, Textarea } from '@/components/ui/input'
import { studioPath } from '@/lib/paths'
import { deletePostAction, savePostAction, setPostStatusAction } from '../blog-actions'

type Bi = { en: string; ar?: string }
export type PostFormValue = {
  id: string
  slug: string
  status: 'draft' | 'published'
  title: Bi
  excerpt: Bi
  body: Bi
  coverImage: string | null
  seoTitle: Bi
  seoDescription: Bi
}

function BiInputs({
  name,
  label,
  value,
  multiline,
  rows = 3,
  hint,
}: {
  name: string
  label: string
  value?: Bi
  multiline?: boolean
  rows?: number
  hint?: string
}) {
  const Control = multiline ? Textarea : Input
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${name}.en`} className="text-xs text-muted">
            English
          </Label>
          <Control
            id={`${name}.en`}
            name={`${name}.en`}
            defaultValue={value?.en ?? ''}
            rows={rows}
            lang="en"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${name}.ar`} className="text-xs text-muted">
            Arabic (optional)
          </Label>
          <Control
            id={`${name}.ar`}
            name={`${name}.ar`}
            defaultValue={value?.ar ?? ''}
            rows={rows}
            dir="rtl"
            lang="ar"
          />
        </div>
      </div>
      {hint && <p className="text-[13px] text-muted">{hint}</p>}
      <FieldError name={name} />
    </fieldset>
  )
}

export function PostForm({
  slug,
  post,
  canPublish,
  liveUrl,
}: {
  slug: string
  post: PostFormValue | null
  canPublish: boolean
  /** Public URL of the post (shown once it is published). */
  liveUrl: string | null
}) {
  const router = useRouter()
  const { pending, run } = useConfirmAction()
  return (
    <ActionForm
      action={(_prev, fd) => savePostAction(slug, post?.id ?? null, fd)}
      onSuccess={(r) => {
        const id = r.data?.id
        if (!post && typeof id === 'string') router.replace(studioPath(slug, `/blog/${id}`))
        else router.refresh()
      }}
      className="space-y-4"
    >
      <Card>
        <CardHeader title="Post" />
        <CardBody className="space-y-5">
          <BiInputs name="title" label="Title" value={post?.title} />
          <div className="space-y-1.5">
            <Label htmlFor="slug">Web address</Label>
            <Input
              id="slug"
              name="slug"
              defaultValue={post?.slug ?? ''}
              dir="ltr"
              autoComplete="off"
              required
            />
            <p className="text-[13px] text-muted">
              Lowercase letters, numbers and dashes, e.g. hot-stone-benefits. The post opens at /blog/…
            </p>
            <FieldError name="slug" />
          </div>
          <BiInputs
            name="excerpt"
            label="Summary (shown in the list)"
            value={post?.excerpt}
            multiline
            rows={2}
          />
          <BiInputs
            name="body"
            label="Article"
            value={post?.body}
            multiline
            rows={14}
            hint={
              'Blank line = new paragraph · a line starting with "## " is a sub-heading · "- " starts a bullet.'
            }
          />
          <div className="space-y-1.5">
            <ImageInput slug={slug} name="coverImage" label="Cover photo" defaultValue={post?.coverImage} />
            <FieldError name="coverImage" />
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Search results" description="Leave empty to use the title and summary." />
        <CardBody className="space-y-5">
          <BiInputs name="seoTitle" label="Search title" value={post?.seoTitle} />
          <BiInputs
            name="seoDescription"
            label="Search description"
            value={post?.seoDescription}
            multiline
            rows={2}
          />
        </CardBody>
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton>Save</SubmitButton>
        {post && canPublish && (
          <Button
            type="button"
            variant="secondary"
            pending={pending}
            onClick={() =>
              run(
                null,
                () => setPostStatusAction(slug, post.id, post.status === 'published' ? 'draft' : 'published'),
                () => router.refresh(),
              )
            }
          >
            {post.status === 'published' ? <EyeOff /> : <Eye />}
            {post.status === 'published' ? 'Unpublish' : 'Publish'}
          </Button>
        )}
        {post?.status === 'published' && liveUrl && (
          <Button type="button" variant="ghost" asChild>
            <a href={liveUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> View live
            </a>
          </Button>
        )}
        {post && canPublish && (
          <Button
            type="button"
            variant="ghost"
            className="ms-auto"
            pending={pending}
            onClick={() =>
              run(
                'Delete this post? It disappears from the website.',
                () => deletePostAction(slug, post.id),
                () => router.replace(studioPath(slug)),
              )
            }
          >
            <Trash2 /> Delete post
          </Button>
        )}
      </div>
    </ActionForm>
  )
}
