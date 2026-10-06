import { PgBoss } from 'pg-boss'
import { jobs } from './jobs'
import { log } from './log'

const url = process.env.DATABASE_URL_OWNER
if (!url) throw new Error('DATABASE_URL_OWNER is not set')

const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n')
const bossUrl = (() => {
  if (!ca) return url
  const u = new URL(url)
  u.searchParams.delete('sslmode') // TLS is configured explicitly below
  return u.toString()
})()
const boss = new PgBoss({
  connectionString: bossUrl,
  max: 3,
  ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
})
boss.on('error', (error) => log('error', 'pg-boss error', { error: String(error) }))
await boss.start()

for (const job of jobs) {
  await boss.createQueue(job.name)
  await boss.work(job.name, async ([j]) => {
    const started = Date.now()
    try {
      const result = await job.handler(j?.data)
      log('info', 'job done', { job: job.name, ms: Date.now() - started })
      return result
    } catch (error) {
      log('error', 'job failed', { job: job.name, error: String(error) })
      throw error
    }
  })
  if (job.cron) await boss.schedule(job.name, job.cron, null, { tz: 'Asia/Dubai' })
}
log('info', 'worker started', { jobs: jobs.map((j) => j.name) })

const shutdown = async (signal: string) => {
  log('info', 'worker stopping', { signal })
  await boss.stop({ graceful: true, timeout: 30_000 })
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
