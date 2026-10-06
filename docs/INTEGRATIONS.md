# Integrations setup (operator guide)

Every integration is optional. Each feature switches itself on once its environment variables are set
(droplet: `/opt/spa/.env`, or without SSH via the encrypted overlay `deploy/droplet/secrets.env.enc` — see deploy/droplet/README.md).
Until then, the UI shows a "not configured yet" state.

`APP_URL` below is the app origin, without a path. Today that is `https://spamanagement-6g3mi.ondigitalocean.app`;
later it becomes `https://app.spamanagement.ae`. API routes live at `/api/...` on that origin.
OAuth redirect URIs are built from it, so register exactly what the app shows on the integration card.

## 0. Token encryption

| Var | Value |
|---|---|
| `APP_ENCRYPTION_KEY` | 32 random bytes, base64: `openssl rand -base64 32` |

- Instagram and Google tokens are stored with AES-256-GCM.
- If this key is missing, it is derived from `BETTER_AUTH_SECRET`.
- Set it once and never change it; changing it invalidates every stored token.

## 1. Instagram (DMs, comments, publishing)

Uses the **Instagram API with Instagram Login**, so no Facebook Page is needed. Each spa's Instagram must be a professional (Business or Creator) account.

1. Create an app at <https://developers.facebook.com/apps> (type *Business*) and add the **Instagram** product.
2. Under *API setup with Instagram login*:
   - **Business login settings → OAuth redirect URI:** `{APP_URL}/api/integrations/meta/callback`
   - **Webhooks → Callback URL:** `{APP_URL}/api/integrations/meta/webhook`
   - **Verify token:** any random string, also set as `META_WEBHOOK_VERIFY_TOKEN`
   - **Subscribe to:** `messages`, `comments`
3. Permissions (Advanced Access needs App Review and Business Verification):
   - `instagram_business_basic`
   - `instagram_business_manage_messages`
   - `instagram_business_manage_comments`
   - `instagram_business_content_publish`
4. Until approved, add the pilot spa's Instagram account as an **Instagram tester** in the app roles.
5. Env:

| Var | Value |
|---|---|
| `META_APP_ID` | Instagram app ID |
| `META_APP_SECRET` | Instagram app secret (also verifies webhook signatures) |
| `META_WEBHOOK_VERIFY_TOKEN` | the verify token from step 2 |

How it behaves:
- DMs are answered by the AI receptionist according to AI studio:
  - **approve** mode drafts replies in the Inbox for a person to approve;
  - **autopilot** sends them directly;
  - flagged conversations are always handed to a human.
- Replies are only sent within Meta's 24-hour messaging window.

## 2. Google Business Profile (reviews, posts)

1. In Google Cloud, create a project and enable these APIs:
   - *My Business Account Management API*
   - *My Business Business Information API*
   - *Google My Business API* (v4: reviews and local posts)

   Request access via the GBP API contact form if the quota is 0.
2. **OAuth consent screen:**
   - External, scope `https://www.googleapis.com/auth/business.manage`
   - add test users until verified
3. **Credentials → OAuth client (Web):**
   - redirect URI `{APP_URL}/api/integrations/google/callback`
4. Env:

| Var | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |

The spa owner (or a Manager on the profile) connects from *Settings → Instagram & Google* and picks the location.
- Reviews sync every 2 hours (worker job `gbp-reviews-sync`) and on *Sync now*; new reviews get an AI draft when the
  review agent is on, autopilot posts 4–5★ replies.
- Replies to 1–3★ reviews always wait for approval.
- Approved AI-studio posts get *Post to Google* (STANDARD local post, Book button → `{site}/book?src=gbp`; photo only
  when it has a public https URL).
- Without the env vars the card shows "Not configured yet" and reviews are pasted in by hand (manual fallback).

## 3. Custom domains (Cloudflare for SaaS)

Production design: spa domains point at a Cloudflare for SaaS **fallback origin** (our Tunnel/App), and Cloudflare issues SSL per hostname.

1. In the `spamanagement.ae` zone, enable **SSL for SaaS** and set the fallback origin (e.g. `customers.spamanagement.ae`, proxied).
2. Create an API token with **Zone → SSL and Certificates: Edit** and **Zone → Custom Hostnames: Edit** for that zone.
3. Env:

| Var | Value |
|---|---|
| `CF_API_TOKEN` | the token |
| `CF_ZONE_ID` | zone ID |
| `CF_CNAME_TARGET` | `customers.spamanagement.ae` |

The spa adds two DNS records, shown on *Settings → Custom domain*:
- `TXT _spamanagement.<their host>` = token
- `CNAME <their host>` → `CF_CNAME_TARGET`

The worker verifies every 10 minutes and activates the domain. Without Cloudflare configured, verification still checks DNS, and a super-admin can activate the domain from `/admin/domains`.

## 3a. Buying domains (Namecheap, optional)

Lets a spa request a domain under **Settings → Domains → Buy a domain**; you approve it in **/admin/domains**, which buys it on
the platform's Namecheap account and points it at the spa's site (see PLAN.md §2 "Buy a domain").

1. Namecheap → Profile → Tools → **API Access** → on (needs account balance/spend thresholds Namecheap requires).
2. **Whitelisted IPs**: add the droplet's public IPv4 (API calls from any other IP fail).
3. Set `NAMECHEAP_API_USER` (your Namecheap username), `NAMECHEAP_API_KEY` and `NAMECHEAP_CLIENT_IP` (the droplet IP;
   cloud-init fills it). Optional: `NAMECHEAP_USERNAME` if it differs from the API user, `NAMECHEAP_SANDBOX=1` for the sandbox.
4. Fill in the platform company details (admin → Settings): they become the domains' admin/tech/billing contacts.
5. Keep funds on the Namecheap account — the balance shows on /admin/domains; each approval charges it.

## 4. Web push notifications

```sh
npx web-push generate-vapid-keys
```

| Var | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | public key |
| `VAPID_PRIVATE_KEY` | private key |
| `VAPID_SUBJECT` | `mailto:support@spamanagement.ae` |

Staff enable notifications per device on their *Account* page.

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
