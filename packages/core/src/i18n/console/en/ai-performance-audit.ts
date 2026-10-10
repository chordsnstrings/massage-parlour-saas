// Console page group "ai-performance-audit" (R22, EN source): Console → AI models + AI usage, Performance, Audit log (ai/**, performance/**, audit/**).
// Owned by that group's conversion — only it edits this file and ar/ai-performance-audit.ts (mirror every key there).
// Keys: one namespace per page (registered in console/en.ts already); `domainErrors` = the services' DomainError
// texts these pages show, copied exactly from en/domain.ts under the same id (merged into `errors.domain`).
// Recipe, key naming and the glossary: docs/design/console-i18n.md.
export const aiModels = {
  title: 'AI models',
  description:
    'BytePlus ModelArk model per agent. Seed 2.0 by default — model IDs change often, so update them here, no deploy needed.',
  usage: {
    title: 'AI usage',
    description:
      'AI spend per spa against its monthly budget (Asia/Dubai months). At 80 % the spa owner is notified; at 100 % AI pauses for that spa until the 1st.',
  },
} as const

export const performance = {
  title: 'Performance',
} as const

export const auditLog = {
  title: 'Audit log',
  description: 'Every change across the platform, newest first.',
} as const

export const domainErrors = {} as const
