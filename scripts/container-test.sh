#!/usr/bin/env bash
# Phase 43: the browser tests against the production image (README "Running in production").
# Builds the image, starts db, migrate and app on a fresh database with throwaway settings (the
# app on http://localhost:3100, no tunnel), checks the run image, runs Playwright against it,
# backs up what the tests made and restores it with the drill (Phase 42.6), then takes it all
# down again. CI runs it; on a Mac it needs Docker Desktop.
set -euo pipefail
cd "$(dirname "$0")/.."

# The app is published on 3100, as `npm run test:e2e` uses: say so plainly if it's taken.
if (exec 3<>/dev/tcp/127.0.0.1/3100) 2>/dev/null; then
  echo "Port 3100 is in use (a test:e2e run, or an earlier stack): stop it first." >&2
  exit 1
fi

work="$(mktemp -d)"
compose=(docker compose -p familyos-test -f docker-compose.prod.yml -f docker-compose.ci.yml)
cleanup() {
  "${compose[@]}" logs app > "${CONTAINER_LOG:-/dev/null}" 2>&1 || true
  "${compose[@]}" down -v --remove-orphans > /dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

key() { node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"; }
# The browser's zone and the server's must agree, or pages render dates differently on each side.
zone="$(node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)")"
password="$(node -e "console.log(require('crypto').randomBytes(18).toString('hex'))")"
mkdir -p "$work/secrets"
printf '%s' "$password" > "$work/secrets/db_password"
printf 'unused' > "$work/secrets/tunnel_token"
printf 'unused' > "$work/secrets/cf_dns_token"
mkdir -p "$work/break-glass"
cat > "$work/familyos.env" <<ENV
BETTER_AUTH_URL=http://localhost:3100
DATABASE_URL=postgresql://familyos:${password}@db:5432/familyos?schema=public
BETTER_AUTH_SECRET=$(key)
INTEGRATION_ENCRYPTION_KEY=$(key)
TRUSTED_PROXIES=
TZ=${zone}
ENV
export FAMILYOS_ENV_FILE="$work/familyos.env" FAMILYOS_SECRETS_DIR="$work/secrets" FAMILYOS_BREAK_GLASS_DIR="$work/break-glass"

"${compose[@]}" down -v --remove-orphans > /dev/null 2>&1 || true
"${compose[@]}" up -d --build --wait db migrate app

# The run image: nothing secret, no development tools, not root.
image="$("${compose[@]}" images -q app | head -n1)"
docker run --rm --entrypoint sh "$image" -c '
  set -e
  test "$(id -u)" != 0 || { echo "runs as root"; exit 1; }
  for f in .env .env.production familyos.env; do test ! -e "$f" || { echo "$f is in the image"; exit 1; }; done
  for p in prisma typescript vitest tsx @playwright; do test ! -e "node_modules/$p" || { echo "$p is in the image"; exit 1; }; done
  ls node_modules/argon2/prebuilds/linux-* > /dev/null
  echo "run image: ok"
'

E2E_BASE_URL=http://localhost:3100 npx playwright test "$@"

# Phase 42.6: the restore drill, for real: the household the browser tests just made, backed up by
# the nightly script and restored into a throwaway stack.
mkdir -p "$work/backups"
COMPOSE_PROJECT=familyos-test BACKUP_DIR="$work/backups" scripts/backup-prod.sh
scripts/restore-drill.sh "$(ls "$work"/backups/familyos-*.dump | head -n1)"
