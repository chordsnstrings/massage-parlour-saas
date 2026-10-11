import { queueSlotOffers } from '@spa/ai'
import { aiAgentSettings, branches, outbox, platformDb, tenants, withTenant } from '@spa/db'
import {
  autoAssignDueOutbox,
  automationOnSql,
  expirePackages,
  queueBirthdayMessages,
  queueReviewRequests,
  queueWinbackMessages,
  runMembershipRenewals,
} from '@spa/services'
import { and, eq, gte, ne } from 'drizzle-orm'
import { log } from '../log'
import { activeTenants, recordRun } from './runs'

/** Daily: expire packages past their validity and book the unused value as breakage (spas with the switch on). */
export async function expireAllPackages() {
  for (const t of await activeTenants('packageExpiry')) {
    try {
      const n = await withTenant(t.id, (tx) => expirePackages(tx, t.id))
      if (n) log('info', 'packages expired', { tenant: t.slug, n })
      await recordRun(t.id, 'packages-expire', 'ok', { count: n })
    } catch (error) {
      log('error', 'package expiry failed', { tenant: t.slug, error: String(error) })
      await recordRun(t.id, 'packages-expire', 'failed')
    }
  }
}

/** F15 draft kinds: automation switch, job-log name, queue function. */
const CLIENT_DRAFT_JOBS = [
  ['reviewRequests', 'review-requests', queueReviewRequests],
  ['birthdayMessages', 'birthday-messages', queueBirthdayMessages],
  ['winbackMessages', 'winback-messages', queueWinbackMessages],
] as const

/**
 * Hourly (F15): automatic review-request, birthday and win-back WhatsApp drafts (click-to-send) for spas with that
 * switch on (off by default) and Premium marketing (`activeTenants` → `automationOnSql`). Consent, quiet hours and
 * caps are applied by the services. Only runs that queued something are logged.
 */
export async function queueClientDrafts(now = new Date()) {
  for (const [key, job, run] of CLIENT_DRAFT_JOBS) {
    for (const t of await activeTenants(key)) {
      try {
        const n = await withTenant(t.id, (tx) => run(tx, t.id, now))
        if (n) {
          log('info', 'client drafts queued', { tenant: t.slug, job, n })
          await recordRun(t.id, job, 'ok', { count: n })
        }
      } catch (error) {
        log('error', 'client drafts failed', { tenant: t.slug, job, error: String(error) })
        await recordRun(t.id, job, 'failed')
      }
    }
  }
}

/**
 * Every minute (F28): spas with "Assign WhatsApp messages" on (off by default) — due, unassigned messages go
 * round-robin to the receptionists on shift. Only runs that assigned something are logged.
 */
export async function autoAssignOutbox() {
  for (const t of await activeTenants('outboxAutoAssign')) {
    try {
      const n = await withTenant(t.id, (tx) => autoAssignDueOutbox(tx, t.id))
      if (n) {
        log('info', 'outbox auto-assigned', { tenant: t.slug, n })
        await recordRun(t.id, 'outbox-auto-assign', 'ok', { count: n })
      }
    } catch (error) {
      log('error', 'outbox auto-assign failed', { tenant: t.slug, error: String(error) })
      await recordRun(t.id, 'outbox-auto-assign', 'failed')
    }
  }
}

/**
 * Daily: membership periods ending within 7 days → `due` + a WhatsApp renewal reminder queued in /messages
 * (click-to-send); ended periods → `expired` with the unused value recognised (spas with the switch on).
 */
export async function renewAllMemberships() {
  for (const t of await activeTenants('membershipRenewals')) {
    try {
      const r = await withTenant(t.id, (tx) => runMembershipRenewals(tx, t.id))
      if (r.due || r.expired) log('info', 'memberships renewed', { tenant: t.slug, ...r })
      await recordRun(t.id, 'memberships-renew', 'ok', { count: r.due + r.expired })
    } catch (error) {
      log('error', 'membership renewals failed', { tenant: t.slug, error: String(error) })
      await recordRun(t.id, 'memberships-renew', 'failed')
    }
  }
}

/**
 * Twice a day: for spas with the quiet-slot automation on (B3 switch) and the slot-filler agent enabled, queue
 * WhatsApp offers for quiet hours (max once per day). Offers wait in /messages for staff to click-to-send.
 */
export async function runSlotFiller() {
  const enabled = await platformDb()
    .select({ tenantId: aiAgentSettings.tenantId })
    .from(aiAgentSettings)
    .innerJoin(tenants, eq(tenants.id, aiAgentSettings.tenantId))
    .where(
      and(
        eq(aiAgentSettings.agentKey, 'slot_filler'),
        eq(aiAgentSettings.enabled, true),
        ne(tenants.status, 'cancelled'),
        automationOnSql('slotFiller'),
      ),
    )
  const startOfDay = new Date(Date.now() - ((Date.now() + 4 * 3600_000) % 86_400_000))
  for (const { tenantId } of enabled) {
    try {
      // Tenant tables are read as the tenant (RLS); only the enabled-spa lookup above is cross-tenant.
      const branch = await withTenant(tenantId, async (tx) => {
        const [already] = await tx
          .select({ id: outbox.id })
          .from(outbox)
          .where(and(eq(outbox.kind, 'slot_offer'), gte(outbox.createdAt, startOfDay)))
          .limit(1)
        if (already) return null
        const [row] = await tx.select().from(branches).where(eq(branches.isDefault, true))
        return row ?? null
      })
      if (!branch) continue
      const n = await queueSlotOffers({ tenantId, branchId: branch.id })
      if (n) log('info', 'slot offers queued', { tenantId, n })
      await recordRun(tenantId, 'slot-filler', 'ok', { count: n })
    } catch (error) {
      log('error', 'slot filler failed', { tenantId, error: String(error) })
      await recordRun(tenantId, 'slot-filler', 'failed')
    }
  }
}
