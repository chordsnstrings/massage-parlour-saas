// Plan entitlements for the web app (PLAN §18.8). Rules: @spa/core plans.ts; lookup: @spa/services entitlements.ts.
// A super-admin impersonating a spa gets the spa's entitlements (gating is the spa's, not the viewer's).
import type { Feature } from '@spa/core'
import type { MessageKey, MessageRef } from '@spa/core/i18n'
import { platformDb } from '@spa/db'
import { tenantEntitlements } from '@spa/services'
import { cache } from 'react'

/** The spa's effective entitlements (plan + super-admin override), once per request. Plans are platform data. */
export const getEntitlements = cache((tenantId: string) => tenantEntitlements(platformDb(), tenantId))

export const hasFeature = async (tenantId: string, feature: Feature) =>
  (await getEntitlements(tenantId)).features.includes(feature)

/** "{feature} is available on the Premium plan." as a catalogue ref (rendered in the viewer's language). */
export const featureRef = (feature: Feature): MessageRef => ({
  key: 'errors.domain.featureNotInPlan',
  params: { feature: { key: `plan.feature.${feature}.name` as MessageKey } },
})
