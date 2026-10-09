import { listedAdminEmails } from '../admins'
import { closeAllDbs, createDb } from '../client'
import { seedPlatform } from '../seed'

const url = process.env.DATABASE_URL_PLATFORM
if (!url) throw new Error('DATABASE_URL_PLATFORM is not set')
await seedPlatform(createDb(url, 1), listedAdminEmails())
await closeAllDbs()
console.log('seed applied')
