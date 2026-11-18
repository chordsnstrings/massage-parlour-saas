import { sql } from 'drizzle-orm'
import { pgPolicy, pgRole } from 'drizzle-orm/pg-core'

/** Runtime role for tenant data; restricted by RLS to `app.tenant_id`. */
export const appRole = pgRole('spa_app').existing()
/** Runtime role for platform code (auth, super-admin, host lookup); sees all rows. */
export const platformRole = pgRole('spa_platform').existing()

/** Tenant id of the current transaction, set by `withTenant()`; NULL when unset. */
export const currentTenantId = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`

const platformAll = () =>
  pgPolicy('platform_all', { for: 'all', to: platformRole, using: sql`true`, withCheck: sql`true` })

/** Policies for tables that carry `tenant_id`. */
export const tenantPolicies = () => [
  pgPolicy('tenant_isolation', {
    for: 'all',
    to: appRole,
    using: sql`tenant_id = ${currentTenantId}`,
    withCheck: sql`tenant_id = ${currentTenantId}`,
  }),
  platformAll(),
]

/** Policies for platform-only tables: invisible to `spa_app`. */
export const platformPolicies = () => [platformAll()]
