import { defineConfig } from 'vitest/config'

const local = (role: string) =>
  `postgres://${role}:${role}_dev@localhost:5432/${process.env.TEST_DB_NAME ?? 'spa_test'}`

export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 30_000,
    // Agents use the default app/platform connections; point them at the test database.
    env: {
      DATABASE_URL_APP: process.env.TEST_DATABASE_URL_APP ?? local('spa_app'),
      DATABASE_URL_PLATFORM: process.env.TEST_DATABASE_URL_PLATFORM ?? local('spa_platform'),
    },
  },
})
