# 6. Spas: managing each customer

## What this is for

Each spa has one page in the console with everything about it: plan and features, subscription, invoices and payments, reminders, pausing, renaming and deleting. This chapter walks through that page from top to bottom.

## The Spas list

1. Click **Spas** in the sidebar. The page says "Whole-spa totals only — no client data."
2. To find a spa, type in **Search by name or address**.
3. Click a column heading to sort by it. Click it again to reverse the order.
4. The columns are:
   - **Spa**: the spa name, its address and the date it joined (**Joined**).
   - **Status**: for example **trial**, **active**, **paused** or **deleted**. A late invoice adds a note, for example "Grace · read-only from 15 Oct".
   - **Plan**: the plan and when the current period ends. A grey tag shows the feature tier when the plan name does not. A green tag with an arrow (for example **→ Premium**) means a super-admin changed the spa's features (a feature tier override).
   - **Sign-in**: the newest sign-in by a team member.
   - **Booking**: the newest booking made.
   - **Bookings 30 d**: bookings made in the last 30 days, from any source.
   - **Team**: active team members.
   - **Storage**: uploaded files.
   - **AI this month**: AI spend this month against the spa's monthly AI budget, for example "$18.40 / 25". From 70 % it also shows the percentage in amber, and at 100 % in red.
5. Amber dates mean there has been no staff sign-in for 14 days or more, or no booking for 30 days or more. Such a spa may need a call.
6. Click **What the columns count** under the table for a short explanation of each column.
7. Click a spa to open its page.

   ![Every spa with usage and status.](../../../shots/platform/spas-list-shot.png)

   *In the screenshot:*

   1. **Search by name or address**.
   2. The sortable headings (here sorted by **Joined**, newest first).
   3. A late invoice note (**Grace · read-only from 15 Oct**).
   4. A feature tier override tag (**→ Premium**).
   5. **AI this month**.

> **Tip:** On a phone, the list shows one card per spa. Choose a column in **Sort by** and tap **Sort**. The button under it (for example **Newest first**) reverses the order.

![The Spas list on a phone.](../../../shots/platform/spas-list-phone.png)

*In the screenshot:*

1. **Search by name or address**.
2. **Sort by**.
3. **Sort**.

> **Tip:** The list shows the first 200 spas. Use the search box to find any other spa.

## Open a spa's website or dashboard

