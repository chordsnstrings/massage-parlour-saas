# 26. Monthly running costs

## What this is for

What the platform costs to run each month, and what grows when you add more spas. The target is to stay at or under USD 50 a month for the servers and services.

## The monthly bill

| Item | USD per month |
|---|---|
| DigitalOcean server (droplet), 4 GB memory, 2 CPUs | 24.00 |
| DigitalOcean droplet backups, weekly (daily: 7.20) | 4.80 |
| DigitalOcean Spaces (off-site database backups) | 5.00 |
| Namecheap DNS and Email Forwarding (ask@) | 0 |
| Secure (https) certificates | 0 |
| Resend (staff email, free plan) | 0 |
| Sentry (errors, free plan) and an uptime monitor (free) | 0 |
| GitHub Actions (automatic checks) | 0 |
| **Total** | **about 33.80** |

With daily droplet backups instead of weekly, the total is about USD 36.20. Add the yearly renewal of the spamanagement.co domain at Namecheap.

> **Tip:** AI (BytePlus ModelArk) is not part of this bill. It is paid per use and is covered by the plan prices. Each spa has its own monthly AI budget (chapter 16).

> **Important:** The free plans have limits. If Resend, Sentry or GitHub warn that a limit is near, ask Claude what to do before paying for an upgrade.

## When the platform grows

When more spas join and the server gets busy, scale up in this order:

1. Move the database to **DigitalOcean Managed PostgreSQL** (about USD 15 a month more). It brings its own backups and point-in-time restore.
2. Use a **bigger droplet**, or add a second server for the app.
3. Add more **Spaces** storage for backups and files.

> **Tip:** The **Disk** row in the **Server health** card on the Overview (chapter 3) is the first sign that the server needs to grow. Ask Claude to look at it with you before you change anything.
