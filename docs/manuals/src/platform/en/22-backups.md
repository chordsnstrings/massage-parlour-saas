# 22. Backups and the restore drill

## What this is for

Make sure the database (every spa, booking, sale and invoice) can always be recovered, even if the server is lost. The platform keeps several layers of backups and tests one of them every month.

## Backup layers

| Backup | When | Where | How long it is kept |
|---|---|---|---|
| Nightly backup | Every night | On the server | 7 days |
| Backup before each update | Before every deploy (chapter 19) | On the server | The newest 5 |
| Off-site backup | Every night at 03:30 Dubai time | A private DigitalOcean Spaces bucket | Daily copies 30 days, monthly copies 365 days |
| Droplet backups | Weekly (or daily) | DigitalOcean | Set by DigitalOcean |

- The **off-site backup** is the one that matters most. It is the copy that survives if the server itself is lost.
- **Droplet backups** are snapshots of the whole server. Switch them on in DigitalOcean on the droplet's **Backups** page.

> **Important:** The backups on the server are lost together with the server. Keep the off-site backup switched on and check it on the Overview.

## Check the off-site backup

1. Click **Overview** in the sidebar.
2. Find the **Off-site backup** card. It shows the date of the last successful backup.
3. Read the badge:
   - **ok**: a backup was copied off the server in the last 36 hours.
   - **overdue**: no successful backup for more than 36 hours.
   - **missing**: there has never been an off-site backup.

   ![Off-site backup status.](../../../shots/platform/bk-overview.png)

   *In the screenshot:*

   1. **Last successful backup** and its date.
   2. The **ok** badge.

4. If it says **overdue** or **missing**, ask Claude to check the backup settings. Also check the **Off-site backups (R2_\* / S3_\*)** row in the **Configuration** card (chapter 3).

> **Tip:** All super-admins also get an alert email when there has been no successful off-site backup for 36 hours (chapter 23).

## The monthly restore drill

A backup is only useful if it can be restored. On the 2nd of every month, the platform tests this by itself:

1. It takes the latest off-site backup.
2. It restores it into a separate scratch database.
3. It counts the records, for example sales and clients.
4. It deletes the scratch database again.

The result shows in the **Backup restore drill** card on the Overview, with the date and the counts (chapter 3). It turns red if no drill has succeeded for 35 days.

> **Tip:** The drill runs as a separate database user with very few rights (spa_drill). It can only create its own scratch database and cannot read or change the live data. The **Configuration** card shows it as **Restore drill role (spa_drill)**.

## Setting up off-site backups

You only do this once. The bucket costs about USD 5 a month.

1. In DigitalOcean, create a **Spaces** bucket. Keep it **private**.
2. Create a Spaces access key used only for the backups.
3. Add lifecycle rules so old copies are deleted: the folder **backups/daily/** after 30 days, and **backups/monthly/** after 365 days.
4. Add the bucket settings to the encrypted secrets file (chapter 24, "Add or change a secret"). Don't paste the access key into a chat. The settings are the bucket's address, region, name, access key ID and secret key.
5. After the next deploy and the next night's backup, the **Off-site backup** card reads **ok**.

## If you need to restore

1. Tell Claude what happened and from when you need the data. For example: "A spa's bookings from this morning are gone" or "Restore everything to before yesterday's update".
2. Claude, or someone with access to the server, chooses the right backup.
3. Restoring briefly stops the platform, puts back the chosen backup and starts the platform again.
4. Afterwards, check the spa or the data that was affected.

> **Important:** A restore puts the whole database back to the moment of the backup. Everything entered after that moment (bookings, sales, payments) is lost unless it is entered again. Decide together with Claude which backup to use.
