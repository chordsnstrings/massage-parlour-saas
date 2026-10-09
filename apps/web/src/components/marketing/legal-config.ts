// OWNER MUST REVIEW: the legal pages (/privacy, /terms, /data-deletion) are a plain-English starting point, not legal
// advice. Fill in the company details below (PLAN §16.2) and have the text checked before submitting to Meta/Google.
export const LEGAL = {
  /** Registered legal name of the platform company (must match Meta Business Verification). */
  companyName: '[Company legal name]',
  /** Registered address, including emirate. */
  address: '[Registered address], United Arab Emirates',
  /** Inbox for privacy, deletion and legal requests. */
  email: 'privacy@spamanagement.co',
  brand: 'spamanagement.co',
  /** Date the current text took effect. */
  updated: '9 October 2026',
} as const

export const LEGAL_LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/data-deletion', label: 'Data deletion' },
] as const
