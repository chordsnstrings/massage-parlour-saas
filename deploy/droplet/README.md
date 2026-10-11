# Single-droplet deployment

One Ubuntu 24.04 droplet runs everything with Docker Compose: Postgres 16, migrations, web, worker, and Caddy
(automatic HTTPS). The droplet's IPv4 is a stable outbound address, which matters for IP-whitelisted APIs
such as Namecheap.

## How deploys work

- **First boot (`cloud-init.sh`, passed as user_data):**
  1. installs Docker, swap and a firewall
  2. clones the deploy branch
  3. writes `/opt/spa/.env` (secrets) and starts Postgres
  4. optionally copies data once from a previous database (`SOURCE_DATABASE_URL`, connecting as its owner role)
  5. installs the updater and runs the first deploy
- **Updates are pull-based:** the `spa-update.timer` systemd timer runs `/usr/local/bin/spa-update` every 2 minutes.
  - **Only CI-green commits deploy (G7).** CI (`.github/workflows/ci.yml`, job `promote`) moves the branch
    `deploy/green` to each commit of the deploy branch whose checks passed (forward only, with the built-in
    `GITHUB_TOKEN`; no extra secret). The updater deploys `deploy/green`, never the raw branch tip, and refuses a
    `deploy/green` that is not part of the deploy branch. Until `deploy/green` exists for the first time it deploys the
    branch tip (status `gate: none`); once seen, it never falls back (`/opt/spa/ci-gated`). A push therefore reaches
    production when CI finishes (~20 min), not 2 min later. Override the ref name in `/opt/spa/green-ref`.
  - **Each deploy:** rebuild `/opt/spa/.env` (first-boot env < secrets overlay < `site.env`, see "Hostname and public
    settings") → build the images → `pg_dump -Fc` to `/opt/spa/backups/pre-migrate-<sha>.dump` (newest 5 kept)
    → `migrate` service (with `lock_timeout=10s`, `statement_timeout=15min`; tune with `MIGRATE_LOCK_TIMEOUT` /
    `MIGRATE_STATEMENT_TIMEOUT` in the env overlay) → restart → `/api/health` for up to 5 min.
  - **Automatic rollback:** if any step fails, the updater redeploys the last good commit (`/opt/spa/last-good`) and
    reports `state: failed` with the reason in `deploy.json`; the failed commit is not retried every 2 minutes (push a
    fix or `sudo spa-update --force`). Migrations are not reverted (keep them additive). To restore data from before
    a deploy:
    ```sh
    cd /opt/spa/repo/deploy/droplet && docker compose --env-file /opt/spa/.env stop web worker
    docker compose --env-file /opt/spa/.env exec -T postgres pg_restore -U postgres -d spa --clean --if-exists /backups/pre-migrate-<sha>.dump
    docker compose --env-file /opt/spa/.env up -d
    ```
  - The `updater-sync` compose service copies `deploy/droplet/update.sh` to `/usr/local/bin/spa-update` on every
    deploy, so updater changes need no SSH (the first deploy of a new updater still runs with the previous copy).
  - Force a redeploy with `sudo spa-update --force`.
- **One-time owner steps for the CI gate:**
  1. GitHub → repo Settings → Actions → General → Workflow permissions: the job asks for `contents: write` itself;
     only if the organisation/repo forces read-only tokens, choose "Read and write permissions".
  2. If branch protection or rulesets cover `deploy/*` (or all branches), allow GitHub Actions to push `deploy/green`.
  3. After the next green CI run on the deploy branch, check that the `deploy/green` branch exists on GitHub and
     `/_status/gate.json` shows `"gate":"ci"`.
- **Status:**
  - `https://<host>/_status/deploy.json` (state ok / building / rolling_back / failed, commit, gate), `gate.json`
    (branch tip vs CI-green commit), `build.log` and `runtime.txt` (container states and the last log lines,
    credentials redacted)
  - basic auth, user `ops`, password = `STATUS_PASSWORD` from the render step
- **Backups:**
  - nightly `pg_dump` into `/opt/spa/backups` (7 rolling days)
  - off-site via the worker's `db-backup` job (03:30 Dubai) to the `R2_*` bucket (any S3-compatible store); without
    `R2_*` it falls back to the `S3_*` file bucket (`backups/` prefix). **Recommended:** a private **DigitalOcean
    Spaces** bucket (about USD 5/month) with its own access key: `R2_ENDPOINT=https://<region>.digitaloceanspaces.com`
    (e.g. `blr1`), `R2_REGION=<region>` (signing region; unset = `auto`, which Cloudflare R2 uses), `R2_BUCKET`,
    `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (secrets overlay), and lifecycle rules `backups/daily/` 30 days and
    `backups/monthly/` 365 days. `scripts/restore-drill.sh` reads the same variables.
  - every run (ok / skipped / failed) shows on the super-admin overview; it warns when the last good backup is > 36 h old
  - monthly **restore drill** (worker `restore-drill`, 2nd of the month): latest off-site dump → scratch database →
    counts → drop, as the least-privilege role `spa_drill` (CREATEDB only; it owns only its scratch database and has
    no access to the live data; F11). The worker never holds the Postgres superuser password and refuses to run as a
    superuser. Compose service `db-roles` re-runs the idempotent role bootstrap on every deploy, so the role reaches
    an existing droplet with no SSH; its password is derived from `SPA_OWNER_PASSWORD` unless `SPA_DRILL_PASSWORD` is
    set (optional, e.g. via the secrets overlay; the next deploy applies a new value). Console → Overview →
    Configuration shows "Restore drill role (spa_drill)".
  - enable DigitalOcean droplet backups for whole-machine snapshots

## Health and alerts (G8)

- The worker records a heartbeat every 5 minutes (`platform_job_runs`, job `worker-heartbeat`, one day kept) with
  root-disk use, the updater's `deploy.json` (`/opt/spa/status` mounted read-only) and which settings the worker sees
  (presence only). Its compose healthcheck checks the heartbeat file (unhealthy shows in `runtime.txt`).
- Super-admin console → Overview: **Server health** (red when the last heartbeat is > 10 min old, disk > 85 %, or
  the last deploy failed) and **Configuration** (green/red per production setting, never the values;
  `RESEND_API_KEY` first, with where it comes from: console / env / missing).
- Alert email to every `PLATFORM_ADMIN_EMAILS` address once per incident (disk > 85 %, no successful off-site backup
  in 36 h, deploy failed); rows `ops-alert` record open/closed. A dead worker cannot email: the console shows it.
- Docker logs rotate (json-file, 5 × 10 MB): per service in `compose.yml` (immediate) and in
  `/etc/docker/daemon.json` (cloud-init; `update.sh` adds it on existing droplets, effective after the next Docker
  restart or reboot).

## Staff email (Resend)

Super-admin console → Settings → **Email (Resend)**: API key (write-only; shows "Set ✓ (…last 4)") and From
address, plus **Send test email to me** and **Sending domain** (R18: set up the From domain in Resend, copy its DNS
records into Namecheap, check verification; see the move steps below). Console values win over `RESEND_API_KEY` / `EMAIL_FROM` in the env (web and
worker, re-read within a minute). The key is stored encrypted when `APP_ENCRYPTION_KEY` (or `BETTER_AUTH_SECRET`)
is available, else as entered; it is never shown, logged or audited. Production refuses to send without a key from
either place.

## Bot check on public forms (Cloudflare Turnstile, F9)

Online booking (`/book`), the booking widget (`/book/embed`), the website **Enquiry form** block (F15), **Apply**
(`/signup`) and marketing **Contact** check visitors with Cloudflare Turnstile (managed, invisible unless Cloudflare
wants a click), on top of the honeypot and per-IP limits. Until both keys are set the forms stay open and console → Overview → Configuration shows
`TURNSTILE_*` red. Owner steps:

1. Cloudflare dashboard → **Turnstile** → **Add widget**: name `spamanagement forms`, **Widget mode: Managed**,
   pre-clearance **No**.
2. **Hostnames:** `spamanagement.co` (a hostname also covers its subdomains, so `app.`, `admin.` and every spa's
   `<slug>.spamanagement.co`). Turnstile is a free widget: it needs no Cloudflare DNS (ours is at Namecheap).
3. **Custom domains (option):** a spa's own domain (e.g. `book.saffronspa.ae`) works only once it is in the
   widget's hostname list. Add them there, then tick **Also check spa custom domains** (step 4; or set
   `TURNSTILE_CUSTOM_DOMAINS=on`). Without it, custom-domain booking pages skip the bot check (honeypot + limits only)
   instead of breaking. The free plan caps hostnames per widget.
4. **Enter the keys in the console** (easiest): super-admin console → **Company** (Settings) → **Bot check (Cloudflare
   Turnstile)**: paste the **Site key** and **Secret key**, Save. Works at once, no deploy. The secret is write-only
   (shown as `…last 4`), stored encrypted when an encryption key exists; console values win over env. "Remove the
   stored keys" falls back to env. Alternative: the secrets overlay ("Secrets without SSH" below)
   `TURNSTILE_SITE_KEY=…` / `TURNSTILE_SECRET_KEY=…` (web container only; push, the next update restarts web).
   The Configuration row then turns green and says where the keys come from (console / env).
5. Check: open a spa's `/book` and book a test slot. A visitor who fails the check sees "We couldn't confirm you're
   not a robot" and nothing is stored.

## Security headers (F10)

Every page sends a strict Content-Security-Policy with a fresh nonce per request (scripts run only when the server
stamped them), plus HSTS (https), `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` and COOP.
Only the booking widget route (`/book/embed`) may be framed by other sites. Nothing to configure. If a browser blocks
something, it reports it: console → Overview → **Server health → Content-Security-Policy** shows the count of the last
7 days with the directive, blocked origin and page (web logs: `[csp] …`). Adding an outside script, font or frame
host later means adding it to `packages/core/src/security-headers.ts`.

## Super-admins

- **Who:** the droplet's base `PLATFORM_ADMIN_EMAILS` (`/opt/spa/.env.base`, e.g. `ahmed@arks.ae`) **plus**
  `ahmedabouseif1997@gmail.com` and `sefohh.aa45@gmail.com`, appended in compose.yml for web, worker and
  migrate/seed (owner, 2026-10-09; the base env can't be edited without SSH). To add or remove one later, edit those
  three lines (or set the full list in the secrets overlay and drop the appended part). Empty segments and duplicates
  are ignored. Removing an address never demotes an existing super-admin.
- **Getting a login:** the public sign-up is the spa application form and refuses these addresses. Open
  **`https://admin.<domain>/join`** (also linked "Create a super-admin account" on the admin sign-in page): name,
  email, password. Only listed addresses are accepted.
- **Verify:** open the emailed link (needs a Resend key: console → Company → Email). **Without email yet:** an
  existing super-admin (with 2FA) opens console → Company → **Super-admins** and clicks **Mark email verified** next
  to the new login; it becomes a super-admin at once. Every action is in the audit log (`platform.admin.*`).
- **First visit:** the console asks for two-step verification (authenticator app) before it opens.

## Connect Claude (edit spa sites from Claude)

1. `SITE_AI_EDITOR_EMAILS` defaults (compose.yml) to `*`: every super-admin (owner, 2026-10-11); a comma-separated
   list in `/opt/spa/.env.base` (first-boot env, needs SSH) or the secrets overlay narrows it (`/opt/spa/.env` itself
   is regenerated on every deploy, so an edit there is lost). Each account must be a super-admin with a verified email
   and two-step verification on. Empty = nobody (Studio "Ask AI" is off too).
2. In Claude (claude.ai or Claude desktop): **Settings → Connectors → Add custom connector**, name it e.g.
   "spamanagement", URL **`https://app.<your domain>/api/mcp`** (the console → Websites "Connect Claude" card shows it
   with a copy button). Claude opens the sign-in page: sign in with the super-admin account + 2FA code, then **Allow**.
3. Ask Claude e.g. "List my spas", "On saffron-spa make the hero gold and add an FAQ". Every change is a **draft**:
   preview and publish in the Website Studio as usual (Claude can also give a preview link).
4. Disconnect any time: console → Websites → Connect Claude → **Revoke** (takes effect on Claude's next call).
   Removing your email from `SITE_AI_EDITOR_EMAILS` also stops it at once.
5. Only Claude's own callback (claude.ai / claude.com) can be registered and receive sign-in codes; the consent page
   shows where access goes ("Approving sends access to claude.ai"). Registrations nobody approves are deleted after a
   day. Every approval is in the audit log (`platform.mcp.client_authorized`).

## Google: Business Profile, Book button, Search Console (F17)

One OAuth client (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) in the platform's Google Cloud project serves every spa.
Owner steps in that project (console.cloud.google.com → APIs & Services):
1. **Enable the APIs**: My Business Account Management API, My Business Business Information API, Google My Business
   API (v4: reviews + local posts), **My Business Place Actions API** (the "Book" button) and **Google Search Console
   API**. A missing one shows on the spa's card as "this Google API isn't enabled for the platform yet" (the stored
   code is `api_disabled`). Business Profile APIs need Google's access approval (the GBP API access form) before they
   answer with real quota.
2. **OAuth consent screen → scopes**: `https://www.googleapis.com/auth/business.manage` and
   `https://www.googleapis.com/auth/webmasters` (both sensitive: Google verifies the app before external users see no
   warning). The connect flow asks for both; spas connected before F17 see "Reconnect Google and allow Search Console
   access" until they reconnect once.
3. **Authorized redirect URIs**: `https://app.spamanagement.co/api/integrations/google/callback`.

What spas get (Premium): Settings → Instagram & Google → Google card → **Book button on Google** (adds/updates/removes
the location's APPOINTMENT link → `https://<site>/book?src=google`; the `gbp-site-sync` worker job re-points it within
10 minutes when the site address changes, e.g. a custom domain becomes primary) and **Search Console** (sitemap sent
after each publish, or with "Send sitemap"; the spa's Google account must own or fully manage a property covering
the address — a custom domain without one is added with `sites.add` and must then be verified in Search Console).
**Platform marketing sitemap stays an owner step:** in Search Console add the `sc-domain:spamanagement.co` property
(DNS TXT verification: Namecheap → Advanced DNS) and submit `https://spamanagement.co/sitemap.xml` once. Spa free addresses
(`{slug}.spamanagement.co`) are covered by that Domain property; spa Google accounts can't verify them.

## Meta: Instagram + Facebook Page (F18, F19)

One Meta app (`META_APP_ID` / `META_APP_SECRET` / `META_WEBHOOK_VERIFY_TOKEN`) with two products:
1. **Instagram API with Instagram Login** (existing): redirect `https://app.<domain>/api/integrations/meta/callback`,
   webhook `…/api/integrations/meta/webhook` (fields `messages`, `comments`), deauthorize + data-deletion URLs (the
   Instagram card lists them). Permissions for app review: `instagram_business_basic`,
   `instagram_business_manage_messages`, `instagram_business_manage_comments` (comment replies **and private
   replies**), `instagram_business_content_publish` (feed posts, **reels, stories, carousels**).
2. **Facebook Login for Business** (F19): add the product, then **Valid OAuth Redirect URIs** =
   `https://app.<domain>/api/integrations/meta/facebook/callback` (the Facebook card shows it).
   Optional: create a Login for Business **configuration** (user access token, the permissions below) and set
   `META_FB_CONFIG_ID` to its id; unset = the dialog asks for the permission list directly. Permissions for app
   review: `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_posts`,
   `pages_read_user_content`, `pages_manage_engagement`, `business_management`, `instagram_basic`,
   `instagram_manage_comments`, `instagram_manage_messages`, `instagram_content_publish`. Also subscribe the app's
   **Instagram** webhook object to `comments` (Facebook Login path) so comments on a Page-linked account reach the
   inbox; the app is installed on the chosen Page (`subscribed_apps`, field `feed`) automatically.
   Deauthorize / data-deletion callbacks are the same URLs as Instagram's (they also clear Page tokens).

Until app review passes, only people with a role on the Meta app (admins, developers, testers) can connect. Page
tokens don't expire, but Meta's data access lapses 90 days after the person last signed in: the card warns 14 days
before (daily `instagram-token-refresh` job runs `debug_token`) and asks to reconnect. Videos for reels/stories must be
public https `.mp4`/`.mov` links (the media library holds images only); Instagram processes them for up to a few
minutes and the 5-minute `instagram-publish` job finishes the post.

## Client IP (rate limits, audit IPs)

The app takes the visitor's IP from one header only, `Cf-Connecting-Ip`, and Caddy overwrites it on every request:
- **Through Cloudflare** (only a spa domain proxied by the spa's own Cloudflare account; our DNS is at Namecheap with
  no proxy): the TCP peer is a Cloudflare edge address, so Caddy keeps Cloudflare's `Cf-Connecting-Ip` (the real
  visitor).
