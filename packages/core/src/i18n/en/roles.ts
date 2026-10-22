// `roles` namespace (EN source). Only the roles screens edit this file; mirror every key in th/roles.ts.
export const roles = {
  title: 'Roles',
  back: 'Team',
  description: 'Six ready-made roles, plus your own custom roles.',
  system: 'System',
  custom: 'Custom',
  permissionsCount: { one: '{count} permission', other: '{count} permissions' },
  sheet: {
    new: 'New role',
    fixed: 'System roles are fixed. Create a custom role to adjust access.',
    choose: 'Choose exactly what this role can do.',
    view: 'View',
    name: 'Name',
    description: 'Description',
    save: 'Save role',
  },
  result: {
    saved: 'Role saved',
    deleted: 'Role deleted',
    notFound: 'Role not found.',
    phoneRestricted: 'Client phone numbers are only for the owner, managers and receptionists.',
    systemLocked: 'System roles can’t be edited — create a custom role instead.',
    duplicate: 'A role with this name already exists.',
    onlyCustom: 'Only custom roles can be deleted.',
    inUse: 'Move people off this role first.',
  },
  validation: { name: 'Name the role' },
} as const
