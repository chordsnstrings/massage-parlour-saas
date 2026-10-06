import { branches, rooms, serviceCategories, services, serviceVariants, withTenant } from '@spa/db'
import { asc } from 'drizzle-orm'
import { DoorOpen, Sparkles } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader } from '@/components/ui/card'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { formatAed } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { ROOM_TYPE_LABEL, type RoomType } from './constants'
import { CategorySheet, RoomSheet, SampleMenuButton, ServiceSheet } from './services-client'

export const metadata: Metadata = { title: 'Services & rooms' }

export default async function ServicesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'services.manage')) notFound()
  const slug = ctx.tenant.slug
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
      .select({ id: branches.id, name: branches.name, isDefault: branches.isDefault })
      .from(branches)
      .orderBy(asc(branches.createdAt)),
  }))

  const categoryOptions = data.categories.map((c) => ({ id: c.id, name: c.name.en }))
  const branchOptions = data.branches.map((b) => ({ id: b.id, name: b.name }))
  const list = data.services.map((s) => ({
    ...s,
    variants: data.variants
      .filter((v) => v.serviceId === s.id)
      .map((v) => ({ id: v.id, durationMin: v.durationMin, priceAed: Number(v.priceAed) })),
  }))
  const groups = [
    ...data.categories.map((c) => ({ category: c, items: list.filter((s) => s.categoryId === c.id) })),
    {
      category: null,
      items: list.filter((s) => !s.categoryId || !data.categories.some((c) => c.id === s.categoryId)),
    },
  ].filter((g) => g.category || g.items.length > 0)

  return (
    <>
      <PageHeader
        title="Services & rooms"
        description="Your treatment menu, prices and the rooms they happen in."
        actions={
          <>
            <CategorySheet slug={slug} />
            <ServiceSheet slug={slug} categories={categoryOptions} />
          </>
        }
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
          <div className="space-y-6 lg:col-span-8">
            {list.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<Sparkles className="size-5" strokeWidth={1.5} />}
                  title="No services yet"
                  description="Start from a typical UAE spa menu and adjust prices, or add your own services one by one."
                  action={
                    <div className="flex flex-wrap justify-center gap-2 pt-2">
                      <SampleMenuButton slug={slug} />
                      <ServiceSheet slug={slug} categories={categoryOptions} variant="secondary" />
                    </div>
                  }
                />
              </Card>
            ) : (
              <Stagger className="space-y-6">
                {groups.map(({ category, items }) => (
                  <StaggerItem key={category?.id ?? 'none'}>
                    <Card>
                      <CardHeader
                        title={
                          <span className="flex items-baseline gap-2">
                            {category?.name.en ?? 'Uncategorised'}
                            {category?.name.ar && (
                              <span dir="rtl" lang="ar" className="text-sm font-normal text-muted">
                                {category.name.ar}
                              </span>
                            )}
                          </span>
                        }
                        description={`${items.length} ${items.length === 1 ? 'service' : 'services'}`}
                        action={
                          category && (
                            <CategorySheet
                              slug={slug}
                              category={{ id: category.id, en: category.name.en, ar: category.name.ar }}
                            />
                          )
                        }
                      />
                      <ul className="mt-4 divide-y border-t">
                        {items.length === 0 && (
                          <li className="px-5 py-6 text-sm text-muted sm:px-6">
                            No services in this category yet.
                          </li>
                        )}
                        {items.map((s) => (
                          <li
                            key={s.id}
                            className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-subtle/40 sm:px-6"
                          >
                            <span
                              className="mt-1.5 size-2.5 shrink-0 rounded-full"
                              style={{ background: s.color ?? 'var(--accent)' }}
                              aria-hidden
                            />
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <span className="font-medium">{s.name.en}</span>
                                {s.name.ar && (
                                  <span dir="rtl" lang="ar" className="text-sm text-muted">
                                    {s.name.ar}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {s.variants.map((v) => (
                                  <span
                                    key={v.id}
                                    className="rounded-md border px-2 py-0.5 text-xs tabular-nums text-fg"
                                  >
                                    {v.durationMin} min · {formatAed(v.priceAed)}
                                  </span>
                                ))}
                                {s.therapistsRequired > 1 && <Badge tone="accent">2 therapists</Badge>}
                                {s.roomTypes.map((t) => (
                                  <Badge key={t}>{ROOM_TYPE_LABEL[t as RoomType] ?? t} room</Badge>
                                ))}
                                {!s.onlineBookable && <Badge tone="warning">Not online</Badge>}
                                {!s.active && <Badge>Inactive</Badge>}
                              </div>
                            </div>
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
                                active: s.active,
                                color: s.color,
                                imageUrl: s.imageUrl,
                                variants: s.variants,
                              }}
                            />
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </StaggerItem>
                ))}
              </Stagger>
            )}
          </div>

          <div className="space-y-6 lg:col-span-4">
            <Card>
              <CardHeader
                title="Rooms"
                description="Bookings reserve a room so two clients never share one."
                action={<RoomSheet slug={slug} branches={branchOptions} />}
              />
              <div className="mt-4 border-t">
                {data.rooms.length === 0 ? (
                  <EmptyState
                    icon={<DoorOpen className="size-5" strokeWidth={1.5} />}
                    title="No rooms yet"
                    description="Add each treatment room, including couples suites."
                  />
                ) : (
                  data.branches.map((b) => {
                    const branchRooms = data.rooms.filter((r) => r.branchId === b.id)
                    if (branchRooms.length === 0) return null
                    return (
                      <div key={b.id}>
                        {data.branches.length > 1 && (
                          <p className="px-5 pt-4 text-xs font-medium uppercase tracking-[0.08em] text-muted sm:px-6">
                            {b.name}
                          </p>
                        )}
                        <ul className="divide-y">
                          {branchRooms.map((r) => (
                            <li key={r.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{r.name}</p>
                                <p className="text-xs text-muted">
                                  {ROOM_TYPE_LABEL[r.type as RoomType] ?? r.type}
                                  {!r.active && ' · inactive'}
                                </p>
                              </div>
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
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })
                )}
              </div>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  )
}
