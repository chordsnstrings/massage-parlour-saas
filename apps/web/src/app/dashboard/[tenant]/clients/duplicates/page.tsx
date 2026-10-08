import { withTenant } from '@spa/db'
import { type ClientReference, DomainError, duplicateClientPairs, mergePreview } from '@spa/services'
import { ArrowLeft, ArrowLeftRight, UsersRound } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { formatPhone } from '@/components/calendar/time'
import { maskClientPhone } from '@/components/clients/shared'
import { Card, Grid, Note, Pill, Stack, TName } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { MergeButton } from './merge-client'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('clientsMerge.title') }
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const isId = (v: string | undefined): v is string => z.uuid().safeParse(v).success

export default async function DuplicatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'clients.merge')) notFound()
  const { t, fmt } = await getI18n()
  const slug = ctx.tenant.slug
  const sp = await searchParams
  const keep = one(sp.keep)
  const merge = one(sp.merge)
  const base = appPath(`/${slug}/clients/duplicates`)
  const seePhone = can(ctx, 'clients.phone')
  const phone = (p: string | null) =>
    p ? (seePhone ? formatPhone(p) : maskClientPhone(p)) : t('clientsMerge.preview.noPhone')

  if (isId(keep) && isId(merge)) {
    const preview = await withTenant(ctx.tenant.id, (tx) => mergePreview(tx, keep, merge)).catch((e) => {
      if (e instanceof DomainError) return null
      throw e
    })
    if (!preview) notFound()
    const moves = (Object.entries(preview.counts) as [ClientReference, number][]).filter(([, n]) => n > 0)
    const person = (c: typeof preview.keep, label: string, tone: 'ok' | 'warn') => (
      <Card title={label} actions={<Pill tone={tone}>{label}</Pill>}>
        <TName name={c.name} sub={phone(c.phoneE164)} />
        <p className="crm-muted mt-2 text-[length:var(--crm-fs-sub)]">
          {t('clientsMerge.preview.created', { date: fmt.date(c.createdAt) })}
        </p>
      </Card>
    )
    return (
      <>
        <PageHeader
          title={t('clientsMerge.preview.title')}
          description={t('clientsMerge.preview.sub')}
          actions={
            <Button variant="ghost" asChild>
              <Link href={base}>
                <ArrowLeft /> {t('clientsMerge.back')}
              </Link>
            </Button>
          }
        />
        <Stack>
          <Grid cols="g2">
            {person(preview.keep, t('clientsMerge.preview.keep'), 'ok')}
            {person(preview.merge, t('clientsMerge.preview.merge'), 'warn')}
          </Grid>
          <div>
            <Button variant="secondary" asChild>
              <Link href={`${base}?keep=${merge}&merge=${keep}`}>
                <ArrowLeftRight /> {t('clientsMerge.preview.swap')}
              </Link>
            </Button>
          </div>
          <Grid cols="g2">
            <Card title={t('clientsMerge.preview.moves')}>
              {moves.length ? (
                <ul className="space-y-1" data-testid="merge-moves">
                  {moves.map(([k, n]) => (
                    <li key={k}>{t(`clientsMerge.counts.${k}`, { count: n })}</li>
                  ))}
                </ul>
              ) : (
                <p className="crm-muted">{t('clientsMerge.preview.nothing')}</p>
              )}
            </Card>
            <Card title={t('clientsMerge.preview.result')}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="crm-muted">{t('clientsMerge.preview.keep')}</dt>
                <dd>{preview.keep.name}</dd>
                <dt className="crm-muted">{t('clients.col.phone')}</dt>
                <dd>{phone(preview.result.phoneE164)}</dd>
                <dt className="crm-muted">{t('clientsMerge.preview.tags')}</dt>
                <dd>{preview.result.tags.join(', ') || '—'}</dd>
                <dt className="crm-muted">{t('clientsMerge.preview.noShows')}</dt>
                <dd>{fmt.number(preview.result.noShowCount)}</dd>
                <dt className="crm-muted">{t('clientsMerge.preview.lastVisit')}</dt>
                <dd>
                  {preview.result.lastVisitAt
                    ? fmt.date(preview.result.lastVisitAt)
                    : t('clientsMerge.preview.never')}
                </dd>
              </dl>
            </Card>
          </Grid>
          <Note tone="warn">{t('clientsMerge.preview.warning')}</Note>
          <div>
            <MergeButton
              slug={slug}
              keepId={preview.keep.id}
              mergeId={preview.merge.id}
              keepName={preview.keep.name}
              mergeName={preview.merge.name}
            />
          </div>
        </Stack>
      </>
    )
  }

  const pairs = await withTenant(ctx.tenant.id, (tx) => duplicateClientPairs(tx))
  const col = {
    keep: t('clientsMerge.col.keep'),
    merge: t('clientsMerge.col.merge'),
    reason: t('clientsMerge.col.reason'),
  }
  return (
    <>
      <PageHeader
        title={t('clientsMerge.title')}
        description={t('clientsMerge.description')}
        actions={
          <Button variant="ghost" asChild>
            <Link href={appPath(`/${slug}/clients`)}>
              <ArrowLeft /> {t('clients.title')}
            </Link>
          </Button>
        }
      />
      <Card flush>
        {pairs.length === 0 ? (
          <EmptyState
            icon={<UsersRound className="size-5" />}
            title={t('clientsMerge.empty')}
            description={t('clientsMerge.emptySub')}
          />
        ) : (
          <div className="crm-tbl-wrap px-[var(--crm-pad-card)] py-2">
            <table className="crm-tbl" data-stack="true">
              <thead>
                <tr>
                  <th>{col.keep}</th>
                  <th>{col.merge}</th>
                  <th>{col.reason}</th>
                  <th>
                    <span className="sr-only">{t('clientsMerge.col.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((p) => (
                  <tr key={`${p.keep.id}-${p.merge.id}`} data-testid="duplicate-pair">
                    <td data-label={col.keep}>
                      <TName name={p.keep.name} sub={phone(p.keep.phoneE164)} />
                    </td>
                    <td data-label={col.merge}>
                      <TName name={p.merge.name} sub={phone(p.merge.phoneE164)} />
                    </td>
                    <td data-label={col.reason}>
                      <Pill tone={p.reason === 'phone' ? 'acc' : 'neutral'}>
                        {t(`clientsMerge.reason.${p.reason}`)}
                      </Pill>
                    </td>
                    <td>
                      <Button variant="secondary" size="sm" asChild>
                        <Link
                          href={`${base}?keep=${p.keep.id}&merge=${p.merge.id}`}
                          aria-label={`${t('clientsMerge.review')} ${p.keep.name} · ${p.merge.name}`}
                        >
                          {t('clientsMerge.review')}
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
