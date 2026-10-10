// Arabic catalogue of the super-admin console (R22) — mirrors en.ts (typed as ConsoleMessages: a missing or extra
// key fails typecheck; the catalogue test also rejects empty strings and placeholder drift).
// Modern Standard Arabic for a UAE business owner; Western digits; glossary in docs/design/console-i18n.md. To be
// reviewed by the owner's native team before launch. Aggregator only: keys live in ar/<file>.ts.
import { actions } from './ar/actions'
import { aiModels, auditLog, performance } from './ar/ai-performance-audit'
import { announcements, applications, contactEnquiries } from './ar/applications-enquiries-announcements'
import { auth } from './ar/auth'
import { chrome } from './ar/chrome'
import { common } from './ar/common'
import { errors } from './ar/errors'
import { home } from './ar/home'
import { company, domains, flags, plans } from './ar/settings-plans-flags-domains'
import { status } from './ar/status'
import { templates, websites } from './ar/templates-websites'
import { tenants } from './ar/tenants'
import { ui } from './ar/ui'
import { validation } from './ar/validation'
import type { ConsoleMessages } from './types'

export const consoleAr: ConsoleMessages = {
  ui,
  auth,
  errors,
  validation,
  common,
  chrome,
  status,
  home,
  tenants,
  templates,
  websites,
  aiModels,
  performance,
  auditLog,
  applications,
  contactEnquiries,
  announcements,
  company,
  plans,
  flags,
  domains,
  actions,
}
