// `status` namespace (EN source): labels of the status values console pages print. English = what the console
// prints today (mostly the raw value, e.g. "past_due"), so default-locale screens and e2e specs stay identical; a
// page that prints a friendlier English label (e.g. "past due", "paused") keeps its own key in its namespace.
// Read through consoleStatus(t, group, value) (unknown values print as-is). Foundation-owned; mirror in ar/status.ts.
export const status = {
  tenant: {
    trial: 'trial',
    active: 'active',
    past_due: 'past_due',
    read_only: 'read_only',
    suspended: 'suspended',
    cancelled: 'cancelled',
  },
  subscription: { trialing: 'trialing', active: 'active', past_due: 'past_due', cancelled: 'cancelled' },
  invoice: { draft: 'draft', issued: 'issued', paid: 'paid', void: 'void' },
  application: { pending: 'pending', approved: 'accepted', rejected: 'rejected' },
  enquiry: { new: 'New', contacted: 'Contacted', closed: 'Closed' },
  domain: { pending: 'pending', verifying: 'verifying', active: 'active', failed: 'failed' },
  domainOrder: {
    requested: 'requested',
    purchasing: 'purchasing',
    purchased: 'purchased',
    failed: 'failed',
    rejected: 'rejected',
    cancelled: 'cancelled',
  },
  /** Worker job runs (backup, restore drill, heartbeat). */
  job: { ok: 'ok', failed: 'failed', skipped: 'skipped', error: 'error' },
  severity: { info: 'info', warning: 'warning', critical: 'critical' },
} as const
