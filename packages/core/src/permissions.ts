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
      'inventory.adjust',
      'marketing.send',
      'ai.approve',
    ],
  },
  therapist: {
    name: 'Therapist',
    description: 'Own schedule, check-in/out and earnings. Never sees client phone numbers.',
    permissions: ['calendar.view'],
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

/** Per-tenant tweaks of system roles (`tenants.settings.roleOverrides`); the owner role is never changed. */
export type RoleOverrides = Record<string, { grant?: readonly string[]; revoke?: readonly string[] }>

export function resolvePermissions(
  role: { key: string; permissions: readonly string[] },
  overrides?: RoleOverrides | null,
): Set<Permission> {
  if (!isSystemRole(role.key)) return new Set(role.permissions.filter(isPermission))
  const set = new Set<Permission>(SYSTEM_ROLES[role.key].permissions)
  const o = role.key === 'owner' ? undefined : overrides?.[role.key]
  for (const p of o?.grant ?? []) if (isPermission(p)) set.add(p)
  for (const p of o?.revoke ?? []) if (isPermission(p)) set.delete(p)
  return set
}

/** "Mask client phones for therapists" (Settings → Security): on unless the tenant grants therapists `clients.phone`. */
export const therapistPhonesMasked = (overrides?: RoleOverrides | null) =>
  !overrides?.therapist?.grant?.includes('clients.phone')

/** Overrides with the therapist phone toggle applied (other entries kept). */
export function withTherapistPhones(
  overrides: RoleOverrides | null | undefined,
  masked: boolean,
): RoleOverrides {
  const next: RoleOverrides = { ...(overrides ?? {}) }
  const cur = next.therapist ?? {}
  const grant = (cur.grant ?? []).filter((p) => p !== 'clients.phone')
  next.therapist = { ...cur, grant: masked ? grant : [...grant, 'clients.phone'] }
  return next
}

/** Roles that must use TOTP 2FA when the tenant turns on "Require 2FA for owner & managers". */
export const TWO_FACTOR_POLICY_ROLES: readonly string[] = ['owner', 'manager']
