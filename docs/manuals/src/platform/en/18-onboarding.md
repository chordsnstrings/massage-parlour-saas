# 18. Onboarding a new spa, end to end

## What this is for

A checklist that takes a new spa from its first application to a live website and the first invoice paid. Each step points to the chapter with the details.

## The checklist

1. **The spa applies.** The spa owner fills in the application form on spamanagement.co (chapter 4). You get an email about the new application, and the **Applications** badge in the sidebar goes up by one.
2. **Call the spa.** The phone number is on the application. Agree the plan (**Premium** or **Standard**), the start date, any discount and how the setup fee will be paid.
3. **Accept the application.** In **Applications**, open it and click **Accept**. Choose the plan, the discounts, the start date and the setup payment, then click **Accept and create spa** (chapter 4).
4. **The owner signs in.** The owner gets an email with a link to sign in at app.spamanagement.co. They must set up two-step verification the first time.
5. **The owner sets up the CRM.** The owner adds services, prices, team members, rooms and opening hours. The owner also switches on **Show on website** for the therapists who should appear on the website (each with a photo), and checks **Area shown on the website** in **Settings**. The Spa Owner's Manual explains each screen.
6. **Build the website.** Click **Websites**, then the spa's **Choose template** button (or **Edit website** on the spa's page). Choose a template. If the spa has an old website, then click **Import from website** in **Pages** to bring its content in as a draft page. Click **Write texts** to draft every page in English and Arabic from the spa's own details. Read and adjust each page in the editor, then click **Publish site** (chapter 10). There is no approval step for the spa: send the owner a preview link first if they want to see the site before it goes live.

   For an HTML design connected to the CRM: **Apply** it (**Use {template}** on a new site). With **CRM contract v2**, Write texts drafts its texts by itself (check the line on the **Pages** card; if it says skipped, click **Write texts**). If the card **Next: fill the CRM from the design** appears, click **Fill the CRM from the design**. Open each page's **Website content** until nothing is "still from the design". Send the owner a preview link, then click **Publish site** (chapters 10 and 12).
7. **Optional: the spa's own domain.** The spa connects its own domain in its **Settings** → **Domains**. Check it in **Domains** in the console (chapter 13).
8. **Premium only: Instagram and Google.** The spa connects Instagram and Google in its own **Settings**. The one-time platform setup is in chapter 25.
9. **Check the spa's page.** Click **Spas** and open the new spa. Check the plan, the invoices and the setup payment (screenshots below).
10. **Record each later payment** when the money arrives, with **Mark paid** or **Record a payment** (chapters 6 and 7).
11. **Renew after 12 months.** The subscription does not renew by itself. Shortly before the period ends ("until …" in the **Spas** list), set the next period in the **Subscription** card and click **Generate payment schedule** (chapter 6, "Renew a subscription after 12 months"). Put a reminder in your calendar for the date.

## Check the new spa's page

Right after you accept, open the spa from **Spas**.

1. At the top, the badge reads **ACTIVE**, with the spa's web address name and the date it joined.
2. **Plan & features** shows the plan and its price, for example "Standard setup AED 9,000 + AED 2,000/month · excl. VAT", and what the plan includes. Check that it is the plan you agreed.

   ![A new spa: the plan.](../../../shots/platform/onb-new-spa-top.png)

   *In the screenshot:*

   1. **Plan & features**: the plan, the price and the included features.
   2. **Edit website**: opens the spa's Website Studio (chapter 10).

3. Scroll down to **Invoices**. The card says how much is outstanding in total.
4. Check that all the subscription invoices are there: 12 monthly invoices, or 1 yearly invoice. Each one is **issued**, with its own due date.
5. Find the **One-time setup fee** row. If the spa paid a deposit, it reads **part paid**, with the amount paid and the balance. If the spa paid in full, it reads **paid**. An unpaid invoice past its due date reads **overdue**.

   ![A new spa's invoices.](../../../shots/platform/onb-new-spa-page.png)

   *In the screenshot:*

   1. The subscription invoices, each **issued** with its own due date.
   2. The **One-time setup fee** row: AED 4,000 paid, AED 5,450 still due, **part paid**.

The screenshot shows Lotus Bay Spa, a demo spa on the **Standard** plan that paid a deposit. The setup fee of AED 9,000 plus 5 % VAT makes AED 9,450. The deposit was AED 4,000, so AED 5,450 is due by the balance due date. Each monthly invoice is AED 2,000 plus VAT, so AED 2,100.

> **Important:** Payments are **recorded, never processed**. When the balance arrives in cash or by bank transfer, record it yourself on the setup fee invoice (chapter 6). Spas can also pay an invoice by card through Stripe, but only an invoice with no payment on it yet (chapter 7). A part-paid balance like this one is paid by bank transfer or cash.

> **Tip:** Owners and managers must use two-step verification by default. The owner sets it up with an authenticator app on their phone the first time they sign in.

> **Tip:** The plan prices are: **Premium** AED 14,000 setup + AED 3,000 a month, and **Standard** AED 9,000 setup + AED 2,000 a month, both excl. VAT. Spas that joined on the old yearly price keep AED 24,000 a year until their renewal (chapter 6).
