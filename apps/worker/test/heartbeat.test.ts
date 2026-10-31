import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setEmailSettingsSource, setEmailTransport } from '@spa/core'
import { closeAllDbs, platformJobRuns } from '@spa/db'
import { resetTestDatabase, testDbs, testUrls } from '@spa/db/testing'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { jobs } from '../src/jobs'
import { alertChanges, heartbeat } from '../src/jobs/heartbeat'

const { platform } = testDbs()

describe('worker heartbeat + ops alerts (G8)', () => {
  beforeAll(() => resetTestDatabase())
  afterAll(async () => {
    setEmailSettingsSource(undefined)
    setEmailTransport(null)
    await closeAllDbs()
  })

  it('runs every 5 minutes', () => {
    expect(jobs.find((j) => j.name === 'worker-heartbeat')?.cron).toBe('*/5 * * * *')
  })

  it('opens and closes incidents once', () => {
    const red = { key: 'disk', red: true, message: 'm' }
    expect(alertChanges([red], new Set()).opened).toEqual([red])
    expect(alertChanges([red], new Set(['disk'])).opened).toEqual([])
    expect(alertChanges([{ ...red, red: false }], new Set(['disk'])).closed).toHaveLength(1)
  })

  it('records the beat with flags only and emails a failed deploy once per incident', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ops-status-'))
    await writeFile(
      join(dir, 'deploy.json'),
      JSON.stringify({ state: 'failed', commit: 'abc1234', message: 'web not healthy' }),
    )
    const sent: { to: string; subject: string }[] = []
    setEmailSettingsSource(async () => ({ apiKey: 're_test_key1' }))
    setEmailTransport(async (m) => {
      sent.push({ to: m.to, subject: m.subject })
    })
    const env = {
      DATABASE_URL_PLATFORM: testUrls.platform,
      OPS_STATUS_DIR: dir,
      PLATFORM_ADMIN_EMAILS: 'ops@e.test, boss@e.test',
      ARK_API_KEY: 'sk-very-secret',
    }
    await heartbeat(env)
    await heartbeat(env)
    expect(sent.map((s) => s.to)).toEqual(['ops@e.test', 'boss@e.test'])
    expect(sent[0]?.subject).toContain('deploy')

    const beats = await platform
      .select()
      .from(platformJobRuns)
      .where(eq(platformJobRuns.job, 'worker-heartbeat'))
    expect(beats).toHaveLength(2)
    expect(JSON.stringify(beats[0]?.details)).not.toContain('sk-very-secret')
    expect(beats[0]?.details).toMatchObject({ deploy: { state: 'failed' }, config: { ARK_API_KEY: true } })

    await writeFile(join(dir, 'deploy.json'), JSON.stringify({ state: 'ok', commit: 'def5678' }))
    await heartbeat(env)
    const incidents = await platform
      .select()
      .from(platformJobRuns)
      .where(eq(platformJobRuns.job, 'ops-alert'))
      .orderBy(asc(platformJobRuns.id))
    // (the sandbox disk may be full too: only the deploy incident is asserted)
    expect(incidents.filter((r) => r.details.key === 'deploy').map((r) => [r.details.key, r.status])).toEqual(
      [
        ['deploy', 'failed'],
        ['deploy', 'ok'],
      ],
    )
    expect(sent).toHaveLength(2)
  })
})
