import type { EnquiryStatus } from '@spa/services'

/** Console labels + badge tones for enquiry statuses (PLAN §18.4). */
export const ENQUIRY_STATUS: Record<
  EnquiryStatus,
  { label: string; tone: 'warning' | 'accent' | 'neutral'; hint: string }
> = {
  new: { label: 'New', tone: 'warning', hint: 'Not answered yet (counted on the nav badge).' },
  contacted: { label: 'Contacted', tone: 'accent', hint: 'You replied; waiting on them.' },
  closed: { label: 'Closed', tone: 'neutral', hint: 'Done — signed up, not a fit or spam.' },
}
