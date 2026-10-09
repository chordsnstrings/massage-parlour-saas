import { PLATFORM_CONTACT_EMAIL } from '@spa/core'
import { plans, platformDb, platformSettings } from '@spa/db'
import { asc, eq } from 'drizzle-orm'
import { cache } from 'react'

/** Live plans for the marketing pages (prices are edited in the super-admin). */
export async function activePlans() {
  try {
    return await platformDb().select().from(plans).where(eq(plans.active, true)).orderBy(asc(plans.sort))
  } catch {
    return [] // e.g. image build without a database; regenerated at runtime
  }
}

/** Shown on the contact page and in the footer when no contact email is set in the super-admin. */
export const DEFAULT_CONTACT_EMAIL = PLATFORM_CONTACT_EMAIL

/** The operator's public contact details (super-admin → Settings); one read per request (page + footer). */
export const companyContact = cache(async () => {
  try {
    const [s] = await platformDb().select().from(platformSettings).limit(1)
    return s ?? null
  } catch {
    return null
  }
})
