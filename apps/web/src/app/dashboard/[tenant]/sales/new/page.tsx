import { enumLabel } from '@spa/core/i18n'
import {
  bookings,
  membershipPlans,
  packageDefinitions,
  products,
  services,
  serviceVariants,
  staff,
  stockLevels,
  withTenant,
} from '@spa/db'
import { and, asc, eq } from 'drizzle-orm'
import { ArrowLeft, Store } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card } from '@/components/crm'
import { Checkout } from '@/components/pos/checkout'
import { Button } from '@/components/ui/button'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { bookingPrefill, CHECKOUT_OK } from '../booking-prefill'
import { pickBranch } from '../data'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('sales.newSale') }
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function NewSalePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'pos.use')) notFound()
  const slug = ctx.tenant.slug
  const sp = await searchParams
  const bookingParam = one(sp.booking)
  const canCommission = can(ctx, 'calendar.commission')
  const { t } = await getI18n()

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    let booking: typeof bookings.$inferSelect | undefined
    if (bookingParam && UUID.test(bookingParam)) {
      ;[booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingParam))
    }
    const picked = await pickBranch(tx, ctx, booking?.branchId ?? one(sp.branch))
    if (!picked || (booking && picked.branch.id !== booking.branchId)) return null
    const menuRows = await tx
      .select({
        variantId: serviceVariants.id,
        serviceId: services.id,
        name: services.name,
        durationMin: serviceVariants.durationMin,
        price: serviceVariants.priceAed,
      })
      .from(serviceVariants)
      .innerJoin(services, eq(services.id, serviceVariants.serviceId))
      .where(and(eq(services.active, true), eq(serviceVariants.active, true)))
      .orderBy(
        asc(services.sort),
        asc(services.createdAt),
        asc(serviceVariants.sort),
        asc(serviceVariants.durationMin),
      )
    const productRows = await tx
      .select({
        id: products.id,
        name: products.name,
        price: products.priceAed,
        qty: stockLevels.qty,
        unit: products.unit,
      })
      .from(products)
      .leftJoin(
        stockLevels,
        and(eq(stockLevels.productId, products.id), eq(stockLevels.branchId, picked.branch.id)),
      )
      .where(and(eq(products.kind, 'retail'), eq(products.active, true)))
      .orderBy(asc(products.createdAt))
    const packageRows = await tx
      .select({
        id: packageDefinitions.id,
        name: packageDefinitions.name,
        price: packageDefinitions.priceAed,
      })
      .from(packageDefinitions)
      .where(eq(packageDefinitions.active, true))
      .orderBy(asc(packageDefinitions.createdAt))
    const planRows = await tx
      .select({ id: membershipPlans.id, name: membershipPlans.name, price: membershipPlans.monthlyAed })
      .from(membershipPlans)
      .where(eq(membershipPlans.active, true))
      .orderBy(asc(membershipPlans.createdAt))
    const staffRows = await tx
      .select({ id: staff.id, name: staff.displayName, branchIds: staff.branchIds })
      .from(staff)
      .where(eq(staff.active, true))
      .orderBy(asc(staff.sort), asc(staff.displayName))
    const prefill = booking ? await bookingPrefill(tx, ctx, booking) : null
    return {
      branch: picked.branch,
      products: productRows.map((p) => ({
        id: p.id,
        label: p.name.en,
        priceAed: Number(p.price ?? 0),
        stock: `${Number(p.qty ?? 0)} ${p.unit}`,
      })),
      packages: packageRows.map((p) => ({ id: p.id, label: p.name.en, priceAed: Number(p.price) })),
      plans: planRows.map((p) => ({ id: p.id, label: p.name.en, priceAed: Number(p.price) })),
      menu: menuRows.map((m) => ({
        variantId: m.variantId,
        serviceId: m.serviceId,
        label: `${m.name.en ?? Object.values(m.name)[0] ?? 'Service'} · ${m.durationMin} min`,
        priceAed: m.price == null ? null : Number(m.price),
      })),
      staff: staffRows
        .filter((s) => !s.branchIds.length || s.branchIds.includes(picked.branch.id))
        .map((s) => ({ id: s.id, name: s.name })),
      prefill,
    }
  })

  const back = (
    <Button variant="ghost" asChild>
      <Link href={appPath(`/${slug}/sales`)}>
        <ArrowLeft /> {t('sales.back')}
      </Link>
    </Button>
  )

  if (!data) {
    return (
      <>
        <PageHeader title={t('sales.newSale')} actions={back} />
        <Card>
          <EmptyState
            icon={<Store className="size-5" />}
            title={t('sales.checkout.notFoundTitle')}
            description={t('sales.checkout.notFoundBody')}
          />
        </Card>
      </>
    )
  }

  const { prefill } = data
  const blocked = prefill && (!CHECKOUT_OK.includes(prefill.status) || prefill.paid || prefill.dayLocked)
  return (
    <>
      <PageHeader
        eyebrow={prefill ? t('sales.checkout.booking', { ref: prefill.ref }) : data.branch.name}
        title={prefill ? t('sales.checkout.title') : t('sales.newSale')}
        description={t('sales.checkout.description')}
        actions={back}
      />
      {blocked ? (
        <Card>
          <EmptyState
            icon={<Store className="size-5" />}
            title={t('sales.checkout.blockedTitle')}
            description={
              prefill.dayLocked && CHECKOUT_OK.includes(prefill.status) && !prefill.paid
                ? t('bookings.order.closedNote')
                : t('sales.checkout.blockedBody', {
                    status: enumLabel(t, 'bookingStatus', prefill.status).toLowerCase(),
                  })
            }
          />
        </Card>
      ) : (
        <Checkout
          slug={slug}
          branchId={data.branch.id}
          bookingId={prefill?.bookingId ?? null}
          client={prefill?.client ?? null}
          initialLines={prefill?.lines ?? []}
          menu={data.menu}
          products={data.products}
          packages={data.packages}
          plans={data.plans}
          staff={data.staff}
          receiptBase={appPath(`/${slug}/sales`)}
          commissions={canCommission ? (prefill?.commissions ?? []) : []}
        />
      )}
    </>
  )
}
