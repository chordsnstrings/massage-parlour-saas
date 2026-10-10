import { describe, expect, it } from 'vitest'
import { jobs } from '../src/jobs'

describe('job schedule', () => {
  it('schedules the engage jobs (Asia/Dubai crons)', () => {
    const crons = Object.fromEntries(jobs.map((j) => [j.name, j.cron]))
    expect(crons).toMatchObject({
      'document-reminders': '0 9 * * *',
      'weekly-insights': '0 8 * * 1',
      'daily-digest': '30 9 * * *',
      'notify-pending-bookings': '*/15 * * * *',
      'notify-low-stock': '15 9 * * *',
      'notify-ai-drafts': '0 10 * * *',
      'notify-billing': '20 9 * * *',
      'billing-transitions': '5 9 * * *',
      'notifications-prune': '50 4 * * *',
      'oauth-clients-prune': '35 * * * *',
      'outbox-auto-assign': '* * * * *',
      'client-drafts': '25 * * * *',
    })
    expect(new Set(jobs.map((j) => j.name)).size).toBe(jobs.length)
  })
})
