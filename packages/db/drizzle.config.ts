import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  // F25 drift check (scripts/check-drift.sh) generates into a temp copy.
  out: process.env.DRIZZLE_OUT ?? './drizzle',
  entities: { roles: { provider: '' } },
})
