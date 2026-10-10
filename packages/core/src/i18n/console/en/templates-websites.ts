// Console page group "templates-websites" (R22, EN source): Console → Site templates + Websites (templates/**, websites/**).
// Owned by that group's conversion — only it edits this file and ar/templates-websites.ts (mirror every key there).
// Keys: one namespace per page (registered in console/en.ts already); `domainErrors` = the services' DomainError
// texts these pages show, copied exactly from en/domain.ts under the same id (merged into `errors.domain`).
// Recipe, key naming and the glossary: docs/design/console-i18n.md.
export const templates = {
  title: 'Site templates',
  description:
    'Templates spas can pick next to the 8 built-ins. A studio template with a built-in key replaces it.',
} as const

export const websites = {
  title: 'Websites',
  description:
    "Every spa's site is built here as a bespoke service. Open a studio to design, then send it for review.",
} as const

export const domainErrors = {} as const
