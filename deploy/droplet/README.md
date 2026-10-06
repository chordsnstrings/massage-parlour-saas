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

When `spamanagement.ae` is ready:
1. point `app.`, `admin.` and `*.` at the droplet (or put Cloudflare in front)
2. set `SITE_HOST`, switch `ROUTING=host`, and extend the Caddyfile with the extra hosts
3. run `spa-update --force`

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
