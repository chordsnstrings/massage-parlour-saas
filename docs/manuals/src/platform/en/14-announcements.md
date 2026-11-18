# 14. Announcements and feature flags

## What this is for

Announcements tell spas something inside their dashboard, for example new opening hours or planned maintenance. They are never sent by email or SMS. Feature flags switch a feature on or off for every spa, or for one spa.

## Post an announcement

1. Click **Announcements** in the sidebar.
2. Click **New announcement**. The sheet **New announcement** opens.
3. Fill **Title (English)** and **Message (English)**.
4. Optional: fill **Title (Thai)** and **Message (Thai)**. Spa members who use the dashboard in Thai see these. "Optional — English is shown when empty."
5. Choose the **Severity**: **Info (green)**, **Warning (amber)** or **Critical (red)**.
6. Choose **Show to**:
   - **Every spa**.
   - **Spas on the plans ticked below**: then tick the plans under **Plans**.
   - **The spas selected below**: then pick the spas under **Spas** (hold Ctrl, or ⌘ on a Mac, and click to pick several).
7. Set **Show from (Dubai time)**. Optional: set **Until (Dubai time)**. Leave **Until** empty to show it until you end it.
8. Click **Publish**.

   ![Writing an announcement.](../../../shots/platform/ann-sheet.png)

   *In the screenshot:*

   1. The titles and messages in English and Thai.
   2. **Severity**.
   3. **Show to**.
   4. **Show from (Dubai time)** and **Until (Dubai time)**.
   5. **Publish**.

9. The announcement appears in the list with its severity and a badge: **live**, **scheduled** (it starts later) or **ended**.
10. Later you can click **Edit**, **End now** (to stop showing it) or **Delete**.

**How spas see it:**

The announcement shows as a bar at the top of every member's dashboard. Each member can close it with the cross; it then stays closed for that person.

![How spas see it.](../../../shots/platform/ann-spa-banner.png)

*In the screenshot:*

1. The announcement bar, with the title in bold and the message.
2. The cross that dismisses it.

> **Tip:** Keep announcements short: one line that says what to do, for example "Remember to update your opening hours for Ramadan under Settings → Hours".

> **Important:** Use **Critical (red)** only for something urgent, such as planned downtime. For a late payment, use a payment reminder on the spa's page instead (chapter 6).

## Feature flags

A feature flag is an on/off switch for a feature. It has one default for every spa, and you can override it for single spas. Changes apply on the next page load and are written to the audit log.

1. Click **Feature flags** in the sidebar.
2. Each flag shows its key, what it does, and two badges:
   - **read by code** (the app uses it) or **not read by code yet** (prepared for a future feature).
   - **default on** or **default off**.
3. To change the default, click **Edit default**. Tick or untick **On for every spa (unless overridden)** and click **Save**.
4. To change it for one spa, go to **Per-spa overrides**. Choose the spa in **Spa**, choose **On** or **Off** in **Value** and click **Set override**.
5. To remove an override, click **Use default** next to the spa.

   ![Feature flags.](../../../shots/platform/flags-page.png)

   *In the screenshot:*

   1. **read by code** and **default on**.
   2. **Edit default**.
   3. **Per-spa overrides**: here Al Noor Wellness has the flag **off**.
   4. **Set override**.

6. **New flag** prepares a new key before the code uses it. Enter the **Key** (a lower-case dotted name, for example calendar.newDayView; it cannot be changed later) and a **Description**.
7. **Delete flag** is offered only for flags the code does not read.

The flag in use today:

- **billing.autoTransitions**: "Automatic billing transitions for unpaid platform invoices (overdue → grace → read-only). Off for a spa = paused." Turning it off for one spa does the same as **Pause automatic transitions** on that spa's page (chapter 6). Turning the default off stops the automatic stages for every spa.

> **Important:** Only add or delete flags when Claude asks you to as part of a change. A new flag does nothing until the code reads it.
