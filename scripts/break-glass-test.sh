#!/usr/bin/env bash
# Phase 42.7: rehearses the break-glass entrance against the production image, on this machine
# or in CI (after scripts/container-test.sh has built it). The app runs with the Cloudflare
# Access check on (a made-up team) and no Access in front, so everything but the health check
# is refused; then the entrance is switched on with a throwaway certificate for localhost and
# requests through it get in (even when the client sends its own break-glass header: the entrance
# overwrites it), a forged header sent straight to the app doesn't, `check` ends an expired one,
# and switching it off closes it again. Not covered: signing in through the entrance (here it's
# https://localhost:8443 while the app's address is http://localhost:3100; on the server both are
# the same hostname, which is what passkeys need).
set -euo pipefail
cd "$(dirname "$0")/.."

work="$(mktemp -d)"
export COMPOSE_PROJECT=familyos-bgtest
compose=(docker compose -p "$COMPOSE_PROJECT" -f docker-compose.prod.yml -f docker-compose.ci.yml)
cleanup() {
  "${compose[@]}" --profile breakglass down -v --remove-orphans > /dev/null 2>&1 || true
  # The certificate and state file belong to root by now (as on the server).
  as_root rm -rf "$work" 2>/dev/null || rm -rf "$work" 2>/dev/null || true
}
trap cleanup EXIT
fail() {
  echo "FAIL: $*" >&2
  # What the entrance and the app said, so a failure only one platform shows can be read in CI.
  "${compose[@]}" --profile breakglass logs --tail 40 breakglass app >&2 || true
  exit 1
}
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
# The script needs root on Linux (the state file belongs to the app's user); Docker Desktop on a
# Mac ignores file owners.
as_root() {
  if [ "$(id -u)" = 0 ]; then "$@"
  elif [ "$(uname)" = Darwin ]; then BREAK_GLASS_ALLOW_NONROOT=1 "$@"
  else sudo -E "$@"
  fi
}

key() { node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"; }
password="$(openssl rand -hex 18)"
mkdir -p "$work/secrets" "$work/break-glass" "$work/certs"
printf '%s' "$password" > "$work/secrets/db_password"
printf 'unused' > "$work/secrets/tunnel_token"
printf 'unused' > "$work/secrets/cf_dns_token"
cat > "$work/familyos.env" <<ENV
BETTER_AUTH_URL=http://localhost:3100
DATABASE_URL=postgresql://familyos:${password}@db:5432/familyos?schema=public
BETTER_AUTH_SECRET=$(key)
INTEGRATION_ENCRYPTION_KEY=$(key)
BACKGROUND_JOBS=0
CF_ACCESS_TEAM_DOMAIN=rehearsal.cloudflareaccess.com
CF_ACCESS_AUD=rehearsal-aud
ENV
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost" \
  -keyout "$work/certs/site.key" -out "$work/certs/site.crt" > /dev/null 2>&1
# As on the server, where scripts/break-glass-cert.sh (root) installs them: owned by root, 600.
# Caddy runs as root without any capabilities, so it can't read another user's 600 key.
as_root chown -R 0:0 "$work/certs" 2>/dev/null || true
export FAMILYOS_ENV_FILE="$work/familyos.env" FAMILYOS_SECRETS_DIR="$work/secrets" \
  FAMILYOS_BREAK_GLASS_DIR="$work/break-glass" FAMILYOS_BREAK_GLASS_CERTS="$work/certs" \
  BREAK_GLASS_LAN_IP=127.0.0.1 BREAK_GLASS_PORT=8443

"${compose[@]}" down -v --remove-orphans > /dev/null 2>&1 || true
"${compose[@]}" up -d --build --wait db migrate app > /dev/null

# Access on, nothing in front: only the health check answers.
[ "$(status http://localhost:3100/api/auth/ok)" = 200 ] || fail "the health check should answer"
[ "$(status http://localhost:3100/sign-in)" = 403 ] || fail "a request without an Access token should be refused"
[ "$(status -H 'Cf-Access-Jwt-Assertion: a.b.c' http://localhost:3100/sign-in)" = 403 ] || fail "a fake Access token should be refused"

as_root scripts/break-glass.sh on 1
# A fresh install's setup page answers 200 once a request is let in.
for _ in $(seq 1 30); do [ "$(status -k https://localhost:8443/setup)" = 200 ] && break; sleep 1; done
[ "$(status -k https://localhost:8443/setup)" = 200 ] || fail "the break-glass entrance should let a request in"
[ "$(status -k -H "X-FamilyOS-Break-Glass: nope" https://localhost:8443/setup)" = 200 ] || fail "the entrance should replace a client's own break-glass header"
secret="$(as_root sed -n 's/.*"secret":"\([^"]*\)".*/\1/p' "$work/break-glass/state.json")"
[ "$(status -H "X-FamilyOS-Break-Glass: nope" http://localhost:3100/setup)" = 403 ] || fail "a wrong break-glass header should be refused"
# Even the right secret only counts while the entrance is on (checked after switching off).

# `check` (cron) ends one that's run out: make this one look expired, then check.
as_root sed -i.bak 's/"endsAt":"[^"]*"/"endsAt":"2000-01-01T00:00:00Z"/' "$work/break-glass/state.json"
as_root env BREAK_GLASS_ALLOW_NONROOT=1 scripts/break-glass.sh check
[ ! -e "$work/break-glass/state.json" ] || fail "check should end an expired entrance"
as_root scripts/break-glass.sh off
sleep 6 # the app re-reads the state file every few seconds
[ "$(status -H "X-FamilyOS-Break-Glass: $secret" http://localhost:3100/setup)" = 403 ] || fail "the old secret should stop working once it's off"
[ "$(status -k --max-time 3 https://localhost:8443/setup)" != 200 ] || fail "the entrance should be gone once it's off"
echo "break-glass rehearsal: ok"
