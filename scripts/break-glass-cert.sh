#!/usr/bin/env bash
# Phase 42.7: keeps the break-glass entrance's certificate current, while Cloudflare is up, so
# the entrance still works during an outage (a Let's Encrypt certificate lasts 90 days). Weekly
# from root's cron:
#
#   0 4 * * 1  /opt/familyos/scripts/break-glass-cert.sh >> /var/log/familyos-cert.log 2>&1
#
# lego (pinned in docker-compose.prod.yml) gets or renews the certificate for the app's own
# hostname by DNS challenge, with a Cloudflare API token that can only edit that zone's DNS
# (secrets/cf_dns_token). The certificate and key are then copied to where Caddy reads them.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

env_file="${FAMILYOS_ENV_FILE:-/etc/familyos/familyos.env}"
certs="${FAMILYOS_BREAK_GLASS_CERTS:-/etc/familyos/break-glass-certs}"
lego_dir="${FAMILYOS_LEGO_DIR:-/var/lib/familyos/lego}"
compose=(docker compose ${COMPOSE_PROJECT:+-p "$COMPOSE_PROJECT"} -f docker-compose.prod.yml)
setting() { sed -n "s/^$1=//p" "$env_file" | tail -n1 | sed 's/^"\(.*\)"$/\1/'; }

host="$(setting BETTER_AUTH_URL | sed -E 's#^https?://##; s#[:/].*$##')"
email="$(setting CONTACT_EMAIL)"
[ -n "$host" ] || { echo "No BETTER_AUTH_URL in $env_file." >&2; exit 1; }
[ -n "$email" ] || { echo "Set CONTACT_EMAIL in $env_file (Let's Encrypt's contact)." >&2; exit 1; }

mkdir -p "$lego_dir" "$certs"
"${compose[@]}" --profile cert run --rm cert --accept-tos --email "$email" --domains "$host" --dns cloudflare --path /data run

crt="$(find "$lego_dir" -name "$host.crt" -print -quit)"
key="$(find "$lego_dir" -name "$host.key" -print -quit)"
[ -n "$crt" ] && [ -n "$key" ] || { echo "lego made no certificate for $host in $lego_dir" >&2; exit 1; }
install -m 600 "$crt" "$certs/site.crt"
install -m 600 "$key" "$certs/site.key"
echo "$(date -u +%FT%TZ) break-glass certificate for $host is current"
