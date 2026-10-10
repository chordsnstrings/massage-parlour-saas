import { config } from 'zod'

// F10: pages have no 'unsafe-eval' in their CSP. Zod's JIT probes `new Function` when a schema is built, which the
// browser blocks and reports as a CSP violation (harmless, but noise in the console's CSP row). Import this before any
// module that builds zod schemas in the browser (components/campaigns/rules.ts). The server keeps the JIT.
if (typeof window !== 'undefined') config({ jitless: true })
