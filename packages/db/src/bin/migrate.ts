import { closeAllDbs } from '../client'
import { runMigrations } from '../migrate'

const url = process.env.DATABASE_URL_OWNER
if (!url) throw new Error('DATABASE_URL_OWNER is not set')
await runMigrations(url)
await closeAllDbs()
console.log('migrations applied')
