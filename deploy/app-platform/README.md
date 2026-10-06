# DigitalOcean App Platform deployment (current live environment)

Live (single-hostname / path routing): **https://spamanagement-6g3mi.ondigitalocean.app**

| Path | Surface |
|---|---|
| `/` | Marketing site |
| `/app/…` | Spa dashboards (sign up at `/app/signup`) |
| `/admin/…` | Super-admin console (accounts listed in `PLATFORM_ADMIN_EMAILS`) |
| `/s/{slug}/…` | Each spa's public website (online booking at `/s/{slug}/book`) |

When `spamanagement.ae` is registered: add it (and `*.spamanagement.ae`) as App Platform domains, set
`NEXT_PUBLIC_ROUTING=host`, `ROOT_DOMAIN=spamanagement.ae`, `APP_URL=https://app.spamanagement.ae`,
`ADMIN_URL=https://admin.spamanagement.ae`, and redeploy. No code changes are needed.

## Resources (DO project "spamanagement", region FRA1)

| Component | Spec | ≈ USD/month |
|---|---|---|
| `web` service | Next.js standalone, `apps/web/Dockerfile`, 1 GB | 10 |
| `worker` | pg-boss jobs, `apps/worker/Dockerfile`, 0.5 GB | 5 |
| `migrate` pre-deploy job | `bootstrap.sql` (roles, idempotent) → migrations → seed | per run |
| `spa-db` | Managed PostgreSQL 16, 1 GB, daily backups + PITR, trusted source = the app only | 15 |

Secrets (database role passwords, `BETTER_AUTH_SECRET`, `ARK_API_KEY`) are App Platform encrypted env vars.
The database CA is bound with `${db.CA_CERT}` so connections are TLS-verified.

## Deploying

```sh
DO_TOKEN=… APP_ID=542aa4f1-be22-4a88-b69e-9ed4257bfcff bash scripts/do-deploy.sh
```
Or automatically: add the repository secret `DIGITALOCEAN_ACCESS_TOKEN`, variables `DO_APP_ID` and `DO_APP_URL`;
`.github/workflows/deploy-app-platform.yml` then redeploys after CI passes on `main`.

The pre-deploy job applies new migrations before traffic moves, so schema changes ship with the code.