- **Direct to the droplet** (spamanagement.co and its subdomains, the sslip.io address, most spa custom domains,
  anyone using the droplet IP): the peer is not Cloudflare, so Caddy sets `Cf-Connecting-Ip` to the peer itself and
  a forged header is discarded.
- `X-Real-Ip`, `True-Client-Ip` and `Do-Connecting-Ip` are stripped; `X-Forwarded-For` is rebuilt by Caddy and never
  read for the IP (behind Cloudflare its first entry is whatever the client sent).

Per-IP sign-in / registration / booking / contact limits therefore can't be bypassed by forging headers. IPv6 visitors
are limited per /64. A deploy that changes the Caddyfile restarts Caddy so the change takes effect (`update.sh`).

**Cloudflare's ranges** (the `trusted_proxies static` line) come from https://www.cloudflare.com/ips/. The
"Cloudflare IP ranges" GitHub workflow checks them every Monday; when it fails, refresh and commit:
```sh
deploy/droplet/cloudflare-ips.sh --write   # rewrites the list from cloudflare.com/ips-v4 + ips-v6
deploy/droplet/test-caddy-ip.sh            # needs caddy or docker; CI runs it on every push
git commit -am "chore(caddy): refresh Cloudflare IP ranges"
```

## Secrets without SSH

