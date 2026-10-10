// Console page group "tenants" (R22, EN source): Console → Spas (app/platform/(console)/tenants/**).
// Owned by that group's conversion — only it edits this file and ar/tenants.ts (mirror every key there).
// Keys: one namespace per page (registered in console/en.ts already); `domainErrors` = the services' DomainError
// texts these pages show, copied exactly from en/domain.ts under the same id (merged into `errors.domain`).
// Recipe, key naming and the glossary: docs/design/console-i18n.md.
export const tenants = {
  title: 'Spas',
  description: 'Subscriptions, usage and access for every tenant. Whole-spa totals only — no client data.',
} as const

export const domainErrors = {} as const
