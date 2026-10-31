# 25. Google, Meta and Search Console (platform side)

## What this is for

The one-time setup that lets Premium spas connect their Google Business Profile and their Instagram and Facebook accounts. You do this once for the whole platform; each spa then connects its own accounts in its **Settings** → **Instagram & Google**.

## Google

One Google sign-in app (an "OAuth client") in your Google Cloud project serves every spa.

1. Open **console.cloud.google.com** and choose the platform's project.
2. Open **APIs & Services** and enable these APIs:
   - **My Business Account Management API**
   - **My Business Business Information API**
   - **Google My Business API** (reviews and posts)
   - **My Business Place Actions API** (the "Book" button on Google)
   - **Google Search Console API**
3. Open the **OAuth consent screen** and add the two scopes **business.manage** and **webmasters**.
4. Under **Credentials**, open the OAuth client and add this **Authorized redirect URI**: **https://app.spamanagement.co/api/integrations/google/callback**.
5. On the consent screen, set the privacy policy to **https://spamanagement.co/privacy** and the terms to **https://spamanagement.co/terms**.
6. Add the client ID and client secret (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET) to the encrypted secrets file (chapter 24, "Add or change a secret").
7. After the next deploy, the **GOOGLE_\* (sign-in, Business Profile)** row on the Overview turns green.

> **Important:** Google must approve your access to the Business Profile APIs (Google's access request form) before they work with real spas. The two scopes are "sensitive", so Google also checks the app before outside users can connect without a warning.

> **Tip:** If an API is missing, the spa's Google card says "this Google API isn't enabled for the platform yet". Enable the API it names.

What Premium spas get once they connect: the **Book button on Google** (it links to the spa's online booking) and **Search Console** (the spa's sitemap is sent to Google after each publish).

## Search Console for spamanagement.co

This makes Google find the marketing website and every spa's free address.

1. Open Google Search Console and add a **Domain** property for **spamanagement.co**.
2. Google gives you a **TXT** record. Add it in Namecheap under **Advanced DNS** (chapter 20).
3. Click **Verify** in Search Console.
4. Under **Sitemaps**, submit **https://spamanagement.co/sitemap.xml** once.

> **Tip:** This one Domain property also covers every spa's free address ({slug}.spamanagement.co). Spas cannot verify those addresses themselves.

## Meta (Instagram and Facebook)

One Meta app serves every spa. It has two products.

1. In Meta for Developers, open the platform's app.
2. **Instagram API with Instagram Login**:
   - OAuth redirect URI: **https://app.spamanagement.co/api/integrations/meta/callback**.
   - Webhook: **https://app.spamanagement.co/api/integrations/meta/webhook**, with the fields **messages** and **comments**.
   - Deauthorize callback URL: **https://app.spamanagement.co/api/integrations/meta/deauthorize**.
   - Data deletion request URL: **https://app.spamanagement.co/api/integrations/meta/data-deletion**. Both addresses are also listed on a spa's Instagram card.
3. **Facebook Login for Business**:
   - Valid OAuth Redirect URI: **https://app.spamanagement.co/api/integrations/meta/facebook/callback**.
   - Subscribe the app's **Instagram** webhook object to **comments**. Then comments on an Instagram account that is linked to a Facebook Page reach the inbox.
   - Optional: create a Login for Business configuration and add its ID as META_FB_CONFIG_ID to the encrypted secrets file (chapter 24). Without it, the sign-in window asks for the permissions directly.
4. Under **Settings** → **Basic**, set:
   - Privacy policy: **https://spamanagement.co/privacy**
   - Terms: **https://spamanagement.co/terms**
   - Data deletion instructions: **https://spamanagement.co/data-deletion**
   - App domains: **spamanagement.co**
5. Submit the app for **App Review** for the permissions the platform uses. Claude can give you the exact list from the server notes.
6. Add the app ID, app secret and webhook verify token (META_APP_ID, META_APP_SECRET and META_WEBHOOK_VERIFY_TOKEN) to the encrypted secrets file (chapter 24, "Add or change a secret").
7. After the next deploy, the **META_\* (Instagram)** row on the Overview turns green.

> **Important:** Until Meta approves the app review, only people with a role on the Meta app (admins, developers, testers) can connect an account. Spas cannot connect yet.

> **Tip:** Meta's access lapses 90 days after a person last signed in. The spa's card warns 14 days before and asks the spa to reconnect.

> **Important:** The platform never sends WhatsApp messages automatically. Customer WhatsApp messages stay click-to-send only, also with Meta connected.
