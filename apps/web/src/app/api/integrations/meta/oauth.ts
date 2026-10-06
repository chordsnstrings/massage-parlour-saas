/** Shared by the connect action and the OAuth callback (not a route). */
export const NONCE_COOKIE = 'ig_oauth_nonce'
export const NONCE_PATH = '/api/integrations/meta'

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
