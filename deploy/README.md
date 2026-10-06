# Deployment

Production is a single DigitalOcean droplet running Docker Compose. See [droplet/README.md](droplet/README.md) for:
- first boot
- pull-based updates
- secrets
- backups and status

`postgres/init/` holds the first-start database bootstrap the stack mounts. CI (`.github/workflows/ci.yml`) checks every push; the droplet deploys whatever lands on the deploy branch.
