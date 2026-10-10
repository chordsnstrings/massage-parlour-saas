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
  - **Each deploy:** build the images → `pg_dump -Fc` to `/opt/spa/backups/pre-migrate-<sha>.dump` (newest 5 kept)
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
  - off-site via the worker's `db-backup` job (03:30 Dubai) to the `R2_*` bucket; without `R2_*` it falls back to the
    `S3_*` file bucket (`backups/` prefix). **Recommended:** a separate private R2 bucket + its own key in `R2_*`,
    with lifecycle rules `backups/daily/` 30 days and `backups/monthly/` 365 days.
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
address, plus **Send test email to me**. Console values win over `RESEND_API_KEY` / `EMAIL_FROM` in the env (web and
worker, re-read within a minute). The key is stored encrypted when `APP_ENCRYPTION_KEY` (or `BETTER_AUTH_SECRET`)
is available, else as entered; it is never shown, logged or audited. Production refuses to send without a key from
either place.

## Bot check on public forms (Cloudflare Turnstile, F9)

Online booking (`/book`), the booking widget (`/book/embed`), **Apply** (`/signup`) and marketing **Contact** check
visitors with Cloudflare Turnstile (managed, invisible unless Cloudflare wants a click), on top of the honeypot and
per-IP limits. Until both keys are set the forms stay open and console → Overview → Configuration shows
`TURNSTILE_*` red. Owner steps:

1. Cloudflare dashboard → **Turnstile** → **Add widget**: name `spamanagement forms`, **Widget mode: Managed**,
   pre-clearance **No**.
2. **Hostnames:** `spamanagement.co` (a hostname also covers its subdomains, so `app.`, `admin.` and every spa's
   `<slug>.spamanagement.co`) and `spamanagement.ae` while the old domain is live.
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

- **Who:** the droplet's base `PLATFORM_ADMIN_EMAILS` (`/opt/spa/.env`, e.g. `ahmed@arks.ae`) **plus**
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

1. `SITE_AI_EDITOR_EMAILS` defaults (compose.yml) to the two owner-chosen super-admins `ahmedabouseif1997@gmail.com`
   and `sefohh.aa45@gmail.com`; a value in `/opt/spa/.env` or the secrets overlay replaces it (comma-separated). Those
   accounts must be super-admins with two-step verification on. Empty = nobody (Studio "Ask AI" is off too).
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

## Client IP (rate limits, audit IPs)

The app takes the visitor's IP from one header only, `Cf-Connecting-Ip`, and Caddy overwrites it on every request:
- **Through Cloudflare** (orange-cloud hosts, or a spa domain proxied by its own Cloudflare account): the TCP peer is a
  Cloudflare edge address, so Caddy keeps Cloudflare's `Cf-Connecting-Ip` (the real visitor).
- **Direct to the droplet** (grey-cloud hosts, spa custom domains, anyone using the droplet IP): the peer is not
  Cloudflare, so Caddy sets `Cf-Connecting-Ip` to the peer itself and a forged header is discarded.
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

`/opt/spa/.env` is written at first boot. To add or rotate secrets later:
1. Encrypt a dotenv file with the key in `/opt/spa/secrets.key`:
   ```sh
   openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -salt -pass file:<key> -in overlay.env -out deploy/droplet/secrets.env.enc
   ```
2. Commit and push.

On its next run the updater decrypts the file and overrides those keys on top of the first-boot `.env`, then rebuilds.

## Hostname

Until a domain is wired in, `SITE_HOST=auto` makes the site answer on `<ip-with-dashes>.sslip.io`, and Caddy gets a
Let's Encrypt certificate for it. Routing is path-based (`/app`, `/admin`, `/s/{slug}`).

