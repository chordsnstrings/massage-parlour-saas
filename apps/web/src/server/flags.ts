// F20 feature flags for server code (rules: @spa/core flags.ts; console → Feature flags). Flags are platform data,
// read on the platform role like plans (server/entitlements.ts). Add a key to FEATURE_FLAGS before reading it.
import type { FlagKey } from '@spa/core'
import { platformDb } from '@spa/db'
import { flagOn } from '@spa/services'
import { cache } from 'react'

/** The flag's value for one spa (its override, else the console default, else the code fallback), once per request. */
export const flag = cache((key: FlagKey, tenantId: string) => flagOn(platformDb(), key, tenantId))
