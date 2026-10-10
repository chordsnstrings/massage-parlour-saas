// Console page group "settings-plans-flags-domains" (R22, EN source): Console → Company (settings/**), Plans & prices, Feature flags, Domains (plans/**, flags/**, domains/**).
// Owned by that group's conversion — only it edits this file and ar/settings-plans-flags-domains.ts (mirror every key there).
// Keys: one namespace per page (registered in console/en.ts already); `domainErrors` = the services' DomainError
// texts these pages show, copied exactly from en/domain.ts under the same id (merged into `errors.domain`).
// Recipe, key naming and the glossary: docs/design/console-i18n.md.
/** Console → Company (route /settings; the spa catalogue owns `settings`). */
export const company = {
  title: 'Company',
  description:
    'Your operating company — shown on invoices, the billing page and in Meta/Google applications.',
} as const

export const plans = {
  title: 'Plans & prices',
  description:
    'Prices apply to new spas. Existing spas keep their agreed price until you change their subscription.',
} as const

export const flags = {
  title: 'Feature flags',
  description:
    'On/off switches for features: one default for every spa, plus per-spa overrides. Changes apply on the next page load and are audited.',
} as const

export const domains = {
  title: 'Domains',
} as const

export const domainErrors = {} as const
