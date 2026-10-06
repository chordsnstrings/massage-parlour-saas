import { describe, expect, it } from 'vitest'
import { jobs } from '../src/jobs'

describe('job schedule', () => {
  it('schedules the engage jobs (Asia/Dubai crons)', () => {
    const crons = Object.fromEntries(jobs.map((j) => [j.name, j.cron]))
    expect(crons).toMatchObject({
      'document-reminders': '0 9 * * *',
      'weekly-insights': '0 8 * * 1',
      'daily-digest': '30 9 * * *',
    })
    expect(new Set(jobs.map((j) => j.name)).size).toBe(jobs.length)
  })
})
