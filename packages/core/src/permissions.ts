/** Permission catalog (ULM). Keys are `resource.action`; labels drive the role editor UI. */
export const PERMISSION_GROUPS = {
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
    },
  },
  pos: {
    label: 'Point of sale',
    actions: { use: 'Take payments', refund: 'Refunds and voids', close: 'Daily close' },
  },
  services: { label: 'Services & rooms', actions: { manage: 'Manage services, rooms and resources' } },
  staff: { label: 'Staff', actions: { view: 'View staff', manage: 'Manage staff, shifts and pay' } },
  timeclock: {
    label: 'Time clock & leave',
    actions: {
      kiosk: 'Open the clock-in kiosk',
      leave: 'Request leave for yourself',
      approve: 'Approve leave and fix clock times',
    },
  },
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
} as const

type Groups = typeof PERMISSION_GROUPS
export type Permission = {
  [R in keyof Groups]: `${R & string}.${keyof Groups[R]['actions'] & string}`
}[keyof Groups]

export const ALL_PERMISSIONS = Object.entries(PERMISSION_GROUPS).flatMap(([resource, group]) =>
  Object.keys(group.actions).map((action) => `${resource}.${action}` as Permission),
)

export const isPermission = (value: string): value is Permission =>
  (ALL_PERMISSIONS as string[]).includes(value)

export type SystemRoleKey =
  | 'owner'
  | 'manager'
  | 'receptionist'
  | 'therapist'
  | 'accountant'
  | 'content_editor'

/** System roles resolve permissions from code (so new permissions reach them); custom roles use the DB list. */
export const SYSTEM_ROLES: Record<
  SystemRoleKey,
  { name: string; description: string; permissions: readonly Permission[] }
> = {
  owner: {
    name: 'Owner',
    description: 'Full access, including subscription and roles.',
    permissions: ALL_PERMISSIONS,
  },
  manager: {
    name: 'Manager',
    description: 'Runs the spa day to day. Everything except the subscription.',
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'billing.view'),
  },
  receptionist: {
    name: 'Receptionist',
    description: 'Bookings, walk-ins, payments, clients and WhatsApp.',
    permissions: [
      'dashboard.view',
      'calendar.view',
      'calendar.manage',
      'calendar.commission',
      'clients.view',
      'clients.manage',
      'clients.phone',
      'pos.use',
      'pos.close',
      'staff.view',
      'timeclock.kiosk',
      'timeclock.leave',
      'inventory.adjust',
      'marketing.send',
      'ai.approve',
    ],
  },
  therapist: {
    name: 'Therapist',
    description: 'Own schedule, check-in/out and earnings. Never sees client phone numbers.',
    permissions: ['calendar.view', 'timeclock.leave'],
  },
  accountant: {
    name: 'Accountant',
    description: 'Accounts, reports and daily closes.',
    permissions: [
      'dashboard.view',
      'dashboard.revenue',
      'reports.view',
      'accounting.view',
      'accounting.manage',
      'inventory.adjust',
      'inventory.purchase',
    ],
  },
  content_editor: {
    name: 'Content editor',
    description: 'Edits website text and images only.',
    permissions: ['site.content'],
  },
}

export const isSystemRole = (key: string): key is SystemRoleKey => key in SYSTEM_ROLES

export function resolvePermissions(role: { key: string; permissions: readonly string[] }): Set<Permission> {
  const list = isSystemRole(role.key)
    ? SYSTEM_ROLES[role.key].permissions
    : role.permissions.filter(isPermission)
  return new Set(list)
}
