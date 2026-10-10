'use client'
// F15 blog post editor (Website Studio): EN + AR side by side, cover from the media library, search fields.
// Saving never publishes; Publish / Unpublish / Delete are separate (site.publish).
import { ExternalLink, Eye, EyeOff, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/crm'
import { ImageInput } from '@/components/media/image-input'
import { Button } from '@/components/ui/button'
import { ActionForm, FieldError, SubmitButton } from '@/components/ui/form'
import { Input, Label, Textarea } from '@/components/ui/input'
import { useT } from '@/i18n/client'
import { appPath } from '@/lib/paths'
import { useConfirmAction } from '../../services/services-client'
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
  const t = useT()
  const Control = multiline ? Textarea : Input
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${name}.en`} className="crm-muted text-xs">
            {t('website.blog.english')}
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
          <Label htmlFor={`${name}.ar`} className="crm-muted text-xs">
            {t('website.blog.arabic')}
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
      {hint && <p className="crm-muted text-[13px]">{hint}</p>}
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
  const t = useT()
  const router = useRouter()
  const { pending, run } = useConfirmAction()
  return (
    <ActionForm
      action={(_prev, fd) => savePostAction(slug, post?.id ?? null, fd)}
      onSuccess={(r) => {
        const id = r.data?.id
        if (!post && typeof id === 'string') router.replace(appPath(`/${slug}/website/blog/${id}`))
        else router.refresh()
      }}
      className="space-y-4"
    >
      <Card title={t('website.blog.fieldTitle')}>
        <div className="space-y-5">
          <BiInputs name="title" label={t('website.blog.fieldTitle')} value={post?.title} />
          <div className="space-y-1.5">
            <Label htmlFor="slug">{t('website.blog.fieldSlug')}</Label>
            <Input
              id="slug"
              name="slug"
              defaultValue={post?.slug ?? ''}
              dir="ltr"
              autoComplete="off"
              required
            />
            <p className="crm-muted text-[13px]">{t('website.blog.slugHint')}</p>
            <FieldError name="slug" />
          </div>
          <BiInputs
            name="excerpt"
            label={t('website.blog.fieldExcerpt')}
            value={post?.excerpt}
            multiline
            rows={2}
          />
          <BiInputs
            name="body"
            label={t('website.blog.fieldBody')}
            value={post?.body}
            multiline
            rows={14}
            hint={t('website.blog.bodyHint')}
          />
          <div className="space-y-1.5">
            <ImageInput
              slug={slug}
              name="coverImage"
              label={t('website.blog.fieldCover')}
              defaultValue={post?.coverImage}
            />
            <FieldError name="coverImage" />
          </div>
        </div>
      </Card>
      <Card title={t('website.blog.seo')} sub={t('website.blog.seoHint')}>
        <div className="space-y-5">
          <BiInputs name="seoTitle" label={t('website.blog.seoTitle')} value={post?.seoTitle} />
          <BiInputs
            name="seoDescription"
            label={t('website.blog.seoDescription')}
            value={post?.seoDescription}
            multiline
            rows={2}
          />
        </div>
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton>{t('website.blog.save')}</SubmitButton>
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
            {post.status === 'published' ? t('website.blog.unpublish') : t('website.blog.publish')}
          </Button>
        )}
        {post?.status === 'published' && liveUrl && (
          <Button type="button" variant="ghost" asChild>
            <a href={liveUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> {t('website.blog.viewLive')}
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
                t('website.blog.deleteConfirm'),
                () => deletePostAction(slug, post.id),
                () => router.replace(appPath(`/${slug}/website`)),
              )
            }
          >
            <Trash2 /> {t('website.blog.delete')}
          </Button>
        )}
      </div>
    </ActionForm>
  )
}
