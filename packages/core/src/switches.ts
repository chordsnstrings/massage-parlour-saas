// Product switches: features turned off for every spa by an owner decision, in code. Not a plan feature (plans.ts) and
// not a console flag (flags.ts): flipping one is a code change + release.

/**
 * Owner 2026-10-13: "drop replying on reviews option no need to be there and the current section in the spa dashboard
 * keep it but write/mention that coming soon". While false: no review reply is drafted, approved, sent or auto-posted
 * (dashboard actions refuse, `draftReviewReply` throws, the Google sync skips AI drafts + autopilot, `postGbpReply`
 * refuses, AI-draft notices skip replies), the AI-studio review agent shows "Coming soon" and can't be switched on (a
 * stored "on" is ignored), and the dashboard Reviews page shows a "Coming soon" panel. Reading Google reviews stays
 * (sync every 2 h, the 30-day rule, the Website "Google reviews" block, the Google card's count + rating).
 * Turning it back on also needs the copy restored: settings `integrations.description` + `gbp.sub/untilThen/features`,
 * `ai.shortcutReviews`, `notifications.ai.drafts.body`, plans.ts `reviews` row, marketing content.ts, privacy page.
 */
export const REVIEW_REPLIES_LIVE = false as boolean
