// English source catalogue for the spa dashboard (docs/PLAN.md §14.6, docs/design/crm-spec.md §6).
// Rules: UI/system text only — names people type (clients, staff, services, products, rooms…) are never translated.
// Placeholders are `{name}`; plurals are `{ one, other }` objects chosen on `count`.
// Aggregator only: keys live in one file per namespace (`en/<ns>.ts`, mirrored by `th/<ns>.ts`). Screen work edits
// its own namespace files and never this file (docs/design/phase2-kit.md). `errors.domain` = en/domain.ts.

import { account } from './en/account'
import { accounts } from './en/accounts'
import { ai } from './en/ai'
import { analytics } from './en/analytics'
import { audit } from './en/audit'
import { auth } from './en/auth'
import { automations } from './en/automations'
import { billing } from './en/billing'
import { bookings } from './en/bookings'
import { calendar } from './en/calendar'
import { campaigns } from './en/campaigns'
import { clients } from './en/clients'
import { clientsMerge } from './en/clientsMerge'
import { common } from './en/common'
import { documents } from './en/documents'
import { domain } from './en/domain'
import { enums } from './en/enums'
import { equipment } from './en/equipment'
import { errors } from './en/errors'
import { inbox } from './en/inbox'
import { inventory } from './en/inventory'
import { logo } from './en/logo'
import { marketing } from './en/marketing'
import { media } from './en/media'
import { messages } from './en/messages'
import { nav } from './en/nav'
import { notifications } from './en/notifications'
import { overview } from './en/overview'
import { packages } from './en/packages'
import { payroll } from './en/payroll'
import { permissions } from './en/permissions'
import { purchases } from './en/purchases'
import { reviews } from './en/reviews'
import { role } from './en/role'
import { roles } from './en/roles'
import { sales } from './en/sales'
import { search } from './en/search'
import { services } from './en/services'
import { settings } from './en/settings'
import { sheets } from './en/sheets'
import { shell } from './en/shell'
import { staff } from './en/staff'
import { team } from './en/team'
import { timeclock } from './en/timeclock'
import { validation } from './en/validation'
import { waitlist } from './en/waitlist'
import { warehouse } from './en/warehouse'
import { website } from './en/website'
import { ui } from './en-ui'

export const en = {
  ui,
  common,
  shell,
  nav,
  role,
  errors: { ...errors, domain },
  validation,
  logo,
  overview,
  calendar,
  bookings,
  clients,
  clientsMerge,
  sales,
  services,
  equipment,
  packages,
  inventory,
  purchases,
  warehouse,
  waitlist,
  team,
  staff,
  timeclock,
  documents,
  roles,
  inbox,
  messages,
  campaigns,
  marketing,
  ai,
  analytics,
  reviews,
  website,
  media,
  accounts,
  payroll,
  billing,
  automations,
  settings,
  sheets,
  account,
  auth,
  enums,
  permissions,
  notifications,
  search,
  audit,
} as const
