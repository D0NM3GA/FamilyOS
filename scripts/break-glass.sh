#!/usr/bin/env bash
# Phase 42.7: the break-glass entrance, for when Cloudflare is down (README "Break-glass").
#
#   sudo scripts/break-glass.sh on [hours]   # at most 24, default 24
#   sudo scripts/break-glass.sh off
#   sudo scripts/break-glass.sh status
#   sudo scripts/break-glass.sh check         # from cron every 10 minutes: ends an expired one
#
# "on" writes a state file with a fresh random secret and when it ends, readable only by the
# app's user, and starts Caddy on the VM's home-network address (BREAK_GLASS_LAN_IP) for the
# app's own hostname. The app lets a request skip the Cloudflare Access check only when Caddy's
# secret matches an unexpired state file; the app's own sign-in is still required. Every admin
# is told when it starts and ends, and every page shows a banner while it's on.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

env_file="${FAMILYOS_ENV_FILE:-/etc/familyos/familyos.env}"
dir="${FAMILYOS_BREAK_GLASS_DIR:-/etc/familyos/break-glass}"
certs="${FAMILYOS_BREAK_GLASS_CERTS:-/etc/familyos/break-glass-certs}"
state="$dir/state.json"
compose=(docker compose ${COMPOSE_PROJECT:+-p "$COMPOSE_PROJECT"} -f docker-compose.prod.yml)
# Root, so the state file can belong to the app's user (uid 1000) and no one else: without it the
# app can't read the file on Linux and "on" would quietly let nobody in (Fable's review).
# BREAK_GLASS_ALLOW_NONROOT=1 only for a test on Docker Desktop, which ignores file owners.
if [ "$(id -u)" != 0 ] && [ -z "${BREAK_GLASS_ALLOW_NONROOT:-}" ] && [ "${1:-status}" != status ]; then
  echo "Run it with sudo: sudo $0 $*" >&2
  exit 1
fi
log() { echo "$(date -u +%FT%TZ) break-glass: $*"; command -v logger > /dev/null && logger -t familyos "break-glass: $*" || true; }
setting() { sed -n "s/^$1=//p" "$env_file" | tail -n1 | sed 's/^"\(.*\)"$/\1/'; }

off() {
  rm -f "$state"
  "${compose[@]}" --profile breakglass rm -sf breakglass > /dev/null 2>&1 || true
  log "off"
}

case "${1:-status}" in
  on)
    hours="${2:-24}"
    [[ "$hours" =~ ^[0-9]+$ ]] && (( hours >= 1 && hours <= 24 )) || { echo "hours: 1 to 24" >&2; exit 1; }
    export BREAK_GLASS_LAN_IP="${BREAK_GLASS_LAN_IP:-$(setting BREAK_GLASS_LAN_IP)}"
    [ -n "$BREAK_GLASS_LAN_IP" ] || { echo "Set BREAK_GLASS_LAN_IP (the VM's home-network address) in $env_file." >&2; exit 1; }
    [ -s "$certs/site.crt" ] && [ -s "$certs/site.key" ] || { echo "No certificate in $certs: run scripts/break-glass-cert.sh first." >&2; exit 1; }
    host="$(setting BETTER_AUTH_URL | sed -E 's#^https?://##; s#[:/].*$##')"
    [ -n "$host" ] || { echo "No BETTER_AUTH_URL in $env_file." >&2; exit 1; }
    secret="$(openssl rand -hex 32)"
    id="bg-$(date -u +%Y%m%d%H%M%S)-$(openssl rand -hex 4)"
    started="$(date -u +%FT%TZ)"
    ends="$(date -u -d "+$hours hours" +%FT%TZ 2>/dev/null || date -u -v+"$hours"H +%FT%TZ)"
    mkdir -p "$dir"
    printf '{"id":"%s","secret":"%s","startedAt":"%s","endsAt":"%s"}\n' "$id" "$secret" "$started" "$ends" > "$state.tmp"
    # The app runs as uid 1000 (the node user); nobody else needs to read it.
    if [ "$(id -u)" = 0 ]; then
      chown "${BREAK_GLASS_APP_UID:-1000}:${BREAK_GLASS_APP_UID:-1000}" "$state.tmp"
    fi
    chmod 400 "$state.tmp"
    mv "$state.tmp" "$state"
    FAMILYOS_HOSTNAME="$host" BREAK_GLASS_SECRET="$secret" "${compose[@]}" --profile breakglass up -d --no-deps breakglass
    log "on until $ends ($id) at https://$host on $BREAK_GLASS_LAN_IP"
    echo "Point $host at $BREAK_GLASS_LAN_IP on the devices that need it (router or hosts file), then open https://$host."
    ;;
  off)
    off
    ;;
  check)
    if [ -f "$state" ]; then
      ends="$(sed -n 's/.*"endsAt":"\([^"]*\)".*/\1/p' "$state")"
      now="$(date -u +%FT%TZ)"
      [[ "$now" > "$ends" ]] && { log "ran out at $ends"; off; }
    fi
    ;;
  status)
    if [ -f "$state" ]; then echo "on until $(sed -n 's/.*"endsAt":"\([^"]*\)".*/\1/p' "$state")"; else echo "off"; fi
    ;;
  *)
    echo "Usage: $0 on [hours] | off | status | check" >&2
    exit 1
    ;;
esac
