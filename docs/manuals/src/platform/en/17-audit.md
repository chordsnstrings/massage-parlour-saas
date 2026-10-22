# 17. Audit log

## What this is for

The audit log shows who changed what, when and from where, across the whole platform. Use it to answer questions like "who recorded this payment?" or "when was this spa paused?".

## Search the audit log

1. Click **Audit log** in the sidebar. The page says: "Every change across the platform, newest first."
2. Read the table. The columns are:
   - **Action**: what happened, as a short code, for example **platform.reminder.created**.
   - **Spa**: the spa's web address name, for example **saffron-spa**. It says **platform** for changes that belong to the whole console, such as company settings.
   - **By**: the email address of the person who made the change, or "—" for automatic jobs.
   - **IP**: the network address the change came from, or "—" when there is none.
   - **When**: the date and time.
3. To find something, type in **Filter by action, spa or email** and press **Enter**. For example:
   - **platform.payment** shows every payment recorded with **Record a payment**, and **platform.invoice.marked** every **Mark paid** and **Mark unpaid**. Search both to find every payment.
   - **saffron** shows everything that happened in the spa with the web address name saffron-spa.
   - An email address shows everything that person did.
4. To see everything again, clear the box and press **Enter**.

   ![The audit log.](../../../shots/platform/audit-page.png)

   *In the screenshot:*

   1. **Filter by action, spa or email**.
   2. **Action**.
   3. **By**.
   4. **When**.

> **Tip:** The page shows the 200 newest matches. If you can't find an older entry, type a more exact filter.

> **Tip:** The **Spa** filter matches the spa's web address name (the part before .spamanagement.co), not its display name. Search "desert-rose", not "Desert Rose Day Spa".

## What the common actions mean

Actions that start with **platform.** are changes made in this console. The others come from inside the spa dashboards, for example **booking.status** or **sale.refunded**.

| Action | What happened |
|---|---|
| **platform.application.accepted** / **platform.application.rejected** | An application was accepted or rejected (chapter 4). |
| **platform.payment.recorded** | A payment was recorded on an invoice (chapter 6). |
| **platform.invoice.created** | A single invoice was created by hand. |
| **platform.invoice.schedule** | **Generate payment schedule** created invoices. |
| **platform.invoice.marked_paid** / **platform.invoice.marked_unpaid** | An invoice was marked paid or unpaid with **Mark paid** / **Mark unpaid** (chapter 6). |
| **platform.subscription.updated** | The **Subscription** card was saved, for example a new period (chapter 6). |
| **platform.subscription.plan_switched** | A spa was moved to another plan. |
| **platform.subscription.discounts** | A spa's discounts were changed. |
| **platform.tenant.feature_tier** | A spa's feature tier was overridden. |
| **platform.tenant.paused** / **platform.tenant.resumed** | A spa was paused or resumed with **Pause spa** (chapter 6). |
| **platform.billing.paused** / **platform.billing.resumed** | Automatic billing steps were paused or resumed for a spa. |
| **platform.tenant.status** | A spa's status was changed by hand. |
| **platform.tenant.slug_renamed** | A spa's web address was changed. |
| **platform.tenant.deleted** / **platform.tenant.purged** | A spa was deleted, or permanently erased. |
| **platform.reminder.created** | A payment reminder was generated. |
| **platform.billing.stage** | A late spa moved to another billing stage (overdue, grace, read-only). |
| **platform.billing.rules** | The billing rules were changed (chapter 7). |
| **platform.plan.created** / **.updated** / **.archived** / **.restored** / **.deleted** | A plan was added, changed, archived, restored or deleted (chapter 8). |
| **platform.company.updated** | The company details were saved (chapter 15). |
| **platform.email.updated** / **platform.email.test_sent** | Email settings were saved, or a test email was sent. |
| **platform.turnstile.updated** | The bot check settings were saved. |
| **platform.ai.budget_updated** | A spa's AI budget was changed (chapter 16). |
| **platform.ai_model.updated** | An AI model was changed. |
| **platform.ai.disabled** / **platform.ai.enabled** | AI was switched off or on for the whole platform (chapter 16). |
| **platform.ai.tenant_disabled** / **platform.ai.tenant_enabled** | AI was switched off or on for one spa (chapter 16). |
| **platform.site_template.** followed by what happened | A site template was saved from a spa, imported, uploaded as HTML or edited, or its images or **Phone fixes** were changed (chapter 12). |
| **platform.site_template.version_uploaded** / **.version_signed_off** / **.version_rolled_out** / **.version_discarded** | A new version of an HTML template was uploaded, signed off, rolled out or discarded (chapter 12). |
| **platform.domain_order.purchased** / **platform.domain_order.rejected** | A domain purchase was approved and bought, or rejected (chapter 13). |
| **platform.announcement.created** / **.updated** / **.ended** / **.deleted** | An announcement was posted, changed, ended or deleted (chapter 14). |
| **platform.flag.created** / **.updated** / **.override** / **.deleted** | A feature flag was added, changed, set for one spa, or deleted (chapter 14). |
| **platform.email.domain_setup** | The sending domain was set up at Resend (chapter 15). |
| **platform.admin.joined** / **platform.admin.email_verified** | A super-admin joined, or their email was marked verified (chapter 2). |
| **platform.mcp.client_authorized** | A super-admin approved an AI assistant (Claude or ChatGPT) (chapter 11). |
| **platform.mcp.client_revoked** | An AI assistant connection (Claude or ChatGPT) was disconnected (chapter 11). |
| **site.template_applied** / **site.template_undone** | A template was used or switched on a spa's site, or the switch or a version upgrade was undone (chapter 10). |
| **site.template_upgraded** | A roll out switched this spa to a new version of its template (chapter 12). |
| **site.design_seed** | **Fill the CRM from the design** changed the spa's treatments, therapists or photos (chapter 10). |
| **site.page.draft_saved** / **site.page.published** | A page's draft was saved in the editor, or one page was published. |
| **site.published** | **Publish site** published everything that was waiting. |
| **site.ai_texts_written** | **Write texts** drafted the texts of the site's pages (chapter 10). |
| **site.page.ai_edit** / **site.page.ai_edit_undone** | **Ask AI** changed a draft, or the change was undone. |
| **site.change_requested** / **site.change_resolved** | The spa sent a change request, or a super-admin closed it with **Mark done** (chapter 10). |
| **site.page.lock_taken_over** | A super-admin clicked **Take over** in the editor. |
| **site.mcp.** followed by a tool name | Claude or ChatGPT changed a website through the AI assistant connector, for the person under **By**. The entry also records "via AI assistant (MCP)" and the assistant's name (chapter 11). |

> **Important:** The audit log cannot be edited or cleared from the console. It is your record of what happened. Every action in the console is logged, including changes made while you view a spa's dashboard as super-admin.