1. At the top of a spa's page, click **Edit website** to open this spa's Website Studio in the console (chapter 10). There you build, edit and publish the site, and answer the spa's change requests.
2. Click **Website** to open its live website in a new tab.
3. Click **Open dashboard** to open the spa's CRM in a new tab, as a super-admin.
4. The dashboard shows a banner at the top: "Viewing as super-admin — every change is recorded in the audit log."

   ![A spa's dashboard opened by a super-admin.](../../../shots/platform/spas-impersonation.png)

   *In the screenshot:*

   1. The **Viewing as super-admin** banner.

> **Tip:** The dashboard is on app.spamanagement.co. If you are not signed in there yet, sign in with the same super-admin login and two-step code. The dashboard's **Website studio** page sends super-admins to the console's Website Studio.

> **Important:** Changes you make in a spa's dashboard are real. Use it to help a spa, for example to fix a price or check a setting, and tell the spa what you changed.

## Plan & features: switch plan, discounts, feature tier

The **Plan & features** card shows the spa's plan, its price (excl. VAT) and the features the spa has. Every change here is written to the audit log with the old and the new value.

**Switch to another plan:**

1. Choose the new plan in **Switch plan**.
2. Optional: tick **Re-issue unpaid invoices that aren't due yet at the new price**. Leave it unticked to keep the invoices already issued as they are.
3. Click **Switch plan**. A message confirms it, for example "Plan switched to Premium."

**Give a discount:**

1. Under **Setup fee discount** and/or **Monthly fee discount**, choose **%** or **AED** and type the amount.
2. Optional: tick **Re-issue unpaid invoices that aren't due yet**.
3. Click **Save discounts**.

**Change the features without changing the price:**

1. In **Feature tier**, choose **Follow the plan**, **Grant Premium features** or **Standard features only**.
2. Click **Save feature tier**. Billing stays on the plan's price.

   ![Plan & features for one spa.](../../../shots/platform/spas-plan-card.png)

   *In the screenshot:*

   1. The plan and its price.
   2. The **Premium features granted** badge: this Standard spa has Premium features.
   3. **Switch plan**.
   4. The discounts.
   5. **Feature tier**.

> **Important:** Discounts are applied when invoices are made (the setup invoice and the payment schedule). Invoices that are already issued keep their amounts, unless you tick the re-issue box.

> **Tip:** Premium features are AI & Instagram automation, marketing tools and more branches. Standard has none of these and one branch only.

### A spa on the old yearly plan

Spas that joined before the new prices are on **Yearly (legacy)** at AED 24,000 per year. They keep it until their renewal date.

1. The card shows the badge **legacy until renewal**. Before the renewal window opens, it says from which date you can choose the new plan.
2. From 30 days before the renewal date, a notice explains the renewal. Choose the plan in **New plan at renewal**.
3. Click **Choose plan for renewal**. The new plan starts a new 12-month period on the renewal date. There is no setup fee.
4. Click **Generate payment schedule** in the **Invoices** card to issue the new period's invoices.

   ![Moving a legacy AED 24,000/year spa to a new plan at renewal.](../../../shots/platform/spas-legacy-renewal.png)

   *In the screenshot:*

   1. The **legacy until renewal** badge.
   2. The renewal notice.
   3. **Choose plan for renewal**.

> **Important:** Nothing is charged or moved automatically at renewal. You choose the plan and generate the invoices yourself.

## Subscription details

1. Scroll to the **Subscription** card ("Price, period and status. Changes apply immediately.").
2. Change what you need:
   - **Status**: **trialing**, **active**, **past due** or **cancelled**.
   - **Price per 12 months (AED)**: the agreed price for the period. For a monthly plan, this is 12 × the monthly fee (for example 3,000 → 36,000).
   - **Setup fee (AED)**: the one-off fee, billed as its own invoice.
   - **Payment plan**: **One-time annual** or **12 monthly invoices**.
   - **Period start** and **Period end**. The end must be after the start.
   - **Notes**.
3. Click **Save subscription**. A message confirms "Subscription saved".

   ![Subscription details.](../../../shots/platform/spas-subscription-card.png)

   *In the screenshot:*

   1. **Status**.
   2. **Price per 12 months (AED)**.
   3. **Payment plan**.
   4. **Save subscription**.

> **Tip:** The plan itself is not changed here. The card says "Change it with Switch plan above."

## Invoices: schedule, new invoice, mark paid

**Issue the year's invoices:**

1. In the **Invoices** card, click **Generate payment schedule**. It issues the current period's plan invoices (12 monthly invoices or 1 yearly invoice) and the setup fee invoice.
2. A message says how many invoices were created. If everything is already there, it says "Schedule is already up to date".
3. If you changed the **Payment plan** (monthly or annual), it cancels the unpaid invoices of the old payment plan and issues the new ones.

> **Important:** If an invoice of the old payment plan is already paid for this period, the schedule is refused: "Invoices of the other payment plan are already paid for this period — mark them unpaid or void them first".

**Bill something else:**

1. In the **New invoice** card, fill **Description**, **Amount (AED)**, **Issue date** and **Due date**.
2. Click **Create invoice**. VAT is added from your company settings (chapter 15).

**Mark an invoice paid or unpaid:**

1. In the **Invoices** table, click **Mark paid** when the money for that invoice has arrived. It records a payment for the open balance.
2. Clicked by mistake? Click **Mark unpaid**. It records a reversing payment, so the history stays complete.

   ![The spa's invoices.](../../../shots/platform/spas-invoices-table.png)

   *In the screenshot:*

   1. **Generate payment schedule**.
   2. The **Paid** and **Balance** columns.
   3. The **part paid** badge: some of the money has arrived.
   4. **Mark paid**.

The status badges mean:

- **issued**: sent, not paid yet, not due yet.
- **part paid**: some money has arrived; the rest is in **Balance**.
- **overdue**: past its due date and not fully paid.
- **paid**: fully paid.
- **void**: cancelled (for example replaced by a re-issued invoice).

The card's description shows **Due now** (open balances whose due date has come) and **Outstanding** (all open balances, including later instalments).

> **Tip:** Invoice numbers use the prefix from **Company** → **Bank & invoicing**, for example SM-2026-0001.

> **Important:** Only super-admins mark invoices paid or unpaid. The spa only sees the result.

## Renew a subscription after 12 months

Premium and Standard subscriptions do not renew by themselves. **Generate payment schedule** only issues the invoices of the current period. After the first 12 months, no new invoices are issued until you set the next period.

You see that a period has ended in two places:

- In the **Spas** list, the **Plan** column shows "until …" with the end date of the current period.
- On the **Overview**, the **Overdue** card says how many **periods ended** (chapter 3).

1. Open the spa and scroll to the **Subscription** card.
2. Set **Period start** to the old **Period end** date.
3. Set **Period end** to 12 months later. For example: the old period ended on 1 Oct 2026, so the new period runs from 1 Oct 2026 to 1 Oct 2027.
4. If you agreed a new price with the spa, change **Price per 12 months (AED)**.
5. Click **Save subscription**. A message confirms "Subscription saved".
6. In the **Invoices** card, click **Generate payment schedule**. It issues the new period's invoices: 12 monthly invoices or 1 yearly invoice. The setup fee is not billed again, and the spa's discounts still apply.

> **Tip:** Renew a little before the period ends. Then the first invoice of the new period is ready on time.

> **Important:** A spa on **Yearly (legacy)** renews differently: choose its new plan with **Choose plan for renewal** (see "A spa on the old yearly plan" above).

## Record a payment

Use this when a spa pays part of an invoice, or pays by a method you want to note.

1. In **Record a payment** ("Cash or bank transfer received."), enter the **Amount (AED)**.
2. Choose the **Method**: **Bank transfer**, **Cash**, **Credit card** or **Other**.
3. Check **Received on** and type a **Reference**, for example the bank transfer number.
4. Choose the invoice in **Against invoice**. Each choice shows the invoice total and its balance.
5. Click **Record payment**.

   ![Recording a part payment by bank transfer.](../../../shots/platform/spas-record-payment.png)

   *In the screenshot:*

   1. **Amount (AED)**.
   2. **Method**.
   3. **Against invoice**.
   4. **Record payment**.

6. A message confirms it. A part payment leaves the rest as balance due, for example "Payment recorded · balance due AED 1,650".
7. Every payment appears in the **Payments** card: **Date**, **Method**, **Reference** and **Amount**.

> **Tip:** Type the amount actually received. An amount above the balance is recorded as it is, without a warning, so check it before you click **Record payment**.

> **Tip:** When the last late invoice is paid, the red bar and an automatic billing hold (the **overdue**, **grace period** or **read-only** stage) lift automatically. A spa you paused by hand stays paused until you click **Resume spa**.

## Send a payment reminder

1. Open the spa (for example from **Payments overdue** on the Overview).
2. In the **Account** card, click **Generate payment reminder**.
3. A message confirms: "Reminder created — the spa sees it now. Send the message below." From now on the spa sees a red bar in its dashboard.
4. A ready message appears below, listing the late invoices and the total.
5. Click **Send on WhatsApp**. WhatsApp opens with the message to the spa's phone number. Check it and tap Send yourself.
6. Or click **Copy message** and paste it wherever you like, for example into an email.

   ![A payment reminder ready to send on WhatsApp.](../../../shots/platform/spas-reminder-shot.png)

   *In the screenshot:*

   1. **Generate payment reminder**.
   2. The reminder message.
   3. **Send on WhatsApp**.
   4. **Copy message**.

7. Under the buttons, the card shows "Open reminder since …" with the amount.

> **Important:** Nothing is sent automatically. If the spa has no phone number on file, WhatsApp asks you to pick the contact.

> **Tip:** The reminder closes by itself when the last overdue invoice is paid.

## Pause, resume and automatic billing

The **Account** card shows how many invoices are overdue and the total.

1. Click **Pause spa** to make the spa's dashboard read-only with a notice. The website and online booking keep working. A message confirms it, for example "Desert Rose Day Spa paused". The spa stays paused until you click **Resume spa**. A payment does not lift a pause you made by hand.
2. To undo, click **Resume spa**.
3. **Automatic billing** shows the stage of a late spa: **overdue**, **grace period** (with the date the dashboard turns read-only) or **read-only**. "nothing late." means all is well. The line under it shows the rules, for example "Late 1 day after the due date → overdue, then 7 days' grace → read-only".
4. Click **Pause automatic transitions** to stop the automatic stages for this spa only. The badge **transitions paused** appears. **Resume automatic transitions** turns them back on.
5. Click **Check now** to apply the rules straight away instead of waiting for the daily check. The message shows the change, for example "Billing stage: overdue → grace".

   ![Pausing a spa and its automatic billing.](../../../shots/platform/spas-account-card.png)

   *In the screenshot:*

   1. **Pause spa**.
   2. The **Automatic billing** stage.
   3. **Pause automatic transitions**.
   4. **Check now**.

6. The **Access** card ("Read-only keeps the website live but blocks changes.") lets you set the spa's status directly. Choose one and click **Update**:
   - **trial** and **active**: the normal states. The team can work as usual.
   - **past due**: the team can still work. Automatic billing normally sets it for a late spa, so you rarely choose it yourself.
   - **read only**: the same as **Pause spa**. The dashboard is read-only; the website and online booking keep working.
   - **suspended**: the dashboard is read-only and online booking is off. The website stays up, but it is taken out of search results.
   - **cancelled**: the same as suspended, for a spa that has left. Its website stays in search results.

   Automatic billing leaves suspended and cancelled spas alone.

> **Important:** A paused spa can still open its Billing page and pay by card. Paying lifts an automatic billing hold by itself. A spa you paused with **Pause spa** (or set to **read only**) stays paused until you click **Resume spa**.

> **Tip:** For a late payer, use **Pause spa**, not **suspended** or **cancelled**. Those also stop online booking, so the spa's clients are affected.

> **Tip:** The timing rules are set in **Company** → **Billing rules** (chapter 7).

## Change a spa's web address

The web address is the spa's free website address (for example palm-serenity-spa.spamanagement.co). It is also the path of its dashboard.

1. In the **Web address** card, type the **New address**.
2. Click **Rename**.
3. A message confirms it, for example "Address changed to palm-serenity-spa — palm-spa now redirects to it".

   ![Renaming a spa's address.](../../../shots/platform/spas-rename-card.png)

   *In the screenshot:*

   1. **New address**.
   2. **Rename**.
   3. The previous addresses, with the date of the rename and how long each stays reserved.

> **Important:** The old address keeps sending visitors to the new one and stays reserved for this spa for 12 months. Tell the spa, so they can update printed QR codes and links.

## Delete, restore or permanently delete

**Delete a spa (data is kept):**

1. Scroll to the bottom of the spa's page.
2. In **Delete spa**, click **Download full export** and keep the file safe.
3. Type the spa's address in the confirm box (for example "Type saffron-spa to confirm").
4. Click **Delete spa**. The dashboard, website and booking close. Every record is kept. A message confirms it, for example "Saffron Spa deleted (data kept — Resume restores it)".

   ![Deleting a spa keeps its data.](../../../shots/platform/spas-delete-card.png)

   *In the screenshot:*

   1. **Download full export**.
   2. Type the address to confirm.
   3. **Delete spa**.

**Bring a deleted spa back:**

1. Open the deleted spa. Its badge reads **deleted**.
2. In the **Account** card, click **Restore spa**.

   ![A deleted spa: Restore spa in the Account card.](../../../shots/platform/spas-purge-restore.png)

   *In the screenshot:*

   1. **Restore spa**.

**Erase a spa for good:**

1. Open the deleted spa and scroll to **Permanently delete** at the bottom.
2. Click **Download full export** first, if you have not already.
3. Type the spa's address in the confirm box ("Type … to permanently delete").
4. Click **Permanently delete**.

   ![A deleted spa: erase it for good.](../../../shots/platform/spas-purge-card.png)

   *In the screenshot:*

   1. **Download full export**.
   2. The confirm box.
   3. **Permanently delete**.

> **Important:** Permanent deletion cannot be undone. It removes the spa's clients, bookings, sales and ledger, files, website, own domains, integrations and the spa's audit log. Only a short purge record is kept: who did it, when, and how many records were removed.

> **Tip:** You can also have deleted spas erased automatically after a number of days (at least 30) in **Company** → **Data retention** (chapter 15). It runs every day at 04:30.

## Team and recent activity

1. **Team** lists the spa's members with **Name**, **Role** and **Status**.
2. **Recent activity** shows the latest audited events for this spa. A new spa shows "Nothing yet."