`/opt/spa/.env` is written at first boot; the updater keeps that copy as `/opt/spa/.env.base` and regenerates `.env`
on every deploy (`.env.base` < overlay < `site.env`), so never edit `.env` by hand (with SSH, edit `.env.base`). To add
or rotate secrets later:
1. Encrypt a dotenv file with the key in `/opt/spa/secrets.key`:
   ```sh
   openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -salt -pass file:<key> -in overlay.env -out deploy/droplet/secrets.env.enc
   ```
2. Commit and push.

On its next run the updater decrypts the file and overrides those keys on top of the first-boot env (`.env.base`), then rebuilds.
The updater replaces the previous overlay as a whole, so the new plaintext must hold every key the current one holds.
Only the droplet has the key: public settings go in `site.env` instead (next section), which also wins over the
overlay for its keys.

## Hostname and public settings (site.env)

First boot writes `SITE_HOST` (`auto` = `<ip-with-dashes>.sslip.io`) and `ROUTING=path` (`/app`, `/admin`,
`/s/{slug}`) into `/opt/spa/.env`. Public settings are changed later in **`deploy/droplet/site.env`**: a plain file in
git, never for secrets. On every deploy the updater rebuilds `/opt/spa/.env` as first-boot env < secrets overlay <
site.env, so a line in site.env wins over both. Only these keys apply: `SITE_HOST`, `ROUTING`, `APP_URL`, `ADMIN_URL`,
`EXTRA_ROOT_DOMAINS`, `ACME_EMAIL`, `VAPID_SUBJECT`, `CF_CNAME_TARGET`, `EMAIL_FROM`; any other line is skipped and
noted in `/_status/build.log`. CI (`deploy/droplet/test-update.sh`) fails a site.env with another key, a key set
twice, an empty value, or `SITE_HOST` / `ROUTING` / `APP_URL` / `ADMIN_URL` not set together and matching (`ROUTING=host` needs
`APP_URL=https://app.<SITE_HOST>` and `ADMIN_URL=https://admin.<SITE_HOST>`; `ROUTING=path` needs
`https://<SITE_HOST>` and `https://<SITE_HOST>/admin`). A rollback redeploys the last good commit with that commit's
own site.env. A change to `update.sh` itself runs from the deploy after the one that ships it (`updater-sync` installs
it during that deploy), so a site.env change that relies on new updater code must come in a later push.

