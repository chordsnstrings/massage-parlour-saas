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
  },
} as const
