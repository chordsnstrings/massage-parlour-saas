// Thai catalogue — mirrors en.ts (typed as Messages: a missing or extra key fails typecheck).
// Written to read naturally for spa staff; a native Thai speaker should review it before launch (docs/PLAN.md §14.6).
// Glossary (crm-spec §6.1): therapist = พนักงานนวด, treatment = ทรีตเมนต์, booking = การจอง; money stays "AED".
// Aggregator only: keys live in th/<ns>.ts (one file per namespace, same names as en/).

import { account } from './th/account'
import { accounts } from './th/accounts'
import { ai } from './th/ai'
import { analytics } from './th/analytics'
import { auth } from './th/auth'
import { billing } from './th/billing'
import { bookings } from './th/bookings'
import { calendar } from './th/calendar'
import { campaigns } from './th/campaigns'
import { clients } from './th/clients'
import { common } from './th/common'
import { documents } from './th/documents'
import { domain } from './th/domain'
import { enums } from './th/enums'
import { errors } from './th/errors'
import { inbox } from './th/inbox'
import { inventory } from './th/inventory'
import { logo } from './th/logo'
import { marketing } from './th/marketing'
import { media } from './th/media'
import { messages } from './th/messages'
import { nav } from './th/nav'
import { overview } from './th/overview'
import { packages } from './th/packages'
import { payroll } from './th/payroll'
import { permissions } from './th/permissions'
import { reviews } from './th/reviews'
import { role } from './th/role'
import { roles } from './th/roles'
import { sales } from './th/sales'
import { services } from './th/services'
import { settings } from './th/settings'
import { shell } from './th/shell'
import { staff } from './th/staff'
import { team } from './th/team'
import { ui } from './th/ui'
import { validation } from './th/validation'
import { website } from './th/website'
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
  sales,
  services,
  packages,
  inventory,
  team,
  staff,
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
  settings,
  account,
  auth,
  enums,
  permissions,
}
