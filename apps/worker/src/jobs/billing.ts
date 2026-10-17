// F22: automatic billing transitions for platform invoices (PLAN §17; services billing-transitions.ts). Daily,
// before the 09:20 billing notifications; idempotent (the same day gives the same state), every change audited,
// notified in the spa dashboard and emailed to the spa's owners + super-admins when staff email is configured.
import { platformDb } from '@spa/db'
import { dubaiToday, runBillingTransitions } from '@spa/services'
import { log } from '../log'

export async function billingTransitions(now = new Date()) {
  const res = await runBillingTransitions(platformDb(), dubaiToday(now))
  const changed = res.changed.map((t) => ({ spa: t.slug, from: t.from.stage, to: t.to.stage }))
  if (changed.length || res.failed.length)
    log(res.failed.length ? 'error' : 'info', 'billing transitions', {
      checked: res.checked,
      changed,
      failed: res.failed,
    })
  return { checked: res.checked, changed, failed: res.failed.length }
}
