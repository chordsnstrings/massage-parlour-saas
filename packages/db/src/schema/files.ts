import { boolean, customType, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createdAt, id } from './_columns'
import { tenantPolicies } from './_rls'
import { user } from './auth'
import { tenants } from './platform'

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' })

/**
 * Uploaded files (images, receipts, documents). Bytes live here unless S3-compatible storage is configured,
 * in which case `storage = 's3'` and `object_key` points at the bucket object.
 */
export const storedFiles = pgTable(
  'stored_files',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** 'db' | 's3' */
    storage: text('storage').notNull().default('db'),
    objectKey: text('object_key'),
    bytes: bytea('bytes'),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    filename: text('filename'),
    /** Public files (site images) are served without auth at /files/{id}; private ones need a member session. */
    isPublic: boolean('is_public').notNull().default(false),
    /** What the file belongs to, e.g. 'media', 'receipt', 'staff_document'. */
    purpose: text('purpose').notNull().default('media'),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index('stored_files_tenant').on(t.tenantId, t.purpose), ...tenantPolicies()],
)
