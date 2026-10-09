// Installable dashboard (docs/PLAN.md §18.6): user-menu entry, home-page tip, iOS steps, offline page.
// `{app}` is the spa's app name ("Tamara Management"), built from its typed name — never translated.
export const pwa = {
  install: 'Install app',
  ios: {
    title: 'Install {app}',
    description: 'Add {app} to your Home Screen and open it like any other app.',
    share: 'Tap the Share button in the browser toolbar.',
    add: 'Scroll down and tap “Add to Home Screen”.',
    confirm: 'Tap Add — {app} appears on your Home Screen.',
    done: 'Got it',
  },
  tip: {
    title: 'Install {app}',
    body: 'Open your spa in one tap, full screen, on your phone or computer — no app store needed.',
    install: 'Install app',
    howTo: 'Show me how',
    dismiss: 'Not now',
  },
  offline: {
    title: 'You’re offline',
    body: 'Reconnect to continue.',
    retry: 'Try again',
  },
} as const
