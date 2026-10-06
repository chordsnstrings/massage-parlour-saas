# Deploying spamanagement.ae

One DigitalOcean droplet running Docker Compose behind Cloudflare (docs/PLAN.md §3). ≈ USD 36/month.

```
Cloudflare (DNS, SSL, Tunnel, cache) ──tunnel──► cloudflared ─► web (Next.js) ─► postgres
                                                               worker (pg-boss) ─┘   └─► R2 backups
```

## 1. Pick the region (5 minutes, from the pilot spa's internet)

```sh
for r in fra1 lon1 ams3 blr1; do printf "%s " $r; ping -c 10 -q speedtest-$r.digitalocean.com | tail -1; done
```
Default is **FRA1** (≈ 90 ms from Dubai). Use whichever is lowest.

## 2. Droplet

1. Create a **Premium AMD 4 GB / 2 vCPU** droplet (Ubuntu 24.04) in that region, with **daily backups** and an SSH key.
2. Install Docker: `curl -fsSL https://get.docker.com | sh`
3. Firewall (DO Cloud Firewall): inbound **SSH only** (ideally from your IP). No 80/443 — traffic arrives through the tunnel.
4. Deploy user: `adduser deploy && usermod -aG docker deploy`, add the GitHub Actions public key to `~deploy/.ssh/authorized_keys`.
5. `sudo mkdir -p /opt/spa && sudo chown deploy /opt/spa`, then create `/opt/spa/.env` from `deploy/.env.example` (`chmod 600`).
6. Let the droplet pull private images: `docker login ghcr.io -u <github-user>` with a PAT that has `read:packages`.

## 3. Cloudflare

1. Add the `spamanagement.ae` zone (Free plan) and point the registrar's nameservers to Cloudflare.
2. SSL/TLS → **Full (strict)**; Edge certificates → Always use HTTPS.
3. Zero Trust → Networks → **Tunnels** → Create (cloudflared). Copy the token into `CLOUDFLARE_TUNNEL_TOKEN`.
   Public hostnames, all → `http://web:3000`:
   `spamanagement.ae`, `www.spamanagement.ae`, `app.spamanagement.ae`, `admin.spamanagement.ae`, `*.spamanagement.ae`.
4. Optional, recommended: Zero Trust → Access → protect `admin.spamanagement.ae` with an email one-time PIN policy.
5. **R2**: create bucket `spa-backups`; lifecycle rules: delete `backups/daily/` after 30 days, `backups/monthly/` after 365 days;
   create an R2 API token (object read & write on that bucket) → `R2_*` in `.env`.
6. Custom domains for spas (Phase 2): SSL/TLS → Custom Hostnames → enable Cloudflare for SaaS, fallback origin `customers.spamanagement.ae` (tunnel hostname).

## 4. GitHub

- Secrets: `DROPLET_HOST`, `DROPLET_USER` (`deploy`), `DROPLET_SSH_KEY` (private key).
- Variables: `DEPLOY_ENABLED=true`, `ROOT_DOMAIN=spamanagement.ae`.
- Environment `production` (optionally with required reviewers).

Every push to `main` builds `ghcr.io/<owner>/spa-{web,worker}:<sha>`, uploads the compose files, runs migrations (`migrate` service), and rolls out with health checks.
**Rollback:** Actions → Deploy → Run workflow → tag = an earlier commit SHA.

## 5. First boot

```sh
cd /opt/spa && docker compose up -d --wait   # postgres initialises roles from bootstrap.sql on first start
docker compose logs -f web worker
```
Sign up at `https://app.spamanagement.ae/signup` with an email listed in `PLATFORM_ADMIN_EMAILS` — that account becomes super-admin
(console at `https://admin.spamanagement.ae`). Then fill in **Company** details and check **Plans & prices**.

## Backups & restore drill (monthly)

Nightly 03:30 Dubai: `pg_dump -Fc` → `r2://spa-backups/backups/daily/YYYY-MM-DD.dump` (+ `monthly/` on the 1st). Plus DO daily disk backups.

```sh
# on the droplet: restore the latest dump into a scratch database and sanity-check it
aws s3 cp --endpoint-url "$R2_ENDPOINT" s3://spa-backups/backups/daily/$(date +%F).dump /tmp/latest.dump
docker compose exec -T postgres createdb -U postgres restore_check
docker compose exec -T postgres pg_restore -U postgres -d restore_check --no-owner < /tmp/latest.dump
docker compose exec -T postgres psql -U postgres -d restore_check -c 'select count(*) from tenants'
docker compose exec -T postgres dropdb -U postgres restore_check
```

## Scaling path

1. DO Managed PostgreSQL (USD 15, point-in-time recovery) — change the three `DATABASE_URL_*`; RLS policies are role-based, no BYPASSRLS needed.
2. Bigger droplet, or a second web droplet behind Cloudflare Load Balancing.
