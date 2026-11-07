# Glossary

## What this is for

Short explanations of the words used in this manual, in alphabetical order.

| Term | Meaning |
|---|---|
| **AI assistant connector** | The address https://app.spamanagement.co/api/mcp that lets Claude or ChatGPT edit spa websites as drafts. Only AI site editors with two-step verification can connect it (chapter 11). |
| **Application** | The form a new spa sends from spamanagement.co to join the platform. You accept or reject it in **Applications** (chapter 4). |
| **Area shown on the website** | The branch setting, with an optional Arabic version, that sets the area name an HTML-design website shows, for example "Dubai Marina, Dubai". Empty means the city from the address. Only the main branch's area is used. |
| **ARR** | Annual recurring revenue: the yearly value of all active subscriptions, shown on the Overview. |
| **Ask AI** | The AI helper in the page editor. It changes a page's draft when you describe the change. It never publishes. |
| **Audit log** | The record of every change made in the console and by super-admins in spa dashboards: who, what and when (chapter 17). |
| **Authenticator app** | A phone app (Google Authenticator, 1Password, Authy) that shows the 6-digit code for two-step verification. |
| **Automatic billing** | The daily check that moves a late spa through the stages overdue, grace period and read-only (chapter 7). |
| **Backup code** | A one-time code you can use instead of the authenticator app if you lose your phone. |
| **Billing rules** | The settings for when an invoice counts as overdue and how long the grace period lasts (**Company** → **Billing rules**). |
| **Booking request** | What a guest sends from the booking form of a website design that has its own form. It lands in the spa's **Enquiries** with the treatment, length, date, time, guests and therapist. It is not a booking: the spa confirms it on WhatsApp and adds it to the calendar. |
| **Built-in template** | One of the 23 website designs that come with the platform. |
| **Business date** | The day a sale or booking belongs to. It follows the spa's closing time, not midnight, so late-night sales count on the right day. |
| **Change request** | A website change a spa asks for from its **Website** page. You see it under **Websites** and close it with **Mark done**, as **Done** or **Declined**, with a note to the spa (chapter 10). |
| **CNAME / TXT record** | Two kinds of DNS record. A spa adds a TXT record to prove it owns its domain and a CNAME record to point the domain at its website. |
| **Configuration card** | The Overview card that shows whether each server setting is present, without ever showing its value. |
| **Console** | The platform console at admin.spamanagement.co, used only by super-admins. |
| **Contract design (CRM contract)** | An HTML design with a window.CRM_DATA block or a crm-endpoint tag. It takes each spa's name, logo, treatments, prices, team, phones, address, area and hours live from the spa's CRM. **CRM contract v2** is the current version (chapters 10 and 12). |
| **Conversion** | The share of website visits that ended in an online booking. |
| **Deploy** | An update of the platform's code on the live server (chapter 19). |
| **Design report** | The line shown for an HTML design on upload, on a new version and on the spa's **Pages** card. It says whether the design is connected to the CRM, how many values and page texts can change, and its warnings. It never blocks (chapter 12). |
| **DNS** | The internet's address book. DNS records tell browsers which server answers for a domain (chapter 20). |
| **Draft** | A saved version of a page that visitors cannot see yet. It goes live when you publish. |
| **Enquiry** | A message sent from the Contact page on spamanagement.co (chapter 5). |
| **Feature flag** | An on/off switch for a feature, with a default for every spa and optional per-spa overrides (chapter 14). |
| **Feature tier** | The set of features a spa has: Premium or Standard. A super-admin can grant Premium features to a spa billed at Standard, or the other way round, without changing the price. |
| **Fill the CRM from the design** | Copies an HTML design's treatments, photos, descriptions and team photos into a spa's CRM. Missing treatments can be created, with price on request; prices never change (chapter 10). |
| **Free address** | A spa's website address on spamanagement.co, for example saffron-spa.spamanagement.co. It always works. |
| **Global section** | A saved website section that appears on several pages. Edit it once and every page updates. |
| **Grace period** | The days after an invoice becomes overdue before the spa's dashboard turns read-only. |
| **HTML design** | A one-page website made outside the platform and uploaded as a file of up to 5 MB. It is stored and shown exactly as built. Its words and pictures can change per spa in **Website content**, and it is updated for all spas with a new version (chapters 10 and 12). |
| **Legacy plan** | **Yearly (legacy)**: the old AED 24,000 per year plan. Existing spas keep it until their renewal date; new spas cannot choose it. |
| **Namecheap** | The company where spamanagement.co is registered, and where you buy domains for spas. |
| **Off-site backup** | A copy of the database stored away from the server, so data survives if the server is lost (chapter 22). |
| **Own domain** | A domain the spa owns, for example www.theirspa.ae, used for its website instead of the free address. |
| **Payment plan** | How a subscription is invoiced: **12 monthly invoices** or **One-time annual**. |
| **Payment reminder** | A message you generate on a spa's page and send yourself by WhatsApp. It also shows the spa a red bar. |
| **Payment schedule** | All invoices of a subscription period, issued at once. |
| **Pause** | Making a spa's dashboard read-only, usually for late payment. Its website and online booking keep working. |
| **Phone fixes** | A switch for each HTML design. When it is on, the platform adds a phone viewport and keeps images and wide elements inside phone screens. It is off by default, so the design shows exactly as the file (chapter 12). |
| **Placeholder** | A word in double curly brackets, such as {{spa_name}} or {{crm_data_url}}, that each spa's own details replace in an HTML design. |
| **PLATFORM_ADMIN_EMAILS** | The server setting with the email addresses allowed to become super-admins. |
| **Plan** | What a spa pays and which features it gets: **Premium** (AED 14,000 setup + AED 3,000 per month) or **Standard** (AED 9,000 setup + AED 2,000 per month), excluding VAT. |
| **Preflight** | The checks that run before a page is published. Errors block publishing; warnings don't. |
| **Prepaid liability** | The value of gift cards, packages and memberships that clients have paid for but not used yet. |
| **Preview link** | A link that lets anyone see a page's draft without signing in. It expires after 1, 7 or 30 days. |
| **Primary domain** | The address a spa's website uses. When an own domain is primary, the free address sends visitors to it. |
| **Publish** | Making a page's draft live so visitors see it. Only super-admins publish; spas do not review or approve their site. |
| **Read-only** | A spa dashboard that can be viewed but not changed. The Billing page still works. |
| **Recorded, never processed** | The platform's payment rule: spas record what clients paid in cash, by their own card machine or by bank transfer. The CRM never charges a client. |
| **Red bar** | The red banner a spa sees when an invoice is overdue or a payment reminder is open. |
| **Resend** | The email service the platform uses to send staff emails, such as sign-in links and alerts (chapter 15). |
| **Restore drill** | The monthly test that restores the latest backup into a test database to prove backups work (chapter 22). |
| **RevPATH** | Revenue per available therapist hour: revenue without VAT divided by therapist hours. |
| **Roll out** | The sign-off of a waiting template version. It makes that version the template's version and switches every spa that is live on an older version at once. Their edits are carried, and each spa can **Undo** it on its Studio page (chapter 12). |
| **Sentry** | The service that collects error reports from the platform (chapter 23). |
| **Setup fee** | The one-off fee when a spa joins, billed as its own invoice. |
| **Show on website** | The switch for each therapist in the spa's staff form. Only people with it on (and, on HTML designs, with a photo) appear on the spa's website. It is off by default. |
| **SITE_AI_EDITOR_EMAILS** | The server setting that says which super-admins may use **Ask AI**, **Write texts** and the AI assistant connector (Claude or ChatGPT). On the live platform it is "*": every super-admin with two-step verification on; no verified email address is needed. If it is a named list of addresses, the address must be on the list and verified. |
| **Spa CRM / dashboard** | The spa's own system at app.spamanagement.co for bookings, clients, sales and more. |
| **Still from the design** | The box in **Website content** and in the Publish sheet that lists texts still showing the design's own spa, city, phone, email or filler text, or that have no Arabic yet. It doesn't block publishing (chapter 10). |
| **Studio template** | A website template you made yourself, by saving a spa's site, importing a file or uploading an HTML design. |
| **Stripe Checkout** | Stripe's secure payment page, used only by spas to pay your platform invoices by card. |
| **Subscription** | A spa's agreement with you: plan, price per 12 months, payment plan, period and status. |
| **Super-admin** | A person on your team with full access to the console. Needs a verified email and two-step verification. |
| **Template version** | A newer file of an uploaded HTML template. Uploaded with **Upload new version**, it waits for your sign-off before any spa uses it (chapter 12). |
| **Turnstile (bot check)** | Cloudflare's check that a person, not a robot, is filling a public form (chapter 15). |
| **Two-step verification** | Signing in with a password plus a 6-digit code from an authenticator app. Required for every super-admin. |
| **VAT** | Value added tax, 5 % by default. Plan prices exclude VAT; invoices add it. |
| **Web address** | The short name in a spa's free address and dashboard path, for example saffron-spa. It can be changed with **Rename**. |
| **Website content** | The words and pictures of one spa's HTML-design page, set over the design's own: scenes, booking and WhatsApp texts, page texts with the page title and search description, and pictures. It goes from draft to publish, in English and Arabic; the design file never changes (chapter 10). |
| **Website status** | Where a spa's site stands on the **Websites** page: **Not started**, **Template chosen**, **Draft** or **Live**, plus "Unpublished changes" (chapter 10). |
| **Website Studio** | The console page (**Websites**, then a spa) where super-admins design, edit and publish the spa's website. The page editor opens full screen (chapter 10). |
| **WhatsApp click-to-send** | The only way the platform contacts customers: it prepares a WhatsApp message and a person taps Send. |
| **Worker** | The background program on the server that runs scheduled jobs: reminders, billing checks, backups and more. |
| **Write texts** | The AI button on a spa's Website Studio page that drafts the texts of every page in English and Arabic from the spa's own details. It also writes the website content of HTML-design pages, and runs by itself after a switch to, or a roll out of, a design with CRM contract v2. It never publishes (chapter 10). |
