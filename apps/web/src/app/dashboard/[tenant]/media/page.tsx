import { mediaAssets, withTenant } from '@spa/db'
import { listAssets, listTags } from '@spa/services'
import { count, sum } from 'drizzle-orm'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MediaLibrary } from '@/components/media/media-library'
import { formatBytes, toMediaItem } from '@/components/media/types'
import { PageBody, PageHeader } from '@/components/ui/page'
import { getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { canonicalUrls } from '@/server/origin'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('media.title') }
}

const PAGE = 60

export default async function MediaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ source?: string; tag?: string; q?: string; n?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'site.content')) notFound()
  const sp = await searchParams
  const t = await getT()
  const filter = {
    source: sp.source === 'upload' || sp.source === 'ai' ? sp.source : undefined,
    tag: sp.tag?.trim().toLowerCase().slice(0, 32) || undefined,
    q: sp.q?.trim().slice(0, 80) || undefined,
  } as const
  const limit = Math.min(Math.max(Number(sp.n) || PAGE, PAGE), 600)
  const slug = ctx.tenant.slug
  const base = appPath(`/${slug}/media`)

  const data = await withTenant(ctx.tenant.id, async (tx) => ({
    rows: await listAssets(tx, { ...filter, limit: limit + 1 }),
    tags: await listTags(tx),
    totals: (await tx.select({ n: count(), bytes: sum(mediaAssets.bytes) }).from(mediaAssets))[0],
  }))
  const items = data.rows.slice(0, limit).map(toMediaItem)
  const more = data.rows.length > limit
  const moreParams = new URLSearchParams(
    Object.entries({ ...filter, n: String(limit + PAGE) }).filter((e): e is [string, string] =>
      Boolean(e[1]),
    ),
  )
  const n = data.totals?.n ?? 0

  return (
    <>
      <PageHeader
        title={t('media.title')}
        description={
          n > 0
            ? t('media.descCount', { count: n, size: formatBytes(Number(data.totals?.bytes ?? 0)) })
            : t('media.descEmpty')
        }
      />
      <PageBody>
        <MediaLibrary
          slug={slug}
          base={base}
          origin={new URL(canonicalUrls().site(slug)).origin}
          items={items}
          tags={data.tags}
          filter={filter}
          moreHref={more ? `${base}?${moreParams}` : null}
        />
      </PageBody>
    </>
  )
}
