/** Shared by the connect action and the OAuth callback (not a route). */
export const NONCE_PATH = '/api/integrations/meta'

/**
 * The nonce cookie of one connect: per flow (Instagram Login `ig`, Facebook Login for Business `fb`, F19) and per spa
 * (R29: a manager connecting two spas in one browser, e.g. two tabs, doesn't overwrite the first spa's nonce). The
 * callback reads the spa from the signed state.
 */
export const nonceCookie = (flow: 'ig' | 'fb', tenantId: string) => `${flow}_oauth_nonce_${tenantId}`

/** Notices for `?fb=` after the Facebook round trip (text: settings.integrations.fb.notices.*, EN + TH). */
export const FB_NOTICES: Record<string, 'success' | 'error'> = {
  connected: 'success',
  choose: 'success',
  denied: 'error',
  state: 'error',
  forbidden: 'error',
  in_use: 'error',
  no_pages: 'error',
  not_configured: 'error',
  error: 'error',
}

/** Messages for `?ig=` after the OAuth round trip (shown on the integrations card). */
export const CONNECT_NOTICES: Record<string, { tone: 'success' | 'error'; text: string }> = {
  connected: {
    tone: 'success',
    text: 'Instagram is connected. New DMs and comments will appear in the inbox.',
  },
  denied: { tone: 'error', text: 'Instagram access was not granted, so nothing was connected.' },
  state: {
    tone: 'error',
    text: 'That connect link expired or was opened in another browser. Please try again.',
  },
  forbidden: {
    tone: 'error',
    text: 'Only someone who can manage AI settings for this spa can connect Instagram.',
  },
  in_use: {
    tone: 'error',
    text: 'That Instagram account is already connected to another spa. Disconnect it there first.',
  },
  not_configured: { tone: 'error', text: "Instagram isn't configured on this server yet." },
  error: {
    tone: 'error',
    text: 'Instagram did not accept the connection. Check the account is a professional (business or creator) account and try again.',
  },
}
