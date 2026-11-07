# 7. Billing from start to finish

## What this is for

This chapter explains how you invoice spas, how they pay you (cash, bank transfer or card), and what happens automatically when a spa pays late. It brings together the billing steps from chapters 4 and 6.

## How invoices are made

1. Each spa's subscription has a **price per 12 months** and a **payment plan**:
   - **12 monthly invoices**: the yearly price is split into 12 equal invoices. Premium, for example, is AED 36,000 per 12 months, so each month is AED 3,000 plus VAT.
   - **One-time annual**: one invoice for the whole year.
2. The setup fee is always its own invoice.
3. When you accept an application, all of the year's invoices are issued at once (chapter 4). For an existing spa, **Generate payment schedule** on the spa's page does the same (chapter 6).
4. VAT and the invoice number prefix come from **Company** → **Bank & invoicing** (chapter 15). VAT is 5 % by default. When you accept a spa, you can choose not to charge VAT on its setup invoice.
5. For anything else, create a one-off invoice with **New invoice** on the spa's page.
6. A subscription covers 12 months and does not renew by itself. When the period ends, set the next period on the spa's page and generate its invoices (chapter 6, "Renew a subscription after 12 months"). The **Overdue** card on the Overview counts the spas whose period has ended (**periods ended**, chapter 3).

> **Tip:** Prices on the plans exclude VAT. The invoices show the VAT on top, so a AED 3,000 month becomes AED 3,150 with 5 % VAT.

## Getting paid

There are two ways a spa can pay you.

**Bank transfer or cash**

1. The spa pays into your bank account, or hands over cash.
2. When the money has arrived, open the spa's page in the console.
3. Click **Mark paid** on the invoice, or use **Record a payment** for a part payment (chapter 6).

**Card (Stripe Checkout)**

1. The spa opens **Billing** in its dashboard. The page is called **Subscription**.
2. The spa clicks **Pay invoice by card** (on the plan card) or **Pay by card** next to an invoice.
3. Stripe's secure payment page opens. The spa pays there.
4. The invoice is marked paid on its own. The spa sees "Thank you — your card payment was received and the invoice is marked paid."

What the spa sees on its Billing page:

- **Your subscription**: the plan, the price, the payment plan, the renewal date and what is included.
- **Invoices**: every invoice with its number, description, dates, total and status.
- **How to pay**: your bank details from **Company** settings (**Bank**, **Account name**, **IBAN**, **SWIFT**) and a **Message us on WhatsApp** button.
- **Payment schedule**: each month (and the setup fee) with its due date and invoice number. A green dot means **Paid**, a red dot means **Must pay**, and **Balance due** means part of it is paid.
- **Payments received**: the payments you recorded, with **Date**, **Method**, **Reference** and **Amount**.

![What the spa sees on its Billing page.](../../../shots/platform/bill-spa-page.png)

*In the screenshot:*

1. **Your subscription**: the plan card.
2. **How to pay**: your bank details.
3. **Payment schedule** with the green (**Paid**) and red (**Must pay**) dots.
4. **Pay invoice by card**.

> **Important:** Card payment only works when the Stripe key (STRIPE_SECRET_KEY) is on the server. Check the **Configuration** card on the Overview (chapter 3). Without it, the spa sees "Card payments aren't switched on yet — pay by bank transfer or cash."

> **Important:** Stripe charges a whole invoice. A partly paid invoice has no card button; the spa pays the balance by bank transfer or cash. If a card payment arrives after you already recorded another payment, the payment is saved with the note "OVERPAID by AED …: refund or credit it". Refund or credit that amount yourself.

> **Tip:** Card payments are the only card payments on the whole platform. Spas never take their clients' cards through the CRM. Those payments are recorded, never processed.

## Late payments: red bar, grace, read-only

When a spa pays late, the platform reacts in stages. Nothing is ever charged automatically.

1. When an invoice is past its due date, every member of the spa sees a red bar at the top of the dashboard: "Invoice overdue — the dashboard becomes read-only on 15 Oct 2026 unless it is paid." (with the real date). The bar has a **Pay now** link to the Billing page.

   ![The red bar a late spa sees.](../../../shots/platform/bill-red-bar.png)

   *In the screenshot:*

   1. The red bar with the date the dashboard turns read-only.
   2. **Pay now**.

2. If the invoice is still unpaid after the grace period, the dashboard turns read-only. The spa can still open the Billing page and pay. The website and online booking keep working, so clients can still book.
3. As soon as the invoice is paid, the hold lifts automatically.
4. The spa owner and the super-admins get an email when the stage changes (when email is set up, chapter 15).

**Set the timing:**

1. Open **Company** and scroll to **Billing rules**.
2. Set **Overdue after (days past due)**. 1 means the day after the due date. You can choose 1 to 60 days.
3. Set **Grace period (days)**. It counts from the day the spa was first found overdue; after it, the dashboard turns read-only. You can choose 0 to 90 days.
4. Click **Save billing rules**. A message confirms "Billing rules saved".

   ![Company → Billing rules.](../../../shots/platform/bill-rules.png)

   *In the screenshot:*

   1. **Overdue after (days past due)**.
   2. **Grace period (days)**.
   3. **Save billing rules**.

> **Tip:** The rules run every day at 09:05 Dubai time. The defaults are overdue after 1 day and a grace period of 7 days.

> **Tip:** To stop the automatic stages for one spa, use **Pause automatic transitions** on its page (chapter 6). To stop them for every spa, turn off the flag **billing.autoTransitions** in **Feature flags** (chapter 14).

> **Important:** A payment reminder (chapter 6) also shows the red bar at once, even before the automatic stages start. Use it when you want to remind a spa yourself.
