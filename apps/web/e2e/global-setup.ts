import { closeAllDbs, createDb } from '@spa/db'
import { seedPlatform } from '@spa/db/seed'
import { resetTestDatabase, testUrls } from '@spa/db/testing'

export default async function globalSetup() {
  await resetTestDatabase()
  await seedPlatform(createDb(testUrls.platform, 1))
  await closeAllDbs()
}
