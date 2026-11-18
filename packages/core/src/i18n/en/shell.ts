export const shell = {
  mainMenu: 'Main menu',
  sectionPages: 'Pages in this section',
  openMenu: 'Open menu',
  closeMenu: 'Close menu',
  language: 'Language',
  account: 'Account & security',
  switchSpa: 'Switch spa',
  signOut: 'Sign out',
  profileMenu: 'Profile menu for {name}',
  profileRole: '{role} · {spa}',
  superAdmin: 'Super-admin',
  logoAlt: '{spa} logo',
  greeting: {
    morning: 'Good morning, {name}',
    afternoon: 'Good afternoon, {name}',
    evening: 'Good evening, {name}',
  },
  plan: {
    aiAllowance: 'AI allowance · {percent} used this month',
    aiPaused: 'AI allowance used up · AI pauses until next month',
    renews: 'Renews {date} · {price}/{interval}',
    trialEnds: 'Trial ends {date}',
    interval: { year: 'yr', month: 'mo' },
  },
  banner: {
    impersonating: 'Viewing as super-admin — every change is recorded in the audit log.',
    readOnly: 'This account is read-only. Contact support to restore full access.',
    overdue: 'Please pay your invoice to avoid your account being paused.',
    paused:
      'Your account is paused for late payment — the dashboard is read-only until your invoice is paid. Your website and online booking keep working.',
    payNow: 'Pay now',
    billingLate: 'Invoice overdue — the dashboard becomes read-only on {date} unless it is paid.',
    billingReadOnly:
      'Read-only: an invoice is unpaid past the grace period. Your website and online booking keep working; changes are blocked until it is paid.',
    aiWarning: 'AI budget {percent} used this month — AI pauses when it is reached. Contact us to raise it.',
    aiPaused: 'AI paused: monthly AI budget reached — contact us. AI restarts on the 1st.',
    aiOff: 'AI is switched off for your spa — contact us.',
  },
  announcement: {
    label: 'Announcement from {platform}',
    dismiss: 'Dismiss',
  },
} as const
