import {
  INSTAGRAM_REPLY_QUEUE,
  INSTAGRAM_REPLY_RETRY,
  type InboundItem,
  instagramReplyJobId,
} from '@spa/services'
import { PgBoss } from 'pg-boss'

/**
 * Send-only pg-boss client for the web process (no polling, no cron, no schema migration — the worker owns those).
 * pg-boss lives in the owner role's `pgboss` schema, so this one module uses DATABASE_URL_OWNER; it only ever
 * inserts jobs and never touches tenant data.
 */
let boss: Promise<PgBoss> | null = null

function client() {
  boss ??= (async () => {
    const url = process.env.DATABASE_URL_OWNER
    if (!url) throw new Error('DATABASE_URL_OWNER is not set')
    const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n')
    const u = new URL(url)
    if (ca) u.searchParams.delete('sslmode')
    const b = new PgBoss({
      connectionString: u.toString(),
      max: 2,
      supervise: false,
      schedule: false,
      migrate: false,
      ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
    })
    b.on('error', (e) => console.error('pg-boss (web) error', String(e)))
    await b.start()
    await b.createQueue(INSTAGRAM_REPLY_QUEUE, { ...INSTAGRAM_REPLY_RETRY })
    return b
  })().catch((e) => {
    boss = null
    throw e
  })
  return boss
}

/** Queues one AI turn per new inbound Instagram message; the same message is only ever queued once. */
export async function enqueueInstagramReplies(items: InboundItem[]) {
  const b = await client()
  for (const item of items)
    await b.send(INSTAGRAM_REPLY_QUEUE, item, {
      id: instagramReplyJobId(item),
      singletonKey: item.messageId,
      ...INSTAGRAM_REPLY_RETRY,
    })
}
