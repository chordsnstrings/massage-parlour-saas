// Per-spa discounts from the console forms (PLAN §18.8: Accept dialog + spa page). Fields come from
// `components/plan/discount-input.tsx`: `{setup|monthly}DiscountKind` + `…Value`.
import { parseDiscount, type SubscriptionDiscounts } from '@spa/core'

export function discountsFromForm(
  fd: FormData,
):
  | { ok: true; discounts: SubscriptionDiscounts }
  | { ok: false; error: string; fieldErrors: Record<string, string> } {
  const discounts: SubscriptionDiscounts = {}
  const fieldErrors: Record<string, string> = {}
  for (const k of ['setup', 'monthly'] as const) {
    const r = parseDiscount(
      String(fd.get(`${k}DiscountKind`) ?? ''),
      String(fd.get(`${k}DiscountValue`) ?? ''),
    )
    if (!r.ok) fieldErrors[`${k}DiscountValue`] = r.error
    else if (r.discount) discounts[k] = r.discount
  }
  const first = Object.values(fieldErrors)[0]
  return first ? { ok: false, error: first, fieldErrors } : { ok: true, discounts }
}
