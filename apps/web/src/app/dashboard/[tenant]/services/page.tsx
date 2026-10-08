import {
  bookingItems,
  bookings,
  branches,
  products,
  rooms,
  serviceCategories,
  serviceConsumables,
  services,
  serviceVariants,
  withTenant,
} from '@spa/db'
import { and, asc, count, eq, gte, isNotNull, notInArray } from 'drizzle-orm'
import { DoorOpen, Sparkles } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Card, ListRow, Pill, Stack } from '@/components/crm'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { can, requireMember } from '@/server/access'
import { ROOM_TYPES, type RoomType } from './constants'
import { CategorySheet, RoomSheet, SampleMenuButton, ServiceSheet } from './services-client'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('services.title') }
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

export default async function ServicesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'services.manage')) notFound()
  const { t, fmt } = await getI18n()
  const slug = ctx.tenant.slug
  const since = new Date(Date.now() - 30 * 86_400_000)
  const data = await withTenant(ctx.tenant.id, async (tx) => ({
    categories: await tx
      .select({ id: serviceCategories.id, name: serviceCategories.name })
      .from(serviceCategories)
      .orderBy(asc(serviceCategories.sort), asc(serviceCategories.createdAt)),
    services: await tx.select().from(services).orderBy(asc(services.sort), asc(services.createdAt)),
    variants: await tx
      .select({
        id: serviceVariants.id,
        serviceId: serviceVariants.serviceId,
        durationMin: serviceVariants.durationMin,
        priceAed: serviceVariants.priceAed,
      })
      .from(serviceVariants)
      .orderBy(asc(serviceVariants.sort), asc(serviceVariants.durationMin)),
    rooms: await tx.select().from(rooms).orderBy(asc(rooms.sort), asc(rooms.createdAt)),
    branches: await tx
      .select({
        id: branches.id,
        name: branches.name,
        isDefault: branches.isDefault,
        openingHours: branches.openingHours,
      })
      .from(branches)
      .orderBy(asc(branches.createdAt)),
    // Booked in the last 30 days, per duration (cancelled / no-shows excluded).
    booked: await tx
      .select({ variantId: bookingItems.serviceVariantId, n: count() })
      .from(bookingItems)
      .innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
      .where(
        and(
          isNotNull(bookingItems.serviceVariantId),
          gte(bookingItems.startsAt, since),
          notInArray(bookings.status, ['cancelled', 'no_show']),
        ),
      )
      .groupBy(bookingItems.serviceVariantId),
    stock: await tx
      .select({ variantId: serviceConsumables.serviceVariantId, name: products.name })
      .from(serviceConsumables)
      .innerJoin(products, eq(products.id, serviceConsumables.productId)),
  }))

  const categoryOptions = data.categories.map((c) => ({ id: c.id, name: c.name.en }))
  const branchOptions = data.branches.map((b) => ({ id: b.id, name: b.name }))
  const bookedBy = new Map(data.booked.map((b) => [b.variantId, Number(b.n)]))
  const list = data.services.map((s) => {
    const variants = data.variants
      .filter((v) => v.serviceId === s.id)
      .map((v) => ({
        id: v.id,
        durationMin: v.durationMin,
        priceAed: v.priceAed == null ? null : Number(v.priceAed),
      }))
    const ids = new Set(variants.map((v) => v.id))
    return {
      ...s,
      variants,
      booked: variants.reduce((n, v) => n + (bookedBy.get(v.id) ?? 0), 0),
      stock: [...new Set(data.stock.filter((x) => ids.has(x.variantId)).map((x) => x.name.en))],
    }
  })
  const groups = [
    ...data.categories.map((c) => ({ category: c, items: list.filter((s) => s.categoryId === c.id) })),
    {
      category: null,
      items: list.filter((s) => !s.categoryId || !data.categories.some((c) => c.id === s.categoryId)),
    },
  ].filter((g) => g.category || g.items.length > 0)

  // "Open daily 10:00–22:00" only when the main branch keeps the same single slot every day.
  const hours = (data.branches.find((b) => b.isDefault) ?? data.branches[0])?.openingHours
  const slot = hours?.mon?.length === 1 ? hours.mon[0] : undefined
  const daily =
    slot &&
    DAYS.every(
      (d) =>
        hours?.[d]?.length === 1 && hours[d]?.[0]?.open === slot.open && hours[d]?.[0]?.close === slot.close,
    )
  const sub = [daily && slot ? t('services.openDaily', slot) : null, t('services.pricesIncludeVat')]
    .filter(Boolean)
    .join(' · ')
  const roomTypeLabel = (type: string) =>
    ROOM_TYPES.includes(type as RoomType) ? t(`services.roomType.${type as RoomType}`) : type

  return (
    <>
      <PageHeader
        title={t('services.menuTitle')}
        description={sub}
        actions={
          <>
            <CategorySheet slug={slug} />
            <ServiceSheet slug={slug} categories={categoryOptions} />
          </>
        }
      />
      <PageBody>
        <Stack>
          {list.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Sparkles className="size-5" strokeWidth={1.5} />}
                title={t('services.empty.title')}
                description={t('services.empty.body')}
                action={
                  <div className="flex flex-wrap justify-center gap-2 pt-2">
                    <SampleMenuButton slug={slug} />
                    <ServiceSheet slug={slug} categories={categoryOptions} variant="secondary" />
                  </div>
                }
              />
            </Card>
          ) : (
            groups.map(({ category, items }) => (
              <Card
                key={category?.id ?? 'none'}
                flush
                title={
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    {category?.name.en ?? t('services.uncategorised')}
                    {category?.name.ar && (
                      <span dir="rtl" lang="ar" className="crm-muted text-sm font-normal">
                        {category.name.ar}
                      </span>
                    )}
                  </span>
                }
                sub={t('services.count', { count: items.length })}
                actions={
                  category && (
                    <CategorySheet
                      slug={slug}
                      category={{ id: category.id, en: category.name.en, ar: category.name.ar }}
                    />
                  )
                }
              >
                {items.length === 0 ? (
                  <p className="crm-muted px-[var(--crm-pad-card)] pb-[var(--crm-pad-card)] text-sm">
                    {t('services.emptyCategory')}
                  </p>
                ) : (
                  <div className="crm-tbl-wrap px-[var(--crm-pad-card)] pb-2">
                    <table className="crm-tbl" data-stack="true">
                      <thead>
                        <tr>
                          <th>{t('services.col.treatment')}</th>
                          <th>{t('services.col.durations')}</th>
                          <th className="crm-num-c">{t('services.col.booked')}</th>
                          <th>{t('services.col.stock')}</th>
                          <th>{t('services.col.status')}</th>
                          <th>
                            <span className="sr-only">{t('common.edit')}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((s) => (
                          <tr key={s.id}>
                            <td data-label={t('services.col.treatment')}>
                              <span className="flex items-start gap-2.5">
                                <span
                                  className="mt-1.5 size-2.5 shrink-0 rounded-full"
                                  style={{ background: s.color ?? 'var(--crm-accent)' }}
                                  aria-hidden
                                />
                                <span className="min-w-0">
                                  <span className="block font-semibold">{s.name.en}</span>
                                  {s.name.ar && (
                                    <span dir="rtl" lang="ar" className="crm-muted block text-xs">
                                      {s.name.ar}
                                    </span>
                                  )}
                                  {(s.therapistsRequired > 1 || s.roomTypes.length > 0) && (
                                    <span className="mt-1 flex flex-wrap gap-1">
                                      {s.therapistsRequired > 1 && (
                                        <Pill tone="acc">{t('services.twoTherapists')}</Pill>
                                      )}
                                      {s.roomTypes.map((rt) => (
                                        <Pill key={rt}>
                                          {t('services.roomBadge', { type: roomTypeLabel(rt) })}
                                        </Pill>
                                      ))}
                                    </span>
                                  )}
                                </span>
                              </span>
                            </td>
                            <td data-label={t('services.col.durations')} className="crm-num">
                              <span className="flex flex-col">
                                {s.variants.map((v) => (
                                  <span key={v.id} className="whitespace-nowrap">
                                    {t('services.variant', {
                                      min: v.durationMin,
                                      price:
                                        v.priceAed == null ? t('common.priceOnRequest') : fmt.aed(v.priceAed),
                                    })}
                                  </span>
                                ))}
                              </span>
                            </td>
                            <td data-label={t('services.col.booked')} className="crm-num-c">
                              {fmt.number(s.booked)}
                            </td>
                            <td data-label={t('services.col.stock')} className="crm-muted">
                              {s.stock.length ? s.stock.join(', ') : '—'}
                            </td>
                            <td data-label={t('services.col.status')}>
                              {!s.active ? (
                                <Pill dot>{t('services.inactive')}</Pill>
                              ) : !s.onlineBookable ? (
                                <Pill tone="warn" dot>
                                  {t('services.notOnline')}
                                </Pill>
                              ) : (
                                <Pill tone="ok" dot>
                                  {t('services.live')}
                                </Pill>
                              )}
                            </td>
                            <td className="text-end">
                              <ServiceSheet
                                slug={slug}
                                categories={categoryOptions}
                                service={{
                                  id: s.id,
                                  categoryId: s.categoryId,
                                  name: s.name,
                                  description: s.description,
                                  bufferBeforeMin: s.bufferBeforeMin,
                                  bufferAfterMin: s.bufferAfterMin,
                                  therapistsRequired: s.therapistsRequired,
                                  roomTypes: s.roomTypes,
                                  onlineBookable: s.onlineBookable,
                                  showPrice: s.showPrice,
                                  active: s.active,
                                  color: s.color,
                                  imageUrl: s.imageUrl,
                                  variants: s.variants,
                                }}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            ))
          )}

          <Card
            title={t('services.room.title')}
            sub={t('services.room.sub')}
            actions={<RoomSheet slug={slug} branches={branchOptions} />}
          >
            {data.rooms.length === 0 ? (
              <EmptyState
                icon={<DoorOpen className="size-5" strokeWidth={1.5} />}
                title={t('services.room.emptyTitle')}
                description={t('services.room.emptyBody')}
              />
            ) : (
              data.branches.map((b) => {
                const branchRooms = data.rooms.filter((r) => r.branchId === b.id)
                if (branchRooms.length === 0) return null
                return (
                  <div key={b.id}>
                    {data.branches.length > 1 && <p className="crm-ey mt-2">{b.name}</p>}
                    {branchRooms.map((r) => (
                      <ListRow
                        key={r.id}
                        icon={<DoorOpen />}
                        title={r.name}
                        body={roomTypeLabel(r.type)}
                        end={
                          <>
                            {!r.active && <Pill>{t('services.inactive')}</Pill>}
                            <RoomSheet
                              slug={slug}
                              branches={branchOptions}
                              room={{
                                id: r.id,
                                branchId: r.branchId,
                                name: r.name,
                                type: r.type,
                                active: r.active,
                              }}
                            />
                          </>
                        }
                      />
                    ))}
                  </div>
                )
              })
            )}
          </Card>
        </Stack>
      </PageBody>
    </>
  )
}