Links are domain-agnostic (apps/web/src/server/origin.ts): getting around and signing in use the platform domain the
visitor is on; addresses that are shared, stored or sent use the canonical `SITE_HOST`. The app only needs to know
which domains are ours:
- `SITE_HOST` — the canonical domain (Caddy's main site; `ROOT_DOMAIN` derives from it). Every address that is shared
  or stored uses it (spa site links, invites, campaign links), as do worker jobs (`APP_URL`). The CNAME target shown
  to spas is `CF_CNAME_TARGET` (`customers.<SITE_HOST>`; unset = the `APP_URL` host).
- `EXTRA_ROOT_DOMAINS` (optional, space or comma separated) — more domains that serve the whole platform (one line
  holding all of them).

**TLS (no Caddyfile edit):** Caddy gets the `SITE_HOST` certificate at start; every other host (`www.`, `app.`,
`admin.`, `{slug}.`, the extra domains, spa custom domains) gets one **on demand** on its first visit, approved by
`/api/domains/allowed` (hosts on `ROOT_DOMAIN` + `EXTRA_ROOT_DOMAINS`, existing and renamed spa slugs, custom
domains that are pending, verifying or active; anything else is refused). `/_status/` is served on `SITE_HOST` and
on the droplet's own `<ip>.sslip.io`.

### Move to spamanagement.co

**Done 2026-10-10** (PR #27, then PR #28; live 15:45 UTC). Kept below as the record and for the undo steps.

From `134-209-145-162.sslip.io` with path routing to `spamanagement.co` with host routing (`app.`, `admin.`,
`{slug}.`). The old sslip.io address keeps working through `EXTRA_ROOT_DOMAINS`. Steps:

1. **DNS (done).** Namecheap → Domain List → spamanagement.co → Advanced DNS, nameservers "Namecheap BasicDNS":
   `A @ → 134.209.145.162` and `A * → 134.209.145.162` (the `*` covers `www.`, `app.`, `admin.`, every `{slug}.` and
   `customers.`, the CNAME target shown to spas). Email Forwarding (MX + SPF TXT) delivers `ask@spamanagement.co`.
   Check: `dig +short app.spamanagement.co` gives `134.209.145.162`.
2. **Before merging PR 2** (only what is configured; each is an extra entry next to the old one, harmless early):
   - Turnstile (only if console → Overview → Configuration shows the `TURNSTILE` row green): Cloudflare → Turnstile
     → the widget → Hostnames: add `spamanagement.co` (covers `app.`, `admin.` and every `{slug}.`). Without it every
     protected form (booking, widget, Enquiry, Apply, Contact) refuses with "We couldn't confirm you're not a robot"
     from the moment of the switch.
   - Google Cloud → Credentials → OAuth client → Authorized redirect URIs: add
     `https://app.spamanagement.co/api/integrations/google/callback`; OAuth consent screen → Authorized domains: add
     `spamanagement.co`.
   - Meta app → Instagram API with Instagram login → Business login settings → OAuth redirect URIs: add
     `https://app.spamanagement.co/api/integrations/meta/callback` (+ `/api/integrations/meta/facebook/callback` for
     Facebook Login); App domains: add `spamanagement.co`.
3. **Merge in two pushes** (the first deploy of a changed `update.sh` still runs the previous copy, which doesn't
   read site.env; the switch also needs a rollback target without it):
   1. PR 1, the updater, with the move lines in `site.env` commented out (no visible change). Wait until
      `https://134-209-145-162.sslip.io/_status/deploy.json` shows the deploy branch's commit for PR 1 (the merge
      commit) with `"state":"ok"`;
   2. only then PR 2, the switch, rebased on the deploy branch so its diff is `site.env` only (it uncomments the
      move block).

   If both landed in one deploy (`deploy.json` shows PR 2's commit with `"state":"ok"` but the site is still on the
   sslip.io address), the next push would make the switch with no rollback target: first push a commit that
   comments the move block out again, wait for `"state":"ok"`, then make the switch again.
4. **What happens:** CI runs on the deploy branch → `deploy/green` → within ~2 min the droplet rebuilds `.env`,
   rebuilds web (`ROUTING` is a build arg; a few minutes) and restarts. Caddy gets the spamanagement.co certificate at
   start and each other host's on its first visit (that first request takes a few seconds).
5. **Verify:**
   - `https://spamanagement.co` (marketing), `https://app.spamanagement.co` (sign in again: cookies are per domain),
     `https://admin.spamanagement.co`
   - a spa at `https://{slug}.spamanagement.co`; book a test slot on `https://{slug}.spamanagement.co/book`
     (catches a missing Turnstile hostname, step 2)
   - `https://spamanagement.co/_status/deploy.json` (user `ops`) shows PR 2's commit with `"state":"ok"`
   - old links redirect: `https://134-209-145-162.sslip.io/app` → `https://app.spamanagement.co/`,
     `…/s/{slug}` → `https://{slug}.spamanagement.co/` (table below)
   - console → Company: set the company name / contact email to `spamanagement.co` / `ask@spamanagement.co` if they
     still show `.ae` (migration 0047 already replaces the old default company name)
6. **After the switch** (only what is configured; these need the new address live):
   - Meta app: Webhooks callback, Deauthorize callback and Data deletion request URLs on
     `https://app.spamanagement.co/api/integrations/meta/…` (Meta calls them to check); Settings → Basic → Privacy
     policy `https://spamanagement.co/privacy`, Terms `https://spamanagement.co/terms`, Data deletion instructions
     `https://spamanagement.co/data-deletion` (pages in apps/web/src/app/marketing, company details in
     apps/web/src/components/marketing/legal-config.ts).
   - Google OAuth consent screen: privacy policy `https://spamanagement.co/privacy`, terms
     `https://spamanagement.co/terms`.
   - Stripe: nothing (no webhook; the Checkout return address follows the domain the payer is on).
   - Claude connector: reconnect with `https://app.spamanagement.co/api/mcp` (console → Websites shows it).
   - Later, for staff email: add the Resend key (console → Company → Email (Resend)), then **Set up sending domain**
     in the same card: it adds `spamanagement.co` to Resend (or finds it) and lists the records to add in Namecheap
     → Advanced DNS, with the Host as Namecheap wants it (`send`, `resend._domainkey`), Value (Copy), Priority, TTL
     Automatic. A sending-access key cannot use Resend's domains API: the card then asks for a full-access key; Set up
     and Check verification both need it (paste it again after a page reload; never stored). Add the records, click
     **Check verification** (Resend checks in the background, so click it again a minute later) until it says
     Verified; if it says Failed or Partially …, fix the rows not marked Verified and check again. Delete the
     full-access key in Resend once the domain says Verified, then **Send test email to me**. The default sender is already
     `spamanagement.co <ask@spamanagement.co>`. **Careful:** Resend's `send` MX record needs Namecheap Mail Settings
     = Custom MX, which switches off Email Forwarding, so `ask@spamanagement.co` stops receiving. Before switching,
     write down the current forwarding MX records (`eforward…registrar-servers.com`) and ask Namecheap support how to
     keep forwarding next to a `send` MX (or move `ask@` to another forwarder first); afterwards send a test mail to
     `ask@spamanagement.co`.
7. **Undo:** Claude reverts the switch commit (a PR); the next deploy rebuilds `.env` from the reverted site.env and
   is back on the sslip.io address with path routing (web rebuilds; browsers keep the redirects for 5 minutes). If
   the switch's build, start or health check fails, the updater rolls back to the last good commit on its own
   (`deploy.json` says `failed` and why).

**Old links keep working** (shared links, invites, QR posters, widget snippets, bookmarks): on any platform domain
(the sslip.io one, spamanagement.co itself, and their `www.`) the proxy redirects old path addresses, keeping the
rest of the path and the query, in one hop (a renamed spa's old slug goes straight to its current one):

| Old (path routing) | New (host routing) |
|---|---|
| `https://<old>/app/…` | `https://app.spamanagement.co/…` |
| `https://<old>/admin/…` | `https://admin.spamanagement.co/…` |
| `https://<old>/s/{slug}/…` | `https://{slug}.spamanagement.co/…` |

A spa whose own domain is active and primary goes straight to `https://{its domain}/…` instead (GET/HEAD, R20); the
widget frame `/s/{slug}/book/embed` still goes to `{slug}.spamanagement.co/book/embed`.

GET/HEAD get a 301, other methods a 308 (method and body kept). Never redirected, served as they are on every host,
the old one included while it stays in `EXTRA_ROOT_DOMAINS`:
- `/api/*`: Google/Meta OAuth callbacks (`/api/integrations/google/callback`, `/api/integrations/meta/callback`,
  `/api/integrations/meta/facebook/callback`), Meta webhook / deauthorize / data-deletion, the Claude connector
  `/api/mcp`, `/api/health`, Caddy's `/api/domains/allowed`.
- `/files/*` (images in sent links and emails), `/.well-known/*`, `/widget.js` (an old snippet still loads it from the
  old host; its `/s/{slug}/book/embed` frame redirects to `{slug}.spamanagement.co/book/embed`, and the widget takes
  the messages of the frame it opened from whatever origin that frame lands on, so resize, Escape-to-close and the
  `spa-widget:booked` event keep working; re-copying the snippet from Settings → Booking widget is optional).
- `/_status/*` is Caddy's: `https://spamanagement.co/_status/deploy.json`, and on the old sslip.io address.

Not carried over: sign-in (cookies are per domain: everyone signs in once more on spamanagement.co; 2FA stays as it
is); an installed dashboard app leaves its own scope on the redirect, so reinstall it from
`https://app.spamanagement.co/{slug}`; the Claude connector (old tokens were issued for the old address); a
Google/Meta connect started before the switch must be started again; push notifications (they belong to the old
address, which keeps showing them): staff who had them on enable them again on `app.spamanagement.co` and block
notifications for `134-209-145-162.sslip.io` in the browser's site settings (else every one arrives twice). Keep the
old address in `EXTRA_ROOT_DOMAINS` while Meta's URLs or old links may still point at it.

Generic rule for any later move: add the new domain to `EXTRA_ROOT_DOMAINS` first, register its OAuth callbacks,
then make it `SITE_HOST` (with `APP_URL` / `ADMIN_URL` to match) and keep the old one in `EXTRA_ROOT_DOMAINS` so links
already sent keep working.

## Creating the droplet

```sh
python3 deploy/droplet/render-user-data.py /path/to/secrets.env > /tmp/user_data.sh   # never commit this
# POST /v2/droplets with { name, region, size: "s-2vcpu-4gb", image: "ubuntu-24-04-x64",
#   user_data: <contents>, ssh_keys: [<account key ids>], monitoring: true, tags: ["spa"] }
```

The secrets file needs these keys:
- `BRANCH`, `REPO_URL`, `SITE_HOST=auto`
- `PLATFORM_ADMIN_EMAILS`, `ACME_EMAIL`, `STATUS_PASSWORD`
- optional `SITE_AI_EDITOR_EMAILS` (Studio "Ask AI" + the Claude connector): unset = compose's default `*`, every
  super-admin (with 2FA); set a comma-separated list to narrow it; removing an address cuts access on the next request
- `POSTGRES_SUPERUSER_PASSWORD`, `SPA_OWNER_PASSWORD`, `SPA_PLATFORM_PASSWORD`, `SPA_APP_PASSWORD`
- optional `SPA_DRILL_PASSWORD` (restore-drill role `spa_drill`; unset = derived from `SPA_OWNER_PASSWORD`)
- `BETTER_AUTH_SECRET`, `APP_ENCRYPTION_KEY`, `ARK_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- optional: `NAMECHEAP_API_USER`, `NAMECHEAP_API_KEY`, `SOURCE_DATABASE_URL`
- strongly recommended: `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_REGION` (off-site DB
  backups; DigitalOcean Spaces, see "Backups"),
  `RESEND_API_KEY` (password reset + email verification fail loudly in production without it; it can also be set later in the console → Settings → Email)
- first boot writes the optional and recommended keys above into `/opt/spa/.env` too (empty when unset); later
  changes go through the secrets overlay ("Secrets without SSH")
- super-admins: a `PLATFORM_ADMIN_EMAILS` address is promoted only once its email is verified (link or Google
  sign-in), and the console asks every super-admin to set up 2FA (authenticator app) before it opens. See
  "Super-admins" below for the addresses compose appends and how a new one gets its login.

Follow the boot from the droplet's console: `tail -f /var/log/spa-bootstrap.log`.
