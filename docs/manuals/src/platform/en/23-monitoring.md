# 23. Monitoring and alerts

## What this is for

Hear about problems before the spas do. The platform watches itself, shows its health on the Overview and emails you when something needs attention.

## What watches the platform

1. **The Overview page.** The **Server health** card shows the background worker, the disk, blocked scripts and the last deploy. The **Configuration** card shows whether every server setting is present (chapter 3). Look at it once a day.
2. **Alert emails.** Every super-admin gets an email, once per incident, when:
   - the disk is more than 85 % full,
   - there has been no successful off-site backup for 36 hours,
   - a deploy failed.
3. **Sentry.** Sentry is an error tracking service (the free plan is enough). Once the SENTRY_DSN setting is on the server, it receives the errors of the website and the background worker. Claude can read the errors there to find the cause of a problem. The **SENTRY_DSN** row on the Overview shows whether it is set.
4. **Optional: an uptime monitor.** A free uptime monitoring service can check every few minutes that the platform answers, and email you when it doesn't. Point it at:
   - **https://app.spamanagement.co/api/health**,
   - one spa website, for example https://saffron-spa.spamanagement.co.

> **Important:** The alert emails are sent by the background worker. If the worker itself stops, it cannot email you. The **Worker** row on the Overview then turns red ("the worker looks down") after 10 minutes. That is why a daily look at the Overview matters, and why an outside uptime monitor is a good extra.

> **Tip:** Alert emails need staff email to work (chapter 15).

## What to do when something turns red

| What you see | What to do |
|---|---|
| **Worker** is red | Ask Claude to check the server. Reminders, backups and other scheduled jobs are not running. |
| **Disk** is above 85 % | Ask Claude to free up space or plan a bigger server (chapter 26). |
| **Last deploy** says **failed** | The server is already back on the last good version. Ask Claude to check the build log (chapter 19). |
| **Off-site backup** is **overdue** or **missing** | Ask Claude to check the backup settings (chapter 22). |
| **Content-Security-Policy** is amber | Browsers blocked a script, frame or style. Usually harmless; ask Claude to look if it keeps happening. |
| A **Configuration** row is red | See the table in chapter 3 for the matching chapter. |
