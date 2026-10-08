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
  - On a new commit on the branch it rebuilds the images on the droplet, runs migrations (`migrate` service) and restarts.
  - Pushing to the branch is all it takes. No SSH or CI secrets are needed.
  - Force a redeploy with `sudo spa-update --force`.
- **Status:**
  - `https://<host>/_status/deploy.json`, `build.log` and `runtime.txt` (container states and the last log lines, credentials redacted)
  - basic auth, user `ops`, password = `STATUS_PASSWORD` from the render step
- **Backups:**
  - nightly `pg_dump` into `/opt/spa/backups` (7 rolling days)
  - off-site to R2 via the worker's `db-backup` job when `R2_*` is set
  - enable DigitalOcean droplet backups for whole-machine snapshots

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

The code already speaks spamanagement.co (auth app name, TOTP issuer, email sender default, copy). The old domain
keeps working for as long as it is listed in `EXTRA_ROOT_DOMAINS`. Owner checklist, in order:

0. **Email first.** Resend → Domains → add `spamanagement.co`, add the SPF/DKIM (TXT) and return-path (MX/TXT)
   records it shows in Cloudflare DNS (DNS-only), wait for "Verified". Until then pin
   `EMAIL_FROM="spamanagement.ae <no-reply@spamanagement.ae>"` in the overlay: the compose default is now `.co`, so
   sends fail while `.co` is unverified.
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
   EMAIL_FROM="spamanagement.co <no-reply@spamanagement.co>"   # only after step 0 is verified
   ACME_EMAIL=ops@spamanagement.co
   VAPID_SUBJECT=mailto:support@spamanagement.co
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
   both domains; a password-reset email arrives from `no-reply@spamanagement.co`; a spa site loads on
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
- `POSTGRES_SUPERUSER_PASSWORD`, `SPA_OWNER_PASSWORD`, `SPA_PLATFORM_PASSWORD`, `SPA_APP_PASSWORD`
- `BETTER_AUTH_SECRET`, `APP_ENCRYPTION_KEY`, `ARK_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- optional: `NAMECHEAP_API_USER`, `NAMECHEAP_API_KEY`, `SOURCE_DATABASE_URL`

Follow the boot from the droplet's console: `tail -f /var/log/spa-bootstrap.log`.
