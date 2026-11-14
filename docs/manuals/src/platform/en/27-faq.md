# 27. Troubleshooting and FAQ

## What this is for

Quick answers when something looks wrong. Each answer says what is happening and where to fix it.

## Forms, email and sign-in

**Visitors see "We couldn't confirm you're not a robot".**
The bot check refused them. Most often the address they used is not in the Turnstile widget's hostnames in Cloudflare. Add the hostname there. If it happens on spas' own domains, either add those domains to the widget or untick **Also check spa custom domains** in **Company** (chapter 15).

**Password reset or verification emails don't arrive.**
Check the **RESEND_API_KEY (staff email)** row in **Configuration** on the Overview. If the key is missing, set it in **Company** → **Email (Resend)**, then click **Send test email to me** (chapter 15). If the test fails, read the reason in the message; often the sending domain is not **Verified** yet.

**ask@spamanagement.co no longer receives mail.**
Namecheap's **Mail Settings** may have been switched to **Custom MX**, which turns off Email Forwarding. Put the forwarding records back or ask Namecheap support (chapters 15 and 21).

**A spa says it can't get into its dashboard after applying.**
Its application is still waiting: after signing in, the owner only sees "Application received" and "Waiting for approval". Accept it in **Applications** (chapter 4). If the application was rejected, the owner sees "Application not approved".

**A new super-admin's verification email never arrived.**
Another super-admin can confirm the address in **Company** → **Super-admins** with **Mark email verified** (chapter 2).

## Spas and billing

**A spa says its dashboard is read-only.**
The spa is paused, or it is past the grace period of a late invoice. Open the spa and look at the **Account** card (chapter 6). If you paused it, click **Resume spa**: a payment does not end a pause you made by hand. If a late invoice caused it, full access comes back as soon as the payment is recorded or paid by card.

**Generate payment schedule says "Schedule is already up to date".**
All the invoices for the current period already exist. Nothing is missing (chapter 6).

**A spa has no invoices for its second year.**
Subscriptions don't renew by themselves. Set the next period in the spa's **Subscription** card, then click **Generate payment schedule** (chapter 6, "Renew a subscription after 12 months").

**Pay by card is missing on an invoice.**
Either the invoice is already partly paid (Stripe only charges a whole invoice), or the Stripe key is not on the server. Check the **STRIPE_SECRET_KEY (platform invoices)** row in **Configuration** (chapter 7).

**A plan can't be deleted.**
It is used by a spa or an application, or it is a built-in plan. It is archived instead, and you can restore it from **Archived plans** (chapter 8).

## Websites and domains

**A spa's domain stays Pending or Verifying.**
The spa's DNS records are missing, wrong, or not visible yet. Ask the spa to compare its records with its **Settings** → **Domains** page, wait a little, then click **Re-check** in **Domains** (chapter 13).

**The editor says "Changed elsewhere (an AI assistant or another editor)."**
Someone else, Claude or ChatGPT saved the page while you had it open. Click **Reload** to see their version, or **Keep mine** to keep yours (chapter 10).

**There is no Ask AI button in the editor.**
Either the AI key (ARK_API_KEY) is not on the server, or the page opened view-only because someone else is editing it. If the button is there but the panel says "AI site editing isn't enabled for your account", the server setting SITE_AI_EDITOR_EMAILS is a named list of addresses and your address is not on it or is not verified yet. On the live platform the setting is "*": every super-admin with two-step verification on may use Ask AI, and no verified email address is needed (chapters 10 and 11).

**There is no Write texts button on the Studio page, or it says "AI isn't set up yet".**
The button is only for AI site editors (SITE_AI_EDITOR_EMAILS) with two-step verification on, and only once the site has a template. On the live platform the setting is "*": every super-admin with two-step verification on sees it, and no verified email address is needed. Only if the setting is a named list of addresses must your address be on that list and verified. To verify it: **Company** → **Super-admins** shows **Not verified** next to an address that is not verified yet. While signed in, open admin.spamanagement.co/join, click **Send the link again** and open the link in the email (chapter 2). "AI isn't set up yet" means the ModelArk key (ARK_API_KEY) is not on the server: add it to the encrypted secrets file (chapter 24). If **Write texts** stops with the message "AI site editing is switched off in the AI model settings", tick **Enabled** for **Website Studio AI edits** in **AI models** (chapter 16).

