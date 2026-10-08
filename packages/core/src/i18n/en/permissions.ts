// `permissions` namespace: the role editor's permission catalogue (packages/core/src/permissions.ts, same English) and
// system-role descriptions. Role *names* live in `role.*`. Helpers: permissionLabel / permissionGroupLabel /
// roleName / roleDescription (i18n/labels.ts). Custom role names are typed by the spa — never translated.
export const permissions = {
  groups: {
    dashboard: { label: 'Dashboard', actions: { view: 'View dashboard', revenue: 'See revenue figures' } },
    calendar: {
      label: 'Calendar & bookings',
      actions: {
        view: 'View calendar',
        manage: 'Create and edit bookings',
        commission: 'Enter therapist commission',
      },
    },
    clients: {
      label: 'Clients',
      actions: {
        view: 'View clients',
        manage: 'Edit clients',
        phone: 'See phone numbers',
        export: 'Export clients',
        merge: 'Merge duplicate clients',
      },
    },
    pos: {
      label: 'Point of sale',
      actions: { use: 'Take payments', refund: 'Refunds and voids', close: 'Daily close' },
    },
    services: { label: 'Services & rooms', actions: { manage: 'Manage services, rooms and resources' } },
    staff: { label: 'Staff', actions: { view: 'View staff', manage: 'Manage staff, shifts and pay' } },
    inventory: {
      label: 'Inventory',
      actions: {
        manage: 'Manage stock and the warehouse',
        adjust: 'Restock and adjust stock counts',
        purchase: 'Record purchases',
      },
    },
    marketing: {
      label: 'WhatsApp & marketing',
      actions: { send: 'Send WhatsApp messages', campaigns: 'Create campaigns' },
    },
    site: {
      label: 'Website',
      actions: { content: 'Edit text and images', design: 'Edit design and layout', publish: 'Publish' },
    },
    reports: { label: 'Reports & analytics', actions: { view: 'View reports' } },
    accounting: {
      label: 'Accounting',
      actions: { view: 'View accounts', manage: 'Record expenses and close periods' },
    },
    ai: { label: 'AI agents', actions: { approve: 'Approve AI drafts', manage: 'Configure agents' } },
    team: { label: 'Team & roles', actions: { manage: 'Invite members and edit roles' } },
    settings: { label: 'Business settings', actions: { manage: 'Edit business details and branches' } },
    billing: { label: 'Subscription', actions: { view: 'View invoices and payments' } },
    audit: { label: 'Audit log', actions: { view: 'View the audit log' } },
  },
  roleDescription: {
    owner: 'Full access, including subscription and roles.',
    manager: 'Runs the spa day to day. Everything except the subscription.',
    receptionist: 'Bookings, walk-ins, payments, clients and WhatsApp.',
    therapist: 'Own schedule, check-in/out and earnings. Never sees client phone numbers.',
    accountant: 'Accounts, reports and daily closes.',
    content_editor: 'Edits website text and images only.',
  },
} as const
