import { bookingItems, bookings, clients, services, serviceVariants, staff, withTenant } from '@spa/db'
import { and, asc, eq } from 'drizzle-orm'
import { ArrowLeft, Store } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { maskPhone } from '@/components/calendar/time'
import { Checkout, type CheckoutLine } from '@/components/pos/checkout'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { pickBranch } from '../data'

export const metadata: Metadata = { title: 'New sale' }

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CHECKOUT_OK = ['confirmed', 'checked_in', 'in_service']

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
  const seePhone = can(ctx, 'clients.phone')

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
    const staffRows = await tx
      .select({ id: staff.id, name: staff.displayName, branchIds: staff.branchIds })
      .from(staff)
      .where(eq(staff.active, true))
      .orderBy(asc(staff.sort), asc(staff.displayName))
    let prefill: {
      bookingId: string
      ref: string
      status: string
      client: { id: string; name: string; phone: string | null } | null
      lines: CheckoutLine[]
    } | null = null
    if (booking) {
      const items = await tx
        .select()
        .from(bookingItems)
        .where(eq(bookingItems.bookingId, booking.id))
        .orderBy(asc(bookingItems.startsAt))
      const [client] = booking.clientId
        ? await tx
            .select({ id: clients.id, name: clients.name, phone: clients.phoneE164 })
            .from(clients)
            .where(eq(clients.id, booking.clientId))
        : []
      prefill = {
        bookingId: booking.id,
        ref: booking.refCode,
        status: booking.status,
        client: client
          ? {
              id: client.id,
              name: client.name,
              phone: client.phone ? (seePhone ? `+${client.phone}` : maskPhone(client.phone)) : null,
            }
          : null,
        // One line per therapist so tips and commission land with the right person.
        lines: items.flatMap((it) => {
          const people = it.staffIds.length ? it.staffIds : [null]
          const total = Math.round(Number(it.priceAed) * 100)
          const share = Math.floor(total / people.length)
          return people.map((sid, i) => ({
            key: `${it.id}-${i}`,
            kind: 'service' as const,
            refId: it.serviceVariantId,
            description: `${it.serviceName} · ${it.durationMin} min`,
            qty: 1,
            unitPriceAed: (i === people.length - 1 ? total - share * (people.length - 1) : share) / 100,
            discountAed: 0,
            staffId: sid,
          }))
        }),
      }
    }
    return {
      branch: picked.branch,
      menu: menuRows.map((m) => ({
        variantId: m.variantId,
        label: `${m.name.en ?? Object.values(m.name)[0] ?? 'Service'} · ${m.durationMin} min`,
        priceAed: Number(m.price),
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
        <ArrowLeft /> Sales
      </Link>
    </Button>
  )

  if (!data) {
    return (
      <>
        <PageHeader title="New sale" actions={back} />
        <PageBody>
          <Card>
            <EmptyState
              icon={<Store className="size-5" />}
              title="Nothing to check out here"
              description="The booking wasn’t found, or it belongs to a branch you don’t have access to."
            />
          </Card>
        </PageBody>
      </>
    )
  }

  const { prefill } = data
  const blocked = prefill && !CHECKOUT_OK.includes(prefill.status)
  return (
    <>
      <PageHeader
        eyebrow={prefill ? `Booking ${prefill.ref}` : data.branch.name}
        title={prefill ? 'Check out' : 'New sale'}
        description="Payments are recorded here, not charged — take the money with cash, your card terminal or a transfer."
        actions={back}
      />
      <PageBody>
        {blocked ? (
          <Card>
            <EmptyState
              icon={<Store className="size-5" />}
              title="This booking can’t be checked out"
              description={`It is ${prefill.status.replace('_', ' ')}. Open the sales list to find its receipt.`}
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
            staff={data.staff}
            receiptBase={appPath(`/${slug}/sales`)}
          />
        )}
      </PageBody>
    </>
  )
}
