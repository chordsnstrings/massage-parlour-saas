/** Shared by the connect action and the OAuth callback (not a route). */
export const GBP_COOKIE = 'gbp_oauth'
export const GBP_COOKIE_PATH = '/api/integrations/google'

/** Messages for `?gbp=` after the OAuth round trip (shown on the integrations card). */
export const GBP_NOTICES: Record<string, { tone: 'success' | 'error'; text: string }> = {
  connected: { tone: 'success', text: 'Google Business Profile is connected again.' },
  choose: { tone: 'success', text: 'Signed in with Google. Now choose the location this spa manages.' },
  denied: { tone: 'error', text: 'Google access was not granted, so nothing was connected.' },
  scope: {
    tone: 'error',
    text: 'Google did not grant permission to manage the Business Profile. Please try again and allow access.',
  },
  state: {
    tone: 'error',
    text: 'That connect link expired or was opened in another browser. Please try again.',
  },
  forbidden: {
    tone: 'error',
    text: 'Only someone who can manage AI settings for this spa can connect Google.',
  },
  not_configured: { tone: 'error', text: "Google sign-in isn't configured on this server yet." },
  error: { tone: 'error', text: 'Google did not accept the connection. Please try again in a moment.' },
}
