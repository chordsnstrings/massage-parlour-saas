# Integrations setup (operator guide)

Every integration is optional. Each feature switches itself on once its environment variables are set
(droplet: `/opt/spa/.env.base` (first-boot env, needs SSH), or without SSH via the encrypted overlay
`deploy/droplet/secrets.env.enc` — see deploy/droplet/README.md; `/opt/spa/.env` itself is generated on every deploy as
`.env.base` < overlay < `site.env`, so a hand edit there is lost).
Until then, the UI shows a "not configured yet" state.

`APP_URL` below is the app origin, without a path: `https://app.spamanagement.co` (production since 2026-10-10). API
routes live at `/api/...` on that origin. OAuth redirect URIs are built from the canonical domain only (R29: pages on
an old platform domain such as the former `134-209-145-162.sslip.io` 308 to the same page on spamanagement.co, so every
sign-in and connect starts there); register exactly what the console card shows.

## 0. Token encryption

| Var | Value |
|---|---|
| `APP_ENCRYPTION_KEY` | 32 random bytes, base64: `openssl rand -base64 32` |

- Instagram and Google tokens are stored with AES-256-GCM.
- If this key is missing, it is derived from `BETTER_AUTH_SECRET`.
- Set it once and never change it; changing it invalidates every stored token.

## 1. Instagram + Facebook (DMs, comments, publishing, Facebook Pages)

One platform, two Meta apps, for every spa (R29). A Meta app holds **one** Instagram setup — Instagram API with
Instagram Login *or* with Facebook Login — so:
- **App 1 — Instagram** (Instagram API with Instagram Login; no Facebook Page needed): the spa card **Connect
  Instagram**. Keys `META_APP_ID` / `META_APP_SECRET` / `META_WEBHOOK_VERIFY_TOKEN`.
- **App 2 — Facebook** (Facebook Login for Business): the spa card **Connect Facebook** (Premium) — the Page and its
  linked Instagram professional account. Keys `META_FB_APP_ID` / `META_FB_APP_SECRET`, optional `META_FB_CONFIG_ID`.

Each spa's Instagram must be a professional (Business or Creator) account. One Instagram account / Facebook Page belongs
to **one spa** at a time (checked race-proof at connect: "already connected to another spa").

Create both at <https://developers.facebook.com/apps> (type *Business*). Paste every URL exactly as the console card
(**Settings → Meta (Instagram & Facebook)**) shows it — Strict Mode matches redirect URIs exactly (only `state` may
vary) and the code exchange resends the same URI; check that Meta did not add a trailing slash when saving.

| Where | App 1 — Instagram | App 2 — Facebook |
|---|---|---|
| Product / page | Instagram → API setup with Instagram login → **Business login settings** | **Facebook Login for Business → Settings** |
| OAuth redirect URI | `{APP_URL}/api/integrations/meta/callback` | Valid OAuth Redirect URIs: `{APP_URL}/api/integrations/meta/facebook/callback` |
| Deauthorize callback URL | `{APP_URL}/api/integrations/meta/deauthorize` | same |
| Data deletion request URL | `{APP_URL}/api/integrations/meta/data-deletion` | same |
| Webhooks (Instagram object) | callback `{APP_URL}/api/integrations/meta/webhook` + verify token; fields `messages`, `comments` | same URL + same verify token; fields `messages`, `comments` |
| Configuration | — | Facebook Login for Business → Configurations: token type **User access token** (Page + Instagram permissions below); its ID → `META_FB_CONFIG_ID` |
| App settings → Basic → App Domains | `spamanagement.co` | `spamanagement.co` |
| Client OAuth login / Web OAuth login | — | Yes / Yes |
| Enforce HTTPS / Strict Mode | Yes / Yes | Yes / Yes |
| Embedded browser OAuth login / Login with the JavaScript SDK | — / No | No / No |
| Console boxes | Instagram app ID, Instagram app secret, Webhook verify token | Facebook App ID, Facebook App secret, config ID |

Keys (console values win over env, key by key):

| Var | Value |
|---|---|
| `META_APP_ID` | App 1: **Instagram app ID** (Business login settings — not the App ID under App settings → Basic) |
| `META_APP_SECRET` | App 1: Instagram app secret (also verifies its webhook / deauthorize / deletion signatures) |
| `META_WEBHOOK_VERIFY_TOKEN` | any random string; the same in both apps' Webhooks settings |
| `META_FB_APP_ID` | App 2: **App ID** (App settings → Basic) — the Facebook dialog rejects the Instagram app ID |
| `META_FB_APP_SECRET` | App 2: App secret (App settings → Basic; also verifies Page-linked events) |
| `META_FB_CONFIG_ID` | optional: App 2's configuration ID (without it the dialog asks for the scope list below) |