**Write texts skipped a page.**
The result names the page and the reason. Pages with an HTML design are written too. A skipped page shows one of these reasons (chapter 10):
- "open in …'s editor": another super-admin has that page open. Ask them to leave it with **Back to console**, or wait a few minutes, then run **Write texts** again.
- "the draft uses another design": the page's draft changed to another design after the run was started. Run **Write texts** again.
- "no texts to write": the page has nothing Write texts can change, for example every text comes from the CRM. Nothing to do.
- "could not be saved — run again": run **Write texts** again.

**A therapist is missing on a spa's HTML-design site.**
**Show on website** is off, the therapist is not active, or there is no photo. The spa fixes it in **Team & roles** → **Staff**. **Fill the CRM from the design** can also set the photos (chapter 10).

**The area name on a spa's site is wrong.**
It comes from **Area shown on the website** of the main branch, in the spa's **Settings**. When it is empty, the site shows the city from the address (chapter 12).

**A section is empty or missing on a spa's site.**
On a design made for another spa, an empty CRM value stays empty and the design hides that part (chapter 12, "Designs connected to the CRM"). Ask the spa to fill it in its CRM, for example its logo, phone or opening hours.

**A spa says a booking from its website is not on its calendar.**
If the spa's site uses an HTML design connected to the CRM, a request sent from the design's own booking form is a **Booking request** in the spa's **Enquiries**, not a booking. The spa confirms it on WhatsApp and adds it to the calendar itself (chapter 12). Bookings made on the online booking page (the **Book** buttons) go straight to the calendar.

**Roll out left a spa as it was.**
The roll out names the reason for each spa. The table in chapter 12 ("Upload a new version and roll it out") says what to do for each one.

**An embedded video, map or booking widget stays blank.**
It runs inside the design's sandbox, where many players and widgets don't work. Use a plain link to it instead (chapter 12).

**The upload says the file is too large, or a video is too big.**
An HTML design can be up to 5 MB: compress the embedded images, or link videos by their https address. A video in **Website content** can be up to 8 MB (chapters 10 and 12).

**The Arabic page shows English words.**
That text has no Arabic yet. Run **Write texts**, or type the Arabic under **AR** in **Website content** (chapter 10). WhatsApp message texts stay English on purpose, because the spa's staff read them.

**A spa asks how to approve its new website.**
There is no approval step. You publish the site yourself, and the spa then sees it live on its **Website** page. If the owner wants to see it first, send a preview link from the editor's **Versions & preview** (chapter 10). Afterwards the spa asks for changes with **Request a change**.

**A spa's change request is not in the console.**
Open the spa in **Websites** and look at **Change requests**. A request someone already closed shows **Done** or **Declined** further down the list, with the note. The badge on **Websites** counts open requests only (chapter 10).

## AI

**A spa's AI features stopped.**
The spa has used its whole monthly AI budget, and the **AI usage** page shows **paused**. Raise its budget, or wait for the 1st of the next month (chapter 16). Also check that AI is not switched off for that spa (**AI off**) or for all spas (**Platform AI switch**).

**Claude or ChatGPT can't connect, or ChatGPT says invalid_client.**
Remove the connector in the assistant and add it again. The reasons the sign-in page can show are in chapter 11 ("If the assistant can't connect").

**ChatGPT asks me to confirm a change.**
That is normal for changes that edit or remove something. Check the change and confirm it (chapter 11).

## Server

**Last deploy says failed.**
The server already went back to the last good version, so the platform keeps working. Ask Claude to check the build log and fix the change (chapter 19).

**The Worker row is red.**
The background worker has not checked in for more than 10 minutes. Reminders, backups and alert emails are not running. Ask Claude to check the server (chapter 23).

**Off-site backup says overdue or missing.**
The backup bucket settings are missing or wrong, or the worker is down. Ask Claude to check them (chapter 22).

**I'm not sure whether a key is set.**
Look at the **Configuration** card on the Overview. It shows whether each setting is present, never its value. Never paste a key into a chat to check it (chapter 24).

> **Tip:** If none of these answers fits, write down what you see (the page, the message and the time) and ask Claude. A screenshot helps, as long as it shows no passwords or keys.
