// Feature flags (F20, PLAN §17). Boolean switches the super-admin sets in the console (Feature flags): a global
// default plus per-spa overrides. Code reads only the keys declared here, through the typed `flag()` helpers
// (web `server/flags.ts`, services `feature-flags.ts`); the console may also define keys ahead of the code.

export type FlagDef = {
  /** Console description. */
  description: string
  /** Value while the console has no row for the key (and the default the console suggests). */
  fallback: boolean
}

export const FEATURE_FLAGS = {
  /**
   * F22: automatic billing transitions (overdue → grace → read-only). Default on; a per-spa "off" override is the
   * console's "Pause automatic billing transitions" for that spa; the default off pauses them for every spa.
   */
  'billing.autoTransitions': {
    description:
      'Automatic billing transitions for unpaid platform invoices (overdue → grace → read-only). Off for a spa = paused.',
    fallback: true,
  },
} as const satisfies Record<string, FlagDef>

export type FlagKey = keyof typeof FEATURE_FLAGS

export const isFlagKey = (key: string): key is FlagKey => Object.hasOwn(FEATURE_FLAGS, key)

/** Keys: lower-case dotted/camel segments, e.g. `billing.autoTransitions`, `calendar.newDayView`. */
export const FLAG_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){0,3}$/

/** Value of a flag for one spa: the spa's override, else the console default, else the code fallback. */
export function resolveFlag(
  key: string,
  row: { defaultOn: boolean } | null | undefined,
  override: boolean | null | undefined,
): boolean {
  if (typeof override === 'boolean') return override
  if (row) return row.defaultOn
  return isFlagKey(key) ? FEATURE_FLAGS[key].fallback : false
}