Links are domain-agnostic (apps/web/src/server/origin.ts): getting around and signing in use the platform domain the
visitor is on; addresses that are shared, stored or sent use the canonical `SITE_HOST`. The app only needs to know
which domains are ours:
- `SITE_HOST` — the canonical domain (Caddy's main site; `ROOT_DOMAIN`/`APP_URL` derive from it). Every address that
  is shared or stored uses it (spa site links, invites, campaign links), as do CNAME targets and worker jobs.
- `EXTRA_ROOT_DOMAINS` (optional, space or comma separated) — more domains that serve the whole platform. Caddy issues
  their certificates on demand (approved by `/api/domains/allowed`), so no Caddyfile edit is needed.

### Move to a new domain without downtime (spamanagement.ae → spamanagement.co)

The code already speaks spamanagement.co (auth app name, TOTP issuer, copy); staff email still sends from
spamanagement.ae (B1 decision) until step 0 is done. The old domain
keeps working for as long as it is listed in `EXTRA_ROOT_DOMAINS`. Owner checklist, in order:

0. **Email first.** Resend → Domains → add `spamanagement.co`, add the SPF/DKIM (TXT) and return-path (MX/TXT)
   records it shows in Cloudflare DNS (DNS-only), wait for "Verified". Until then nothing to do: the compose default and `DEFAULT_EMAIL_FROM` stay
   `spamanagement.ae <no-reply@spamanagement.ae>`; once verified set `EMAIL_FROM` (step 3).
1. **DNS** (Cloudflare zone `spamanagement.co`, all at the droplet; start **DNS-only / grey cloud** so Caddy can get
   its certificates directly):

   | Type | Name | Content |
   |---|---|---|
   | A | `@` (apex) | droplet IPv4 |
   | CNAME | `www` | `spamanagement.co` |
   | CNAME | `app` | `spamanagement.co` |
   | CNAME | `admin` | `spamanagement.co` |
   | CNAME | `*` | `spamanagement.co` (spa sites `{slug}.spamanagement.co`) |
   | CNAME | `customers` | `spamanagement.co` (CNAME target shown to spas for custom domains) |

   Optionally AAAA records for IPv6. Keep the `.ae` records as they are.
2. **TLS (Caddy, no Caddyfile edit):** the canonical `SITE_HOST` gets its certificate at start; every other host
   (`www.`, `app.`, `admin.`, `{slug}.`, the old domain, spa custom domains) gets one **on demand** on its first
   visit, approved by `/api/domains/allowed` (hosts on `ROOT_DOMAIN` + `EXTRA_ROOT_DOMAINS`, existing spa slugs,
   registered custom domains). After each host has loaded once over HTTPS you may switch the records to **proxied**
   (orange cloud) with SSL/TLS mode **Full (strict)**; leave "Always Use HTTPS" off so HTTP-01 renewals reach Caddy.
3. **Env values**: write an overlay dotenv (see "Secrets without SSH"):
   ```dotenv
   SITE_HOST=spamanagement.co             # canonical: ROOT_DOMAIN derives from it; shared/stored links use it
   EXTRA_ROOT_DOMAINS=spamanagement.ae    # old domain keeps serving the whole platform (keep while links live)
   EMAIL_FROM="spamanagement.co <ask@spamanagement.co>"   # only after step 0 is verified
   ACME_EMAIL=ask@spamanagement.co
   VAPID_SUBJECT=mailto:ask@spamanagement.co
   CF_CNAME_TARGET=customers.spamanagement.co   # only if Cloudflare for SaaS is in use
   # Host routing: add only once the step 1 records resolve for app./admin./*.
   ROUTING=host
   APP_URL=https://app.spamanagement.co
   ADMIN_URL=https://admin.spamanagement.co
   ```
   With path routing (`ROUTING=path`, the default) leave `APP_URL`/`ADMIN_URL` out: they default to
   `https://$SITE_HOST` and `…/admin`. `ROUTING` is a build arg, so the web image rebuilds on the next update.
4. **OAuth callbacks**: add the new domain's URLs (keep the `.ae` ones until nobody connects from there):
   - Google Cloud → Credentials → OAuth client → Authorized redirect URIs:
     `https://app.spamanagement.co/api/integrations/google/callback` (path routing: on the bare domain); OAuth
     consent screen → Authorized domains: add `spamanagement.co`.
   - Meta app → Instagram API with Instagram login → Business login settings → OAuth redirect URIs:
     `https://app.spamanagement.co/api/integrations/meta/callback` (path routing: on the bare domain). Then point the
     Webhooks callback, Deauthorize callback and Data deletion request URLs at the `.co` origin and add
     `spamanagement.co` to App domains.
   - Legal URLs (both consoles; pages in apps/web/src/app/marketing, company details in
     apps/web/src/components/marketing/legal-config.ts): Meta app → Settings → Basic → Privacy policy URL
     `https://spamanagement.co/privacy`, Terms of service URL `https://spamanagement.co/terms`, User data deletion →
     Data deletion instructions URL `https://spamanagement.co/data-deletion`. Google Cloud → OAuth consent screen →
     Application privacy policy link `https://spamanagement.co/privacy`, terms of service link
     `https://spamanagement.co/terms`.
5. **Re-encrypt the overlay**: the updater replaces the previous overlay as a whole, so the plaintext must hold
   every key the current overlay holds (from your own copy) plus the ones above:
   ```sh
   # secrets.key = a copy of /opt/spa/secrets.key
   openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -salt -pass file:secrets.key \
     -in overlay.env -out deploy/droplet/secrets.env.enc
   ```
   Commit and push only `secrets.env.enc` (never `overlay.env` or the key). The droplet applies it within ~2 min
   (or run `spa-update --force`).
6. **Verify**: `https://spamanagement.co/_status/deploy.json` (user `ops`) shows the new commit; sign-in works on
   both domains; a password-reset email arrives from `ask@spamanagement.co`; a spa site loads on
   `{slug}.spamanagement.co` and on the old `{slug}.spamanagement.ae`; new 2FA enrolments show issuer
   "spamanagement.co" (existing authenticator entries keep their old label and still work).
7. Super-admin → Platform settings: update the company name / contact email if they still say `.ae` (the DB column
   default only applies to a fresh install).

Generic rule for any later move: add the new domain to `EXTRA_ROOT_DOMAINS` first, register its OAuth callbacks,
then make it `SITE_HOST` and keep the old one in `EXTRA_ROOT_DOMAINS` so links already sent keep working.

## Creating the droplet

```sh
python3 deploy/droplet/render-user-data.py /path/to/secrets.env > /tmp/user_data.sh   # never commit this
# POST /v2/droplets with { name, region, size: "s-2vcpu-4gb", image: "ubuntu-24-04-x64",
#   user_data: <contents>, ssh_keys: [<account key ids>], monitoring: true, tags: ["spa"] }
```

The secrets file needs these keys:
- `BRANCH`, `REPO_URL`, `SITE_HOST=auto`
- `PLATFORM_ADMIN_EMAILS`, `ACME_EMAIL`, `STATUS_PASSWORD`
- optional `SITE_AI_EDITOR_EMAILS` (Studio "Ask AI" + the Claude connector): unset = compose's default, the two
  owner-chosen super-admins (see "Super-admins"); each must be a super-admin with 2FA; set it to replace the list;
  removing an address cuts access on the next request
- `POSTGRES_SUPERUSER_PASSWORD`, `SPA_OWNER_PASSWORD`, `SPA_PLATFORM_PASSWORD`, `SPA_APP_PASSWORD`
- optional `SPA_DRILL_PASSWORD` (restore-drill role `spa_drill`; unset = derived from `SPA_OWNER_PASSWORD`)
- `BETTER_AUTH_SECRET`, `APP_ENCRYPTION_KEY`, `ARK_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- optional: `NAMECHEAP_API_USER`, `NAMECHEAP_API_KEY`, `SOURCE_DATABASE_URL`
- strongly recommended: `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (off-site DB backups),
  `RESEND_API_KEY` (password reset + email verification fail loudly in production without it; it can also be set later in the console → Settings → Email)
- super-admins: a `PLATFORM_ADMIN_EMAILS` address is promoted only once its email is verified (link or Google
  sign-in), and the console asks every super-admin to set up 2FA (authenticator app) before it opens. See
  "Super-admins" below for the addresses compose appends and how a new one gets its login.

Follow the boot from the droplet's console: `tail -f /var/log/spa-bootstrap.log`.
