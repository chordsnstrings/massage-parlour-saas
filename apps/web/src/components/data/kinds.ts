import type { Permission } from '@spa/core'
import type { ImportKind } from '@spa/services'

/** Permission needed to import each kind (and to download its template / past error lists). */
export const IMPORT_PERMISSION: Record<ImportKind, Permission> = {
  clients: 'clients.manage',
  menu: 'services.manage',
  products: 'inventory.manage',
}
