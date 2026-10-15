# 1. Welcome: how the platform fits together

## What this is for

This chapter is a one-page map of spamanagement.co. It shows who uses which address and the rules the whole platform is built on. Read it once before the other chapters.

## The four addresses

1. **spamanagement.co** is the marketing site. Its top menu has **Features**, **Spa CRM**, **Website studio**, **Pricing** and **Contact**. New spas click **Apply for your spa** (or **Get started**) to send an application.
2. **app.spamanagement.co** is the spa CRM. Spa owners and staff sign in here.
3. **admin.spamanagement.co** is your platform console. Only super-admins can open it. You also open each spa's Website Studio here.
4. Each spa's website lives at **{slug}.spamanagement.co** (for example saffron-spa.spamanagement.co) until the spa connects its own domain. Once the spa's own domain is active and set as primary, the spamanagement.co address sends visitors on to the own domain automatically.

   ![The marketing site at spamanagement.co, where new spas find you and apply.](../../../shots/platform/intro-marketing-home.png)

   *In the screenshot:*

   1. The top menu: **Features**, **Spa CRM**, **Website studio**, **Pricing** and **Contact**.
   2. The **Apply for your spa** button. It opens the application form on app.spamanagement.co/signup.

   ![The platform console at admin.spamanagement.co.](../../../shots/platform/intro-console-overview.png)

   *In the screenshot:*

   1. The sidebar with every console page.
   2. The **Applications** badge: the number of applications waiting for you.
   3. The **Enquiries** badge: the number of new enquiries from the Contact page.
   4. The **Websites** badge: the number of open change requests from spas (chapter 10).
   5. Your account menu. Click your name for **Account & security** and **Sign out**.

> **Tip:** You are signed in separately on each address. Signing in to admin.spamanagement.co does not sign you in to app.spamanagement.co, and the other way round.

> **Tip:** The old test address (ending in sslip.io) still works. Old links that used it are sent on to the right spamanagement.co address automatically.

## Rules the platform never breaks

These rules are fixed. The whole platform is built around them.

1. **Spa payments are recorded, never processed.** Spas record what their clients paid: cash, their own card terminal or bank transfer. The CRM never takes a client's card. The only card payments on the platform are spas paying **your** platform invoices by Stripe Checkout (chapter 7).
2. **Customer messages are WhatsApp click-to-send only.** The CRM prepares the message, then a person opens WhatsApp and taps Send. There is no SMS, no email to customers and no automatic WhatsApp sending.
3. **Only super-admins design and publish spa websites.** You publish directly; the spa does not review or approve its site. Spas only edit their services and prices, and send you change requests for anything else (chapter 10).
4. **The only spamanagement.co email address is ask@spamanagement.co.** It is used on the website, on legal pages, as the default sender and for contact details.
5. **Plans and prices** (all prices exclude VAT; VAT is optional):
   - **Premium**: AED 14,000 setup + AED 3,000 per month.
   - **Standard**: AED 9,000 setup + AED 2,000 per month. Standard has no AI or Instagram automation, no marketing tools and one branch only.
   - Spas that joined on the old yearly price keep **AED 24,000 per year** until their renewal date (chapter 6).

## Finding your way around the console

1. The sidebar lists every page: **Overview**, **Applications**, **Enquiries**, **Spas**, **Performance**, **Websites**, **Plans & prices**, **Announcements**, **Feature flags**, **Company**, **AI models**, **AI usage**, **Domains**, **Site templates** and **Audit log**.
2. A number on **Applications**, **Enquiries** or **Websites** means something is waiting for you. On **Websites**, it is the number of open change requests from spas.
3. On a phone, the menu moves to a bar at the bottom of the screen. It shows **Overview**, **Applications**, **Enquiries**, **Spas** and **More**. The Applications and Enquiries counts show there too.

   ![The console on a phone.](../../../shots/platform/intro-console-phone.png)

   *In the screenshot:*

   1. The bottom bar, with the number of waiting applications on **Applications**.
   2. The **More** button for the other pages.

4. Tap **More** to see every other page. Tap a page to open it, or tap the cross to close the list.

   ![The More list on a phone.](../../../shots/platform/intro-console-phone-menu.png)

   *In the screenshot:*

   1. The other console pages, from **Performance** to **Audit log**.
   2. The cross that closes the list.

5. Every change you make in the console is written to the **Audit log** (chapter 17), with your name and the time.

> **Important:** Every console page and every button checks again that you are a super-admin with two-step verification turned on. If you turn two-step verification off, the console locks until you turn it on again (chapter 2).

> **Tip:** The console is in English and has a light look only. Spa dashboards are available in English and Thai.
