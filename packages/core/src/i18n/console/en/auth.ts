// `auth` namespace (EN source) of the console: the admin-host sign-in, join and two-step pages (R22).
// Shared paths: everything outside `admin` is read by the shared auth forms (components/auth: LoginForm,
// TwoFactorForm through useAuthT) with the spa catalogue's keys, so it is taken from en/auth.ts as-is (identical
// English; the catalogue test enforces it). Console-only copy lives under `admin`. Mirror every key in ar/auth.ts.
import { auth as spa } from '../../en/auth'

export const auth = {
  legal: spa.legal,
  generic: spa.generic,
  email: spa.email,
  password: spa.password,
  passwordHint: spa.passwordHint,
  yourName: spa.yourName,
  login: spa.login,
  twoFactor: spa.twoFactor,
  closed: spa.closed,
  errors: spa.errors,
  admin: {
    signInTitle: 'Super-admin sign in',
    title: 'Super-admin',
    subtitle: 'Platform console for spamanagement.co.',
    createAccount: 'Create a super-admin account',
    aside: {
      chip: 'Automation for UAE spas',
      headline1: 'More bookings.',
      headline2: 'Less work.',
      point1: 'Bookings, walk-ins and rooms on one calm calendar',
      point2: 'Cash-first POS, packages and simple accounts',
      point3: 'A beautiful website and AI that fills empty slots',
      footer: 'Made for spas across the UAE.',
    },
    join: {
      title: 'Create a super-admin account',
      subtitle: 'For platform super-admin addresses only. Spas apply on the sign-up page.',
      submit: 'Create super-admin account',
      haveAccount: 'Already have an account?',
      signIn: 'Sign in',
      pendingTitle: 'Confirm your email',
      pendingSubtitle: 'Signed in as {email}.',
      pendingSent:
        'We sent a confirmation link to {email}. Open it, then open the console: you will set up two-step verification (an authenticator app) before it opens.',
      pendingNoEmail:
        'No email? An existing super-admin can confirm your address in the console → Company → Super-admins (Mark email verified).',
      openConsole: 'Open the console',
      resend: 'Send the link again',
      signOut: 'Sign out',
      tooMany: 'Too many attempts from your network. Please try again later.',
      exists: 'This email already has a login. Sign in instead.',
      registered: 'Already registered',
      signInFirst: 'Sign in first.',
      resent: 'A new link is on its way to {email} (if email sending is set up).',
      errors: {
        name: 'Enter your name',
        email: 'Enter a valid email address',
        password: 'Use at least 10 characters',
      },
    },
  },
} as const
