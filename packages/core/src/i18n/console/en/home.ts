// `home` namespace (EN source): Console → Overview (app/platform/(console)/page.tsx), the R22 reference conversion.
// Foundation-owned; mirror every key in ar/home.ts.
export const home = {
  title: 'Overview',
  description: 'Every spa on the platform at a glance.',
  stats: {
    spas: 'Spas',
    spasHint: '{active} active · {trial} in trial',
    arr: 'ARR',
    arrHint: 'Active subscriptions',
    collected: 'Collected this month',
    overdue: 'Overdue',
    overdueHint: 'Spas with invoices past due · {periods} periods ended',
  },
  applications: {
    title: 'Spa applications',
    waiting: '{count} waiting for review · oldest: {name}, sent {date}',
    none: 'No applications waiting. New spas apply from the website; you accept or reject them here.',
    pending: '{count} pending',
    noneWaiting: 'none waiting',
  },
  health: {
    title: 'Server health',
    description:
      'Worker heartbeat every 5 minutes; alerts are emailed to PLATFORM_ADMIN_EMAILS once per incident.',
    worker: 'Worker',
    noHeartbeat: 'No heartbeat yet: the worker is not running',
    heartbeat: { one: 'Last heartbeat {count} min ago', other: 'Last heartbeat {count} min ago' },
    heartbeatDown: {
      one: 'Last heartbeat {count} min ago: the worker looks down',
      other: 'Last heartbeat {count} min ago: the worker looks down',
    },
    disk: 'Disk',
    diskUse: '{pct}% used · {free} GB free',
    unknown: 'Unknown',
    csp: 'Content-Security-Policy',
    cspNone: 'No blocked scripts, frames or styles reported in 7 days',
    cspBlocked: '{count} blocked in 7 days · {list}',
    deploy: 'Last deploy',
  },
  config: {
    title: 'Configuration',
    description: 'Production settings present on the server (values are never shown).',
    resend: 'RESEND_API_KEY (staff email)',
    resendMissing:
      'Missing: sign-up verification, password reset and alerts cannot be sent. Set it in Settings → Email.',
    resendSet: 'Set (from {source}) · sends as {domain}',
    resendSetDefault: 'Set (from {source}) · sends as {domain} (default sender)',
    source: { console: 'console', env: 'env' },
    set: 'Set',
    missing: 'Missing: {effect}',
    workerSet: 'worker sees it set',
    workerMissing: 'worker sees it missing',
    /** configChecks() rows (@spa/core config-health.ts) by `key`; env var names stay as they are. */
    checks: {
      backups: {
        label: 'Off-site backups (R2_* / S3_*)',
        effect: 'No off-site database backup or restore drill.',
      },
      APP_ENCRYPTION_KEY: {
        label: 'APP_ENCRYPTION_KEY',
        effect: 'Integration tokens are encrypted with a key derived from the auth secret.',
      },
      SENTRY_DSN: { label: 'SENTRY_DSN', effect: 'Server and worker errors are not reported anywhere.' },
      ARK_API_KEY: {
        label: 'ARK_API_KEY (AI)',
        effect: 'AI features (content, replies, insights) are unavailable.',
      },
      TURNSTILE: {
        label: 'TURNSTILE_* (bot check)',
        effect:
          'Online booking, the booking widget, Apply and Contact have no bot check (honeypot + rate limits only).',
      },
      VAPID: { label: 'VAPID keys (push)', effect: 'No browser push notifications for staff.' },
      META: { label: 'META_* (Instagram)', effect: 'Spas cannot connect Instagram.' },
      GOOGLE: {
        label: 'GOOGLE_* (sign-in, Business Profile)',
        effect: 'No Google sign-in or Business Profile reviews.',
      },
      STRIPE: {
        label: 'STRIPE_SECRET_KEY (platform invoices)',
        effect: 'Platform invoices can only be paid by cash / bank transfer.',
      },
    },
    /** configChecks() `detail` hints (exact English → key; anything else prints as-is). */
    detail: {
      derivedKey: 'derived from BETTER_AUTH_SECRET',
      badKey: 'not 32 bytes base64',
      s3Fallback: 'S3 file bucket fallback',
      keysMissing: 'keys missing',
      siteKeyMissing: 'site key missing',
      secretMissing: 'secret key missing',
      from: 'from {source}',
      fromSplit: 'site key from {site}, secret from {secret}',
      customDomains: 'incl. custom domains',
      platformOnly: 'platform hosts (custom domains off)',
      source: { console: 'console', env: 'env', missing: 'missing' },
    },
    drill: 'Restore drill role (spa_drill)',
    drillOk: 'Set · CREATEDB only, no superuser',
    drillWrong: 'Wrong attributes: {problem}. The monthly restore drill refuses to run as it.',
    /** drillRoleProblem() texts; role attributes (SUPERUSER, CREATEDB…) are Postgres names, never translated. */
    drillHas: 'has {attrs}',
    drillNoCreatedb: 'no CREATEDB',
    drillMissing:
      'Missing: the monthly restore drill cannot run. The next deploy creates it (service db-roles).',
  },
  backup: {
    title: 'Off-site backup',
    last: 'Last successful backup {date}',
    never: 'No successful off-site backup yet',
    lastRun: ' · last run {status}: {reason}',
    noBucket: 'no off-site bucket configured (set R2_* or S3_* for the worker)',
    unsafe: ' — the database is not safely backed up off the server.',
    overdue: 'overdue',
    missing: 'missing',
  },
  ai: {
    title: 'AI budgets',
    item: '{name} {percent}%',
    itemPaused: '{name} {percent}% (paused)',
    allUnder: 'Every spa is under 80 % of its monthly AI budget.',
    flagged: '{count} at ≥ 80 %',
  },
  drill: {
    title: 'Backup restore drill',
    lastRun: 'Last run {date}',
    restored: ' · {key} restored · {counts}',
    skipped: ' · skipped: R2 backups are not configured',
    never: 'No drill has run yet — the worker restores the latest R2 backup on the 2nd of each month.',
    overdue: '{status} · overdue',
    neverRun: 'never run',
  },
  late: {
    title: 'Payments overdue',
    description: 'Remind the spa from its page, or pause it until it pays.',
    invoices: 'Invoices',
    oldest: 'Oldest due',
    amount: 'Amount',
    paused: 'paused',
    pause: 'Pause',
  },
  recent: {
    title: 'Newest spas',
    address: 'Address',
    joined: 'Joined',
  },
  /** Health / configuration row badges. */
  badge: { ok: 'ok', off: 'off', problem: 'problem' },
} as const
