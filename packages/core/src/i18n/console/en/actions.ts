// Console page group "actions" (R22, EN source): the shared console server actions (app/platform/(console)/actions.ts + billing-actions.ts).
// Owned by that group's conversion — only it edits this file and ar/actions.ts (mirror every key there).
// Keys: one namespace per page (registered in console/en.ts already); `domainErrors` = the services' DomainError
// texts these pages show, copied exactly from en/domain.ts under the same id (merged into `errors.domain`).
// Recipe, key naming and the glossary: docs/design/console-i18n.md.
/** ok()/fail() messages and zod field messages of actions.ts + billing-actions.ts, grouped by feature. */
export const actions = {} as const

export const domainErrors = {} as const
