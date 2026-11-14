# 15. Company settings: details, email, bot check

## What this is for

The **Company** page holds your company details for invoices and the spa Billing page, the staff email service (Resend), the bot check on public forms, the billing rules and the super-admin list. Set it up once, then come back only when something changes.

Click **Company** in the sidebar. The page shows these cards, from top to bottom:

- **Email (Resend)**, with **Sending domain** at the bottom of the card.
- **Bot check (Cloudflare Turnstile)**.
- **Billing rules** (chapter 7).
- **Super-admins** (chapter 2).
- Your company details: **Company**, **Contact**, **Bank & invoicing** and **Data retention**.

## Company, contact and bank details

The details at the bottom of the page appear on your invoices and on each spa's **Subscription** (Billing) page.

1. Click **Company** in the sidebar and scroll to the bottom of the page.
2. In the **Company** card, fill in:
   - **Brand name**: the name spas see, for example spamanagement.co.
   - **Legal name**: your company's registered name.
   - **Trade licence no.**
   - **TRN**: your 15-digit VAT number.
   - **Website**.
   - **Address**.
3. In the **Contact** card, fill in:
   - **Email**: use **ask@spamanagement.co**.
   - **Phone**.
   - **WhatsApp**: "Shown to spas for billing questions".
4. In the **Bank & invoicing** card ("Spas see these details on their subscription page."), fill in:
   - **Bank**, **Account name**, **IBAN** and **SWIFT**.
   - **Invoice prefix**: up to 8 capital letters or numbers. For example, **SM** gives invoice numbers like SM-2026-0001.
   - **VAT rate (%)**: 5 by default.
   - **Domain markup (USD)**: "Added once to every domain order on top of the registrar price." (chapter 13).
   - **Plan prices already include VAT**: tick this only if your plan prices include VAT. Leave it unticked when your prices are excl. VAT, as they are today.
5. In the **Data retention** card, set **Auto-purge deleted spas after (days)**. Leave it blank to keep it **Off**. If you set it, it must be at least 30 days, "so the spa can still get its data export". It runs every day at 04:30.
6. Click **Save company details**. A message confirms "Company details saved".

   ![Company details.](../../../shots/platform/co-form.png)

   *In the screenshot:*

   1. The **Company** card.
   2. The contact **Email**: ask@spamanagement.co.
   3. **Bank & invoicing**.
   4. **Data retention**.
   5. **Save company details**.

> **Tip:** The screenshot shows demo values (a demo IBAN, a demo TRN). Type your real company details on the live platform.

> **Important:** The only spamanagement.co email address used anywhere is **ask@spamanagement.co**. Don't enter a personal address in **Email**: spas and website visitors see it.

## Staff email (Resend)

The platform sends staff email through a service called Resend: invites, password resets, email verification, alerts, and notices about new applications and enquiries. Spa customers never get email (chapter 21).

1. In Resend, open **API Keys** and create a key with **sending access**.
2. In the console, click **Company**. The **Email (Resend)** card is at the top.
3. Paste the key in **Resend API key**. The key starts with **re_**.
4. Leave **From address** blank. The platform then sends as **spamanagement.co <ask@spamanagement.co>**.
5. Click **Save email settings**. A message confirms "Email settings saved".
6. Click **Send test email to me**. A message says "Test email sent to" followed by your own address. Check your inbox.

   ![Email (Resend).](../../../shots/platform/co-email-card.png)

   *In the screenshot:*

   1. The badge that says where the key comes from, here **key from env**.
   2. **Resend API key**.
   3. **From address**.
   4. **Send test email to me**.

The badge at the top of the card means:

- **key from console**: you saved a key on this page. It wins over the key on the server.
- **key from env**: no key is saved on this page, so the server's own key (RESEND_API_KEY) is used. The field then says "Not set here; the server env key is used." This is what the screenshot shows.
- **key missing** (red): there is no key anywhere. Without a key, the live platform refuses to send email, so sign-up verification and password reset fail.

After you save a key, the field shows **Set ✓** and the last 4 characters of the key: "Leave blank to keep it." To go back to the server's key, tick **Remove the stored key (fall back to env)** and click **Save email settings**.

> **Important:** The key is write-only. It is stored encrypted and is never shown again, logged or written to the audit log. Never paste the key into a chat or an email.

> **Tip:** If the test email fails, the message starts with "Test email failed:" and gives Resend's reason. The most common reason is that the sending domain is not verified yet (next section).

## Set up the sending domain

Resend only sends from a domain you have verified. The **Sending domain** part at the bottom of the **Email (Resend)** card does this for spamanagement.co. It adds the domain to Resend and lists the DNS records you copy into Namecheap.

> **Important:** Read this before you start. One of Resend's records is an **MX** record. At Namecheap, an MX record needs **Mail Settings = Custom MX**, and that switches off **Email Forwarding**. Then **ask@spamanagement.co stops receiving mail**. Before you switch:
> - Write down the current Email Forwarding records.
> - Ask Namecheap support how to keep forwarding working next to Resend's MX record, or move ask@ to another forwarding service first.
> - Afterwards, send a test mail to ask@spamanagement.co.

