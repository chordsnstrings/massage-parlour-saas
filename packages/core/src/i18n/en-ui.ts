/**
 * Built-in strings of the shared UI kit (apps/web/src/components/ui). Its own module so components rendered outside
 * the spa dashboard (super-admin, auth, public pages) fall back to English without bundling the whole catalogue.
 */
export const ui = {
  close: 'Close',
  dismiss: 'Dismiss',
  save: 'Save',
  copy: 'Copy',
  copied: 'Copied',
  more: 'More',
} as const
