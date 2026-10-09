// Typed label helpers for enum values, permissions and roles. Client-safe (no catalogue import): pass the `t` from
// getT()/getI18n() (server) or useT() (client). Unknown values fall back to the raw value / given name.
import type { Permission, SystemRoleKey } from '../permissions'
import type { en } from './en'
import type { Translator } from './translate'
import type { MessageKey } from './types'

type Enums = (typeof en)['enums']
export type EnumName = keyof Enums
export type EnumValue<E extends EnumName> = keyof Enums[E] & string

/** `enumLabel(t, 'bookingStatus', b.status)` → "Checked in" / "เช็กอินแล้ว"; unknown values print as-is. */
export function enumLabel<E extends EnumName>(
  t: Translator,
  name: E,
  value: EnumValue<E> | (string & {}) | null | undefined,
) {
  if (value == null || value === '') return ''
  return t.maybe(`enums.${name}.${value}`) ?? String(value)
}

/** F13: "Online · Instagram" for an online booking with a recorded website source, else just the channel. */
export function bookingSourceLabel(t: Translator, source: string, attribution?: string | null) {
  const channel = enumLabel(t, 'bookingSource', source)
  return attribution ? `${channel} · ${enumLabel(t, 'bookingAttribution', attribution)}` : channel
}

/** `permissionLabel(t, 'clients.phone')` → "See phone numbers". */
export const permissionLabel = (t: Translator, permission: Permission | string) => {
  const [group, action] = permission.split('.')
  return t.maybe(`permissions.groups.${group}.actions.${action}`) ?? permission
}

/** `permissionGroupLabel(t, 'pos')` → "Point of sale". */
export const permissionGroupLabel = (t: Translator, group: string) =>
  t.maybe(`permissions.groups.${group}.label`) ?? group

const SYSTEM = ['owner', 'manager', 'receptionist', 'therapist', 'accountant', 'content_editor']
const isSystem = (key: string | null | undefined): key is SystemRoleKey => !!key && SYSTEM.includes(key)

/** System roles are translated; custom roles keep the name the spa typed. */
export const roleName = (t: Translator, role: { key?: string | null; name: string }) =>
  isSystem(role.key) ? t(`role.${role.key}` as MessageKey) : role.name

export const roleDescription = (t: Translator, role: { key?: string | null; description?: string | null }) =>
  isSystem(role.key) ? t(`permissions.roleDescription.${role.key}` as MessageKey) : (role.description ?? '')