1. Save a Resend API key first (previous section). Without one, the card says "Save a Resend API key above first."
2. Click **Set up sending domain**. A message says "spamanagement.co added to Resend. Add the DNS records below in Namecheap." If the domain is already in Resend, it says "spamanagement.co is already in Resend. Its DNS records are below."
3. If a field called **Full-access key for setup** appears, your saved key only has sending access. In Resend, create a second key with **Full access**, paste it in this field and click **Set up sending domain** again. This key is "never stored, logged or shown". If you reload the page, paste it again.
4. A table of records appears with the columns **Type**, **Host**, **Value**, **Priority**, **TTL** and **Status**. The **Host** is written the way Namecheap wants it, for example **send** or **resend._domainkey**. Each **Value** has a **Copy** button. The **TTL** is **Automatic**.
5. In Namecheap, open **Domain List** → spamanagement.co → **Manage** → **Advanced DNS** and add each record exactly as shown (chapter 20).
6. Back in the console, click **Check verification**. Resend checks in the background, so the first answer is often "Resend is still checking the records. Click Check verification again in a minute."
7. Click **Check verification** again a minute later. Repeat until the badge says **Verified** and the card says "Sending works: staff email goes out from" your From address. It usually takes up to 15 minutes after you add the records, and at most 72 hours.
8. In Resend, delete the full-access key if you made one.
9. Click **Send test email to me**. Also send a test mail to ask@spamanagement.co from another mailbox.

   ![The Sending domain buttons.](../../../shots/platform/co-sending-records.png)

   *In the screenshot:*

   1. **Set up sending domain**.
   2. **Check verification**.

   The demo copy does not connect to Resend, so the picture shows the buttons only. On the live platform, the table of records appears under the buttons after step 2. The **MX** row has an orange note under its value: "Namecheap: an MX record on a subdomain needs Mail Settings = Custom MX, which turns off Email Forwarding (ask@spamanagement.co stops receiving)."

The status badge can read **Not started**, **Pending**, **Verified**, **Partially verified**, **Partially failed**, **Failed** or **Temporary failure**. If it is not **Verified**, fix the rows that are not marked **Verified** and click **Check verification** again.

> **Tip:** A new domain is created in Resend's eu-west-1 region. You don't need to choose anything.

## Bot check on public forms (Cloudflare Turnstile)

The bot check stops automated spam on the public forms: online booking, the booking widget, the website Enquiry form, **Apply** and **Contact**. It uses Cloudflare Turnstile, which is free and does not need Cloudflare DNS. Most visitors never see it; Cloudflare only asks for a click when it is unsure.

1. In the Cloudflare dashboard, open **Turnstile** and click **Add widget**.
2. Name it "spamanagement forms". Choose **Widget mode: Managed** and pre-clearance **No**.
3. Under hostnames, add **spamanagement.co**. This also covers app., admin. and every spa's {slug}.spamanagement.co address.
4. Cloudflare shows a **Site key** and a **Secret key**. The secret is shown once, so keep the page open.
5. In the console, click **Company** and find **Bot check (Cloudflare Turnstile)**.
6. Paste the **Site key** and the **Secret key**.
7. Leave **Also check spa custom domains** unticked, unless you have added every spa's own domain to the widget's hostnames in Cloudflare.
8. Click **Save bot check**. A message confirms "Bot check settings saved". It works at once; no deploy is needed.

   ![Bot check keys.](../../../shots/platform/co-turnstile-card.png)

   *In the screenshot:*

   1. **Site key**.
   2. **Secret key**.
   3. **Also check spa custom domains**.
   4. **Save bot check**.

   In the demo copy the keys come from the server, so the badge reads **from env** and both fields say "Not set here; the server env key is used." After you save keys here, the secret field shows **Set ✓** and its last 4 characters.

To go back to the keys on the server, tick **Remove the stored keys and switch (fall back to env)** and click **Save bot check**.

> **Important:** **Also check spa custom domains** only works for domains you have added to the widget's hostnames in Cloudflare. If you tick it and a domain is missing there, bookings on that domain are refused. When it is off, spa custom domains have no bot check, but they keep working. The free Cloudflare plan limits how many hostnames one widget can have.

> **Tip:** Without both keys the forms stay open, protected only by a hidden spam trap and limits per network, and the **Configuration** card on the Overview shows **TURNSTILE_\* (bot check)** in red (chapter 3). A visitor who fails the check sees "We couldn't confirm you're not a robot" and nothing is saved.

To test it, open a spa's booking page and book a test slot.

## Card payments (Stripe)

Spas can pay your platform invoices by card through Stripe Checkout (chapter 7). Stripe has no field on the Company page; its key lives on the server.

1. Create a Stripe account for your company.
2. In Stripe, find the **secret key**.
3. Add it as STRIPE_SECRET_KEY to the encrypted secrets file (chapter 24, "Add or change a secret"). Never paste the key into a chat.
4. After the next deploy, the **Configuration** row **STRIPE_SECRET_KEY (platform invoices)** on the Overview turns green.
5. Spas now see **Pay invoice by card** on their Billing page.

> **Tip:** Stripe needs no webhook. After paying, the payer comes back to the same domain they paid from.

> **Important:** Stripe is used for your platform invoices only. Spas never take their clients' cards through the CRM: spa payments are recorded, never processed.
