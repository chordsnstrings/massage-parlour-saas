// Automations page (crm-spec §5 item 14, PLAN §14.7 B3). Item keys = AUTOMATIONS / LOCKED_AUTOMATIONS in @spa/core.
export const automations = {
  title: 'Automations',
  description:
    'Switch the background work on or off for your spa. Messages are only queued — your team still sends each one on WhatsApp.',
  listTitle: 'Runs on its own',
  active: { one: '{count} active', other: '{count} active' },
  alwaysOn: 'Always on',
  lockedHint: 'Run by the platform for every spa',
  items: {
    bookingMessages: {
      name: 'Booking confirmations & reminders',
      desc: 'Queues a WhatsApp confirmation when a booking is confirmed, plus reminders the day before and 2 hours before',
      schedule: 'On every booking',
    },
    thankYou: {
      name: 'Thank-you & review requests',
      desc: 'Queues a thank-you message after checkout',
      schedule: 'After checkout',
    },
    slotFiller: {
      name: 'Quiet-slot offers',
      desc: 'Queues offers for quiet hours to regular clients (AI studio slot filler)',
      schedule: '10:30 · 15:30',
    },
    packageExpiry: {
      name: 'Package expiry',
      desc: 'Closes packages past their validity and books the unused value',
      schedule: 'Nightly',
    },
    membershipRenewals: {
      name: 'Membership renewals',
      desc: 'Marks memberships ending within 7 days as due, queues a WhatsApp renewal reminder and closes ended periods',
      schedule: 'Nightly',
    },
    instagram: {
      name: 'Instagram posts',
      desc: 'Publishes approved posts at their scheduled time',
      schedule: 'Every 5 min',
    },
    googleReviews: {
      name: 'Google reviews sync',
      desc: 'Pulls new Google reviews and drafts replies',
      schedule: 'Every 2 h',
    },
    weeklyInsights: {
      name: 'Weekly insights',
      desc: 'AI summary of last week with two things to try',
      schedule: 'Mondays 08:00',
    },
    dailyDigest: {
      name: 'Morning digest',
      desc: "Notifies managers of today's bookings and requests still waiting",
      schedule: 'Daily 09:30',
    },
    documentAlerts: {
      name: 'Document expiry alerts',
      desc: 'Notifies managers 60, 30 and 7 days before staff documents expire',
      schedule: 'Daily 09:00',
    },
    outboxAutoAssign: {
      name: 'Assign WhatsApp messages',
      desc: 'Shares due WhatsApp messages round-robin between receptionists on shift now (off: everyone picks from the queue)',
      schedule: 'Every minute',
    },
    backups: { name: 'Nightly backups', desc: 'Encrypted database backup', schedule: 'Nightly' },
    domains: {
      name: 'Domains & SSL',
      desc: 'Checks custom domains and certificates',
      schedule: 'Every 10 min',
    },
  },
  toggle: '{name}: on or off',
  switchedOn: '{name} switched on',
  switchedOff: '{name} switched off',
  log: {
    title: 'Last 24 hours',
    time: 'Time',
    event: 'Event',
    status: 'Status',
    empty: 'Nothing has run for your spa in the last 24 hours.',
    note: 'Only runs that touched your spa are listed. Switched-off automations are skipped.',
    statuses: { ok: 'Done', skipped: 'Nothing to do', failed: 'Failed' },
    count: { one: '{count} item', other: '{count} items' },
  },
  errors: { unknown: 'Unknown automation.' },
} as const