Permissions (each needs Advanced Access through App Review):
- App 1: `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`,
  `instagram_business_content_publish`.
- App 2: `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_posts`,
  `pages_read_user_content`, `pages_manage_engagement`, `business_management`, `instagram_basic`,
  `instagram_manage_comments`, `instagram_manage_messages`, `instagram_content_publish`.

Approval path (both apps): **Business Verification** (Meta Business Suite → Security Centre) → complete app settings
(icon, privacy policy `https://spamanagement.co/privacy`, terms, data-deletion URL, category) → add the pilot spa's
account as an **Instagram tester** (App roles; works before review) → **App Review**, one request per permission with a
screen recording of it in use in the spa dashboard → switch the app to **Live** (published; Meta sends webhooks only to
published apps). Tech Provider Access Verification is no longer part of this (retired 2026-10-09).

Graph API: every call (graph.instagram.com, graph.facebook.com, the Facebook dialog) uses **v25.0** (`GRAPH_VERSION`
in `packages/services/src/integrations/meta.ts`; v25.0 is available until 2028-07-29, v21.0 retires 2027-01-21). R29
checked the v22.0–v25.0 changelogs and the Instagram Platform changelog for the endpoints used here — `/me/accounts`
with `instagram_business_account`, `debug_token`, Page `subscribed_apps`, `oauth/access_token` (code + `fb_exchange_token`),
the Instagram Login authorize / token / `ig_exchange_token` / `ig_refresh_token` endpoints, `/me` profile fields, IG
media containers (image, `REELS`, `STORIES`, `CAROUSEL` + children), `status_code`, `media_publish`, `messages` (text
and private replies by `comment_id`), comment `replies`, `/me/subscribed_apps` — and found no breaking change for them
(v22: Page ratings and some Insights metrics removed, legacy Instagram v1.0 / Marketing API Instagram nodes replaced
by the Instagram Platform ones we already use; v23–v25: WhatsApp / Marketing API / Insights / webhook mTLS CA only).
Sources: <https://developers.facebook.com/docs/graph-api/changelog/> (+ `/version22.0` … `/version25.0`),
<https://developers.facebook.com/docs/instagram-platform/changelog/>,
<https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login>.
v26.0 exists (2026-07-29); move on before v25.0 retires.

Webhooks through a Facebook Page (App 2): Instagram fields are subscribed in App 2's dashboard (Webhooks → Instagram:
`messages`, `comments`) — Meta does not take Instagram fields on a Page subscription — and Meta sends them only for
Pages that have the app installed. Choosing a Page installs the app with `POST /{page-id}/subscribed_apps?
subscribed_fields=feed,messages` (`messages` = the messaging install Instagram DMs through a Page need; if Meta refuses
it for lack of a permission, `feed` alone still installs the app). Events arrive as `object: "instagram"` with
`entry.id` = the Instagram account (same parser as App 1); the Page's own `object: "page"` events are ignored.
Sources: <https://developers.facebook.com/docs/graph-api/reference/page/subscribed_apps/>,
<https://developers.facebook.com/docs/instagram-platform/webhooks>,
<https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks>. **Needs a live test once
App 2 exists** (a DM and a comment on the Page-linked account reach the inbox).

How it behaves:
- DMs are answered by the AI receptionist according to AI studio:
  - **approve** mode drafts replies in the Inbox for a person to approve;
  - **autopilot** sends them directly;
  - flagged conversations are always handed to a human.
