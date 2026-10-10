// Thai catalogue — mirrors en.ts (typed as Messages: a missing or extra key fails typecheck).
// Written to read naturally for spa staff; a native Thai speaker should review it before launch (docs/PLAN.md §14.6).
// Glossary (crm-spec §6.1): therapist = พนักงานนวด, treatment = ทรีตเมนต์, booking = การจอง; money stays "AED".
// Aggregator only: keys live in th/<ns>.ts (one file per namespace, same names as en/).

import { account } from './th/account'
import { accounts } from './th/accounts'
import { ai } from './th/ai'
import { analytics } from './th/analytics'
import { audit } from './th/audit'
import { auth } from './th/auth'
import { automations } from './th/automations'
import { billing } from './th/billing'
import { bookings } from './th/bookings'
import { calendar } from './th/calendar'
import { campaigns } from './th/campaigns'
import { clients } from './th/clients'
import { clientsMerge } from './th/clientsMerge'
import { common } from './th/common'
import { documents } from './th/documents'
import { domain } from './th/domain'
import { enums } from './th/enums'
import { equipment } from './th/equipment'
import { errors } from './th/errors'
import { growth } from './th/growth'
import { inbox } from './th/inbox'
import { inventory } from './th/inventory'
import { logo } from './th/logo'
import { marketing } from './th/marketing'
import { media } from './th/media'
import { messages } from './th/messages'
import { nav } from './th/nav'
import { notifications } from './th/notifications'
import { overview } from './th/overview'
import { packages } from './th/packages'
import { payroll } from './th/payroll'
import { permissions } from './th/permissions'
import { plan } from './th/plan'
import { purchases } from './th/purchases'
import { pwa } from './th/pwa'
import { reports } from './th/reports'
import { reviews } from './th/reviews'
import { role } from './th/role'
import { roles } from './th/roles'
import { sales } from './th/sales'
import { search } from './th/search'
import { services } from './th/services'
import { settings } from './th/settings'
import { sheets } from './th/sheets'
import { shell } from './th/shell'
import { staff } from './th/staff'
import { team } from './th/team'
import { timeclock } from './th/timeclock'
import { ui } from './th/ui'
import { validation } from './th/validation'
import { waitlist } from './th/waitlist'
import { warehouse } from './th/warehouse'
import { website } from './th/website'
import { widget } from './th/widget'
import type { Messages } from './types'

export const th: Messages = {
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
  growth,
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
  reports,
  reviews,
  website,
  widget,
  pwa,
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
  plan,
  notifications,
  search,
  audit,
}
