# 3. Overview: the platform at a glance

## What this is for

The **Overview** page is your daily check. On one screen you see money, waiting applications, server health, configuration, backups, AI budgets and late payers. It opens first when you sign in to the console.

## Key numbers and waiting applications

1. Click **Overview** in the sidebar.
2. Read the four numbers at the top:
   - **Spas**: all spas on the platform, with how many are active and how many are in trial.
   - **ARR**: the yearly value of all active subscriptions.
   - **Collected this month**: platform payments received since the 1st of this month.
   - **Overdue**: the number of spas with invoices past their due date. The line under it also says how many **periods ended**: active spas whose 12-month subscription period is over. No new invoices are issued for them until you renew the period (chapter 6, "Renew a subscription after 12 months").
3. Read the **Spa applications** card. It says how many applications are waiting and which one is the oldest.
4. Click the **pending** badge to open **Applications** (chapter 4).

   ![The Overview page.](../../../shots/platform/overview-top.png)

   *In the screenshot:*

   1. **Spas**.
   2. **ARR**.
   3. **Collected this month**.
   4. **Overdue**.
   5. The **Spa applications** badge (here **3 pending**).

> **Tip:** When nothing is waiting, the card says "No applications waiting. New spas apply from the website; you accept or reject them here."

## Server health

The **Server health** card shows whether the server is working normally. Each row has a badge on the right.

1. **Worker**: the background worker (it sends reminders, runs backups and other scheduled jobs) checks in every 5 minutes. The row shows the last check-in, for example "Last heartbeat 2 min ago". If it has not checked in for more than 10 minutes, the row turns red and says "the worker looks down".
2. **Disk**: how full the server's disk is. It turns red above 85 % used.
3. **Content-Security-Policy**: scripts, frames or styles that browsers blocked and reported in the last 7 days. This row only turns amber, never red. "No blocked scripts, frames or styles reported in 7 days" is the normal state.
4. **Last deploy**: the result and the code version of the last update to the server. **failed** means the update did not work and the server went back to the previous version (chapter 19).

   ![Server health.](../../../shots/platform/overview-health-card.png)

   *In the screenshot:*

   1. **Worker**.
   2. **Disk**.
   3. **Content-Security-Policy**.
   4. **Last deploy**.

> **Important:** You also get an email when something goes wrong: the disk is more than 85 % full, there has been no off-site backup for 36 hours, or a deploy failed. Every address on the super-admin list gets it, once per incident. This needs email to be set up (chapter 15).

## Configuration

The **Configuration** card lists the settings the live server needs. It only says whether each setting is present. The value itself is never shown.

1. Read each row. The badge on the right means:
   - Green **ok**: the setting is present.
   - Red **problem**: a required setting is missing. Fix it soon.
   - Amber **off**: an optional setting is not set. The row says what does not work without it, for example "Missing: No browser push notifications for staff."
2. The first row, **RESEND_API_KEY (staff email)**, also says where the email key comes from: the console (**Company** → **Email**) or the server ("from env"), and which address mail is sent as.
3. Fix a red row with the matching chapter:
   - **RESEND_API_KEY (staff email)**: chapter 15.
   - **TURNSTILE_\* (bot check)**: chapter 15.
   - **Off-site backups (R2_\* / S3_\*)** and **Restore drill role (spa_drill)**: chapter 22.
   - **SENTRY_DSN**: chapter 23.
   - **ARK_API_KEY (AI)**: chapter 16.
   - **APP_ENCRYPTION_KEY** and every other server setting: chapter 24.

   ![Configuration: presence only, never values.](../../../shots/platform/overview-config-card.png)

   *In the screenshot:*

   1. The **RESEND_API_KEY (staff email)** row with its source.
   2. A green **ok** row (**SENTRY_DSN**).
   3. An amber **off** row: **VAPID keys (push)** is optional and not set.
   4. **Restore drill role (spa_drill)**: the database role used for the monthly restore test.

The required settings are **Off-site backups (R2_\* / S3_\*)**, **APP_ENCRYPTION_KEY**, **SENTRY_DSN**, **ARK_API_KEY (AI)** and **TURNSTILE_\* (bot check)**, together with **RESEND_API_KEY (staff email)**. The optional ones are **VAPID keys (push)**, **META_\* (Instagram)**, **GOOGLE_\* (sign-in, Business Profile)** and **STRIPE_SECRET_KEY (platform invoices)**.

> **Tip:** If a row ends with "· worker sees it missing" (or "· worker sees it set"), the website and the background worker do not have the same settings. Ask Claude to give both the same value.

> **Important:** Never type a key or password into a chat to "check" it. The Configuration card is the safe way to see whether a setting is there.

## Backups, restore drill and AI budgets

1. **Off-site backup** shows the date of the last successful backup copied off the server. The badge reads **ok**, **overdue** or **missing**. **overdue** (no backup for 36 hours) and **missing** (never backed up) mean the database is not safely copied off the server. See chapter 22.
2. **AI budgets** lists spas that have used 80 % or more of their monthly AI budget. "(paused)" next to a spa means it reached 100 % and its AI features stop until the next month starts (Dubai time) or until you raise its budget. Click the badge to open **AI usage** (chapter 16).
3. **Backup restore drill** shows the last monthly test restore. The worker restores the latest backup into a test database on the 2nd of each month and counts the records, for example "sales 6143, clients 702". It turns red if no drill has succeeded for 35 days.

   ![Backup, AI budget and restore drill cards.](../../../shots/platform/overview-backup-cards.png)

   *In the screenshot:*

   1. The **Off-site backup** badge.
   2. **AI budgets**: here two spas at 80 % or more.
   3. **Backup restore drill** with the date and the record counts.

## Payments overdue and newest spas

1. **Payments overdue** lists spas with unpaid invoices past their due date: "Remind the spa from its page, or pause it. A pause stays until you click Resume spa on its page." The columns are **Spa**, **Invoices**, **Oldest due** and **Amount**.
2. Click **Pause** to make that spa's dashboard read-only. It stays read-only until you click **Resume spa** on its page (chapter 6). A payment does not lift a pause you made by hand. A spa that is already paused shows the badge **paused** instead.
3. To send a reminder instead, click the spa's name. Its page opens, and you send the reminder from there (chapter 6).

   ![Late payers, with a one-click pause.](../../../shots/platform/overview-overdue.png)

   *In the screenshot:*

   1. The spa name. Click it to open the spa.
   2. **Oldest due**: the due date of its oldest unpaid invoice.
   3. **Pause**.

4. **Newest spas** shows the last 8 spas that joined, with their address, status and join date. Click **View all** to open **Spas**.

> **Important:** Pausing makes only the spa's dashboard read-only. The spa's website and online booking keep working, so its clients are not affected. The spa can still pay its invoice by card while paused.