- Replies are only sent within Meta's 24-hour messaging window.
- Facebook Page connect needs both App 2 keys (`META_FB_APP_ID` + `META_FB_APP_SECRET`); without them it stays
  "Facebook not configured" and the spa card shows no Connect Facebook (no fallback to App 1's keys, which the Facebook
  dialog rejects). The console overview's Facebook Page connect row is green only with App 1's keys too (the
  Page-linked account's DMs, comments and publishing run through the shared webhook). Only one of the two App 2 keys is
  a warning ("Facebook keys incomplete").

## 2. Google Business Profile (reviews, posts)

1. In Google Cloud, create a project and enable these APIs:
   - *My Business Account Management API*
   - *My Business Business Information API*
   - *Google My Business API* (v4: reviews and local posts)
   - *My Business Place Actions API* (the Book button, F17)
   - *Google Search Console API* (sitemap submit, F17)

   Use a **separate Cloud project (and OAuth client) for development/test**; production's project serves only the
   live platform.
2. **Business Profile API access** (all GBP APIs start with quota 0 — spas can sign in, but listing/choosing a location
   fails until approved): file the *Application for Basic API Access* through the GBP API contact form. Google expects
   a Business Profile that is verified and active for 60+ days with a website, and the applying address
   (`ask@spamanagement.co`) added to that profile as a **Manager**. Check the quota in Cloud → APIs → Quotas afterwards.
3. **Google Auth Platform (OAuth consent screen)** — in this order:
   - **Branding:** app name, support email `ask@spamanagement.co`, home page `https://spamanagement.co`, privacy
     `https://spamanagement.co/privacy`, terms `https://spamanagement.co/terms`; authorised domain
     `spamanagement.co`, verified in Search Console with a DNS TXT record (Namecheap) by an owner of the project.
   - **Audience:** External → **Publish app** (status *In production*). **Never onboard spas while it is in Testing:**
     Testing refresh tokens expire after 7 days and only up to 100 listed test users can sign in. Use Testing only
     with your own test account (or the separate dev project).
   - **Data access:** scopes `https://www.googleapis.com/auth/business.manage`, `https://www.googleapis.com/auth/webmasters`,
     `openid`, `email` (the last two are non-sensitive: they identify the signed-in Google account — "Connected as",
     and disconnect revokes only when no other spa uses that account).
   - **Verification Center:** submit for verification with a justification per scope naming the calls we make —
     `business.manage`: list accounts/locations, read reviews, post review replies, create local posts, Place Actions
     (the Book link); `webmasters`: `sites.list`, `sites.add`, `sitemaps.submit`, `sitemaps.get` (no search analytics) —
     plus an **unlisted YouTube demo video** of the connect flow (account chooser + consent screen with the app name,
     the location picker, a reply, the Book button, the sitemap submit). A published but unverified app shows the
     "unverified app" screen and has a **lifetime cap of 100 users**.
4. **Clients → OAuth client (Web application):**
   - the one authorised redirect URI `https://app.spamanagement.co/api/integrations/google/callback` (canonical
     domain only, R29; locally `{APP_URL}/api/integrations/google/callback`); **Authorised JavaScript origins: empty**
     (server-side flow only).
   - **Never replace (delete/recreate) this client:** every spa's refresh token is bound to the client that issued it,
     so a new client means every spa must reconnect (their refreshes then fail with `unauthorized_client`/`invalid_grant`
     and the card asks for a reconnect). To change credentials, **rotate the secret only** (add a new secret, save it
     in the console, then disable the old one).
5. Keys: console **Settings (Company) → Google** card (R29; secret write-only, last 4 shown; a console value wins over
   env, key by key; web picks a save up at once, the worker within 30 s) — or env:

| Var | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |

The spa owner (or a Manager on the profile) connects from *Settings → Instagram & Google* (Google's account chooser
first, then consent) and picks the location; the card shows "Connected as {email}".
- **One spa per location** (R29): a location held by another spa (connected or needing a reconnect) can't be chosen —
  "This Business Profile is already connected to another spa." (unique index `social_accounts_gbp_location`).
- **Disconnect** deletes this spa's tokens; Google's revoke (which removes the whole grant of that Google account for
  our project) is called only when no other spa is connected with the same Google account, and never for connections
  made before `openid email` (account unknown).
- Reviews sync every 2 hours (worker job `gbp-reviews-sync`) and on *Sync now*; new reviews get an AI draft when the
  review agent is on, autopilot posts 4–5★ replies.
- **Review content ≤ 30 days** (Business Profile API policy, "Content storage": stored temporarily "for no more than 30
  calendar days"): every sync refreshes `reviews.synced_at` of the reviews Google returns; a complete sync (all pages,
  no error, not fewer than Google's own total) deletes the location's reviews Google no longer returns; the daily
  `gbp-reviews-purge` job (04:55 Dubai) deletes API reviews not refreshed for 29 days (disconnected spas and earlier
  locations included). Hand-pasted reviews are never touched.
- Token errors (RFC 6749 §5.2 + Google): `invalid_grant` / `unauthorized_client` (a token issued to another — replaced —
  client) → that spa is flagged *Reconnect*; `invalid_client` / `deleted_client` (wrong/missing secret, deleted client)
  → nobody is flagged, staff see "the platform's Google setup needs fixing".
- Replies to 1–3★ reviews always wait for approval.
- Approved AI-studio posts get *Post to Google* (STANDARD local post, Book button → `{site}/book?src=gbp`; photo only
  when it has a public https URL).
- Without the keys (console or env) the card shows "Not configured yet" and reviews are pasted in by hand (manual fallback).

## 3. Custom domains

Production design: spa domains point at the droplet, and Caddy issues each one's certificate on demand. No
Cloudflare zone, proxy or Tunnel (our DNS is at Namecheap).

`CF_CNAME_TARGET` = `customers.spamanagement.co` (deploy/droplet/site.env; it resolves through the Namecheap `*`
record). The spa adds two DNS records, shown on *Settings → Custom domain*:
- `TXT _spamanagement.<their host>` = token (proves ownership)
- `CNAME <their host>` → `CF_CNAME_TARGET` (a root domain may use an ALIAS/flattened record with the same address)

The worker checks the DNS every 10 minutes and activates the domain. Caddy gets its certificate on the first visit,
once `/api/domains/allowed` approves the host (a custom domain that is pending, verifying or active; not a failed or
deactivated one). A super-admin can also activate or deactivate a domain from the console's **Domains** page
(`admin.spamanagement.co/domains`).

Cloudflare for SaaS (`CF_API_TOKEN`, `CF_ZONE_ID`: custom hostnames + certificates at Cloudflare) is optional code,
not used.

## 3a. Buying domains (Namecheap, optional)

Lets a spa request a domain under **Settings → Domains → Buy a domain**; you approve it on the console's **Domains** page, which buys it on
the platform's Namecheap account and points it at the spa's site (see PLAN.md §2 "Buy a domain").

1. Namecheap → Profile → Tools → **API Access** → on (needs account balance/spend thresholds Namecheap requires).
2. **Whitelisted IPs**: add the droplet's public IPv4 (API calls from any other IP fail).
3. Set `NAMECHEAP_API_USER` (your Namecheap username), `NAMECHEAP_API_KEY` and `NAMECHEAP_CLIENT_IP` (the droplet IP;
   cloud-init fills it). Optional: `NAMECHEAP_USERNAME` if it differs from the API user, `NAMECHEAP_SANDBOX=1` for the sandbox.
4. Fill in the platform company details (admin → Settings): they become the domains' admin/tech/billing contacts.
5. Keep funds on the Namecheap account — the balance shows on the console's Domains page; each approval charges it.

## 3b. Card payments for the subscription (Stripe, optional)

Spas pay their platform invoices by card from **Billing** through Stripe Checkout (hosted page — no card data touches
the app). Client payments for treatments are still recorded only, never processed.

1. Create a key in Stripe (a restricted key needs **Checkout Sessions: write**). Test keys (`rk_test_…`/`sk_test_…`)
   work end to end with Stripe's test cards.
2. Set `STRIPE_SECRET_KEY` (droplet: in the encrypted overlay). Without it the "Pay by card" button is hidden.
3. No webhook needed: the app stores the Checkout Session on the invoice and confirms it with Stripe when the spa
   returns to (or reopens) Billing; the payment is recorded once (reference `stripe:<payment_intent>`) and the invoice
   is marked paid. A webhook can be added later for payments where nobody reopens Billing.

## 4. Web push notifications

```sh
npx web-push generate-vapid-keys
```

| Var | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | public key |
| `VAPID_PRIVATE_KEY` | private key |
| `VAPID_SUBJECT` | `mailto:ask@spamanagement.co` |

Staff enable notifications per device on their *Account* page. Who gets what: new online bookings → members with
`calendar.manage`; document expiry (60/30/7/0 days, daily 09:00) → `staff.manage`; weekly insights (Mon 08:00) →
`reports.view`; daily digest (09:30, today's bookings and unconfirmed requests) → `calendar.manage`. Only endpoints on
browsers' push services (FCM, Mozilla, WNS, Apple) are accepted or contacted. Push payload links are dashboard paths without the routing prefix; `/sw.js?base=/app` adds it in
path routing. Endpoints the push service reports gone (404/410) are deleted automatically.

## 5. File storage (optional)

Uploads are stored in Postgres by default, which is fine for a pilot. For scale, set an S3-compatible bucket (Cloudflare R2 has free egress):

| Var | Value |
|---|---|
| `S3_ENDPOINT` | e.g. `https://<account>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | bucket name |
| `S3_ACCESS_KEY_ID` | access key |
| `S3_SECRET_ACCESS_KEY` | secret key |
| `S3_REGION` | `auto` for R2 |

## 6. Error reporting (optional)

| Var | Value |
|---|---|
| `SENTRY_DSN` | any Sentry-compatible DSN (Sentry free tier, GlitchTip, Bugsink) |

Server errors, browser error-boundary hits and failed worker jobs are reported. No SDK is bundled.

## 7. AI (BytePlus ModelArk)

| Var | Value |
|---|---|
| `ARK_API_KEY` | ModelArk API key |
| `ARK_BASE_URL` | `https://ark.ap-southeast.bytepluses.com/api/v3` |

Model IDs per task are chosen in the super-admin under *AI models*; Seed 2.0 is the default. Each spa has a monthly AI budget, also set in the super-admin.
Receipt scanning uses an `ai_model_config` row with key `vision` when one exists (kind `chat`, a multimodal model), else the
`dm_agent` model (Seed 2.0 Lite reads images). Weekly insights use `insights_agent` and are stored in `ai_runs` (`agent_key = 'insights'`).
