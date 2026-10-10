// `errors` namespace (EN source) of the console. Shared paths: shared server helpers answer with these spa keys
// (fail('errors.forbidden'), fromZod → 'errors.checkFields', failDomain → 'errors.domain.*'), so the English is
// the spa catalogue's (en/errors.ts, en/domain.ts), identical — the catalogue test enforces it.
// `domain` = the services' DomainError texts the console shows: one fragment per page-group file (merged here, so
// each group adds its own without touching this file). Foundation-owned; mirror every key in ar/errors.ts.
import { domain as spaDomain } from '../../en/domain'
import { errors as spa } from '../../en/errors'
import { domainErrors as actions } from './actions'
import { domainErrors as aiPerformanceAudit } from './ai-performance-audit'
import { domainErrors as applicationsEnquiriesAnnouncements } from './applications-enquiries-announcements'
import { domainErrors as settingsPlansFlagsDomains } from './settings-plans-flags-domains'
import { domainErrors as templatesWebsites } from './templates-websites'
import { domainErrors as tenants } from './tenants'

export const errors = {
  generic: spa.generic,
  forbidden: spa.forbidden,
  checkFields: spa.checkFields,
  notFound: spa.notFound,
  signInAgain: spa.signInAgain,
  file: spa.file,
  domain: {
    adminJoinRefused: spaDomain.adminJoinRefused,
    ...tenants,
    ...templatesWebsites,
    ...aiPerformanceAudit,
    ...applicationsEnquiriesAnnouncements,
    ...settingsPlansFlagsDomains,
    ...actions,
  },
} as const
