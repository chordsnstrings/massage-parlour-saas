'use server'
// R36 inline Confirm (dashboard home; the CRM pop-up may reuse it): the prefill of the R32 Confirm form for one
// pending booking — the same amounts the booking page offers. Confirming itself stays confirmBookingAction.
import { withTenant } from '@spa/db'
import { bookingDetail, lastBookingTerms } from '@spa/services'
import { z } from 'zod'
import { allowedBranches } from '@/app/dashboard/[tenant]/calendar/data'
import type { TermsItem } from '@/components/bookings/order-forms'
import { can, guard } from '@/server/access'

export type ConfirmTerms = { ref: string; canCommission: boolean; items: TermsItem[] }

/** null: not found, not in the viewer's branches, no longer pending, or no calendar.manage. */
export async function confirmTermsAction(slug: string, bookingId: string): Promise<ConfirmTerms | null> {
  const { ctx, error } = await guard(slug, 'calendar.manage')
  if (error || !z.uuid().safeParse(bookingId).success) return null
  return withTenant(ctx.tenant.id, async (tx) => {
    const b = await bookingDetail(tx, bookingId)
    if (b?.status !== 'pending') return null
    if (!(await allowedBranches(tx, ctx)).some((br) => br.id === b.branchId)) return null
    const last = await lastBookingTerms(
      tx,
      b.items.flatMap((i) => (i.serviceVariantId ? [i.serviceVariantId] : [])),
    )
    return {
      ref: b.refCode,
      canCommission: can(ctx, 'calendar.commission'),
      // Prefill as the booking page: the typed fee/commission, else the last used for the treatment, else the list price.
      items: b.items.map((i) => {
        const prev = i.serviceVariantId ? last.get(i.serviceVariantId) : undefined
        return {
          id: i.id,
          serviceName: i.serviceName,
          feeAed: i.termsSet ? i.priceAed : (prev?.feeAed ?? i.priceAed),
          commissionAed: i.plannedCommissionAed ?? prev?.commissionAed ?? null,
        }
      }),
    }
  })
}
