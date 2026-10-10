// `chrome` namespace (EN source): the console frame — sidebar + bottom tabs, user menu, 404 and error pages.
// Foundation-owned (R22); mirror every key in ar/chrome.ts. Language names are endonyms in code, never here.
export const chrome = {
  title: 'Platform console',
  nav: {
    overview: 'Overview',
    applications: 'Applications',
    enquiries: 'Enquiries',
    tenants: 'Spas',
    performance: 'Performance',
    websites: 'Websites',
    plans: 'Plans & prices',
    announcements: 'Announcements',
    flags: 'Feature flags',
    company: 'Company',
    aiModels: 'AI models',
    aiUsage: 'AI usage',
    domains: 'Domains',
    templates: 'Site templates',
    audit: 'Audit log',
  },
  menu: {
    account: 'Account & security',
    switchSpa: 'Switch spa',
    signOut: 'Sign out',
    language: 'Language',
  },
  notFound: {
    title: 'Page not found',
    body: 'This page doesn’t exist in the console, or it has moved.',
    back: 'Back to the console',
  },
  boundary: {
    title: 'Something went wrong',
    body: 'The error was logged. Try again; the reference below finds it in the server logs.',
    retry: 'Try again',
    home: 'Back to the console',
    ref: 'Ref {digest}',
  },
} as const
