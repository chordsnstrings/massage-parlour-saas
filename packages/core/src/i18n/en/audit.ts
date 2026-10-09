// `audit` namespace (EN source): the owner-facing audit log (Settings → Security card + /settings/audit) and the
// Security policy toggle (require 2FA). Mirror every key in th/audit.ts.
// Action codes (e.g. `settings.updated`) are system identifiers and are shown as stored.
export const audit = {
  title: 'Audit log',
  description: 'Who changed what in your spa, newest first. Read-only.',
  tab: 'Audit log',
  recent: 'Recent activity',
  viewAll: 'View full audit log',
  none: 'No activity recorded yet.',
  filter: {
    label: 'Filter the audit log',
    actor: 'Person',
    action: 'Action',
    from: 'From',
    to: 'To',
    everyone: 'Everyone',
    allActions: 'All actions',
    apply: 'Apply',
    reset: 'Reset',
  },
  col: { when: 'When', actor: 'Person', action: 'Action', record: 'Record', ip: 'IP address' },
  actor: {
    system: 'System',
    unknown: 'Former user',
    support: '{name} · platform support',
  },
  empty: { title: 'No entries', body: 'Nothing in the audit log matches these filters.' },
  pager: { label: 'Audit log pages', page: 'Page {page} of {pages}', prev: 'Previous', next: 'Next' },
  count: { one: '{count} entry', other: '{count} entries' },
  security: {
    require2fa: 'Require 2FA for owner & managers',
    require2faSub:
      'Owners and managers without an authenticator app must set one up before opening the dashboard.',
    require2faOwn: 'Turn on two-step verification for your own account first.',
    save: 'Save security',
    saved: 'Security settings saved',
    required:
      'Your spa requires two-step verification for your role. Set it up below, then open the dashboard again.',
    backToSpa: 'Back to the spa',
  },
}
