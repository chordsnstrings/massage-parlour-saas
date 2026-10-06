import { plans, platformDb, platformSettings } from '@spa/db'
import { asc, eq } from 'drizzle-orm'

/** Live plans for the marketing pages (prices are edited in the super-admin). */
export async function activePlans() {
  try {
    return await platformDb().select().from(plans).where(eq(plans.active, true)).orderBy(asc(plans.sort))
  } catch {
    return [] // e.g. image build without a database; regenerated at runtime
  }
}

/** The operator's public contact details (super-admin → Settings). */
export async function companyContact() {
  try {
    const [s] = await platformDb().select().from(platformSettings).limit(1)
    return s ?? null
  } catch {
    return null
  }
}
