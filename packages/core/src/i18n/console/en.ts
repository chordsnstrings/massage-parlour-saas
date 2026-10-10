// English source catalogue of the super-admin console (R22, docs/design/console-i18n.md). Separate from the spa
// dashboard catalogue (../en.ts, EN + TH): the console speaks EN + AR.
// Namespaces: page namespaces never reuse a spa namespace name (so an ok()/fail() key is never ambiguous); the
// shared ones — ui, auth, errors, validation, common — mirror spa paths with identical English, because shared code
// (UI kit, auth forms, lib/action helpers) reads them with spa keys. Both rules are enforced by the catalogue test.
// Aggregator only: keys live in en/<file>.ts (mirrored by ar/<file>.ts); page groups edit only their own file pair.
import { ui } from '../en-ui'
import { actions } from './en/actions'
import { aiModels, auditLog, performance } from './en/ai-performance-audit'
import { announcements, applications, contactEnquiries } from './en/applications-enquiries-announcements'
import { auth } from './en/auth'
import { chrome } from './en/chrome'
import { common } from './en/common'
import { errors } from './en/errors'
import { home } from './en/home'
import { company, domains, flags, plans } from './en/settings-plans-flags-domains'
import { status } from './en/status'
import { templates, websites } from './en/templates-websites'
import { tenants } from './en/tenants'
import { validation } from './en/validation'

export const consoleEn = {
  // Shared with the spa catalogue (same paths, same English).
  ui,
  auth,
  errors,
  validation,
  common,
  // Console only.
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
} as const
