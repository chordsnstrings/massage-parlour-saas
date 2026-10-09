#!/bin/bash
# First-boot setup for the single production droplet (Ubuntu 24.04). Rendered with secrets by the operator and
# passed as DigitalOcean user_data — never commit a rendered copy. Placeholders: __VAR__.
set -euxo pipefail
exec > >(tee -a /var/log/spa-bootstrap.log) 2>&1

BRANCH="__BRANCH__"
REPO_URL="__REPO_URL__"
SOURCE_DATABASE_URL="__SOURCE_DATABASE_URL__"   # optional: copy data from an existing database once

mkdir -p /opt/spa/status /opt/spa/backups
echo '{"state":"provisioning","message":"installing docker"}' > /opt/spa/status/deploy.json

# Swap so the Next.js build fits next to Postgres.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git ufw unattended-upgrades
# G8: rotate container logs (5 × 10 MB per container) from the first Docker start; update.sh re-applies it.
mkdir -p /etc/docker
[ -f /etc/docker/daemon.json ] || cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }
JSON
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable

IP=$(curl -fsS http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address)
SITE_HOST="__SITE_HOST__"
[ "$SITE_HOST" = "auto" ] && SITE_HOST="${IP//./-}.sslip.io"

[ -d /opt/spa/repo/.git ] || git clone --branch "$BRANCH" "$REPO_URL" /opt/spa/repo
echo "$BRANCH" > /opt/spa/branch

umask 077; printf '%s' "__SECRETS_KEY__" > /opt/spa/secrets.key; umask 022
STATUS_HASH=$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "__STATUS_PASSWORD__")
umask 077
cat > /opt/spa/.env <<ENV
SITE_HOST=$SITE_HOST
ROUTING=path
PLATFORM_ADMIN_EMAILS=__PLATFORM_ADMIN_EMAILS__
ACME_EMAIL=__ACME_EMAIL__
POSTGRES_SUPERUSER_PASSWORD=__POSTGRES_SUPERUSER_PASSWORD__
SPA_OWNER_PASSWORD=__SPA_OWNER_PASSWORD__
SPA_PLATFORM_PASSWORD=__SPA_PLATFORM_PASSWORD__
SPA_APP_PASSWORD=__SPA_APP_PASSWORD__
SPA_DRILL_PASSWORD=__SPA_DRILL_PASSWORD__
BETTER_AUTH_SECRET=__BETTER_AUTH_SECRET__
APP_ENCRYPTION_KEY=__APP_ENCRYPTION_KEY__
ARK_API_KEY=__ARK_API_KEY__
VAPID_PUBLIC_KEY=__VAPID_PUBLIC_KEY__
VAPID_PRIVATE_KEY=__VAPID_PRIVATE_KEY__
VAPID_SUBJECT=mailto:__ACME_EMAIL__
NAMECHEAP_API_USER=__NAMECHEAP_API_USER__
NAMECHEAP_API_KEY=__NAMECHEAP_API_KEY__
NAMECHEAP_CLIENT_IP=$IP
STATUS_USER=ops
STATUS_HASH='$STATUS_HASH'
ENV
umask 022

cd /opt/spa/repo/deploy/droplet
docker compose --env-file /opt/spa/.env up -d postgres
for _ in $(seq 1 60); do docker compose --env-file /opt/spa/.env exec -T postgres pg_isready -U postgres -d spa && break; sleep 3; done

# One-time data copy from the previous database (as its owner role, so row-level security doesn't hide rows).
if [ -n "$SOURCE_DATABASE_URL" ] && [ ! -f /opt/spa/status/data-copied ]; then
  echo '{"state":"provisioning","message":"copying data"}' > /opt/spa/status/deploy.json
  for _ in $(seq 1 40); do
    if docker compose --env-file /opt/spa/.env exec -T postgres sh -c \
      "pg_dump --format=custom --no-owner --no-privileges -d '$SOURCE_DATABASE_URL' -f /backups/source.dump"; then
      docker compose --env-file /opt/spa/.env exec -T postgres sh -c \
        "pg_restore --no-owner --role=spa_owner -U postgres -d spa /backups/source.dump" || true
      touch /opt/spa/status/data-copied
      break
    fi
    sleep 15   # the source firewall may not allow this droplet yet
  done
fi

install -m 755 update.sh /usr/local/bin/spa-update
cat > /etc/systemd/system/spa-update.service <<UNIT
[Unit]
Description=spamanagement deploy updater
After=docker.service network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/spa-update
UNIT
cat > /etc/systemd/system/spa-update.timer <<UNIT
[Unit]
Description=Check for new commits every 2 minutes
[Timer]
OnBootSec=1min
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
UNIT
# Nightly logical backup kept for 7 days (managed off-site backups: R2 via the worker job when configured).
cat > /etc/cron.d/spa-backup <<CRON
30 23 * * * root cd /opt/spa/repo/deploy/droplet && docker compose --env-file /opt/spa/.env exec -T postgres pg_dump -U postgres -Fc spa -f /backups/spa-\$(date +\%u).dump
CRON
systemctl daemon-reload
systemctl enable --now spa-update.timer
/usr/local/bin/spa-update --force || true
