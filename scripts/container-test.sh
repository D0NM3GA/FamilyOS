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
# Phase 46: built here under a local tag, never a published one (docker-compose.build.yml).
export FAMILYOS_VERSION="${FAMILYOS_VERSION:-local}"
compose=(docker compose -p familyos-test -f docker-compose.prod.yml -f docker-compose.build.yml -f docker-compose.ci.yml)
cleanup() {
  "${compose[@]}" logs app > "${CONTAINER_LOG:-/dev/null}" 2>&1 || true
  "${compose[@]}" down -v --remove-orphans > /dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

key() { node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"; }
# Phase 49: the server's TZ is deliberately not the browser's. Setup takes the household's zone
# from the browser, and the app then keeps the household's time, so the pages must still agree
# with the browser (a mismatch would be a hydration error the browser tests catch).
browser_zone="$(node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)")"
zone="Pacific/Kiritimati"
test "$browser_zone" != "$zone" || zone="Pacific/Pago_Pago"
password="$(node -e "console.log(require('crypto').randomBytes(18).toString('hex'))")"
mkdir -p "$work/secrets"
printf '%s' "$password" > "$work/secrets/db_password"
printf 'unused' > "$work/secrets/tunnel_token"
printf 'unused' > "$work/secrets/cf_dns_token"
mkdir -p "$work/break-glass"
cat > "$work/familyos.env" <<ENV
BETTER_AUTH_URL=http://localhost:3100
MIGRATE_DATABASE_URL=postgresql://familyos:${password}@db:5432/familyos?schema=public
DATABASE_URL=postgresql://familyos_app:${password}app@db:5432/familyos?schema=public
BETTER_AUTH_SECRET=$(key)
INTEGRATION_ENCRYPTION_KEY=$(key)
TRUSTED_PROXIES=
TZ=${zone}
ENV
export FAMILYOS_ENV_FILE="$work/familyos.env" FAMILYOS_SECRETS_DIR="$work/secrets" FAMILYOS_BREAK_GLASS_DIR="$work/break-glass"

"${compose[@]}" down -v --remove-orphans > /dev/null 2>&1 || true
# Phase 46: built with decoy Sentry settings in the environment. The image is published, so
# nothing from the machine that builds it may end up inside; the checks below look for these.
NEXT_PUBLIC_SENTRY_DSN=https://decoy@o0.ingest.example/1 SENTRY_DSN=https://decoy@o0.ingest.example/2 \
  "${compose[@]}" up -d --build --wait db migrate app

# The run image: nothing secret, nothing from the build machine, no development tools, not root.
image="$("${compose[@]}" images -q app | head -n1)"
docker run --rm --entrypoint sh "$image" -c '
  set -e
  test "$(id -u)" != 0 || { echo "runs as root"; exit 1; }
  for f in .env .env.production familyos.env; do test ! -e "$f" || { echo "$f is in the image"; exit 1; }; done
  for p in prisma typescript vitest tsx @playwright; do test ! -e "node_modules/$p" || { echo "$p is in the image"; exit 1; }; done
  ls node_modules/argon2/prebuilds/linux-* > /dev/null
  ! env | grep -q "^NEXT_PUBLIC_" || { echo "a NEXT_PUBLIC_ value is in the image"; exit 1; }
  ! grep -rqE "decoy@o0|@o[0-9]+\.ingest\." .next server.js 2>/dev/null || { echo "a Sentry address is built into the image"; exit 1; }
  echo "run image: ok"
'

# Phase 48: the migrate image is Prisma's CLI and the migrations, nothing more: not root, no
# settings, no app or its tools, no seeds, and the CLI still starts.
migrate_image="$("${compose[@]}" images -q migrate | head -n1)"
docker run --rm --entrypoint sh "$migrate_image" -c '
  set -e
  test "$(id -u)" != 0 || { echo "runs as root"; exit 1; }
  for f in .env .env.production familyos.env .npmrc package-lock.json prisma/seed.ts .next; do test ! -e "$f" || { echo "$f is in the migrate image"; exit 1; }; done
  for p in next typescript vitest tsx @playwright/test @prisma/client; do test ! -e "node_modules/$p" || { echo "$p is in the migrate image"; exit 1; }; done
  test -z "$(find node_modules -maxdepth 1 -type d -empty)" || { echo "empty folders are left in node_modules"; exit 1; }
  node_modules/.bin/prisma migrate --help > /dev/null
  echo "migrate image: ok"
'

# Uncompressed, as Docker stores them locally (a push is about a third of it). The migrate image was
# 2.26 GB when it carried the whole install; the budget keeps that from coming back unnoticed.
size_mb() { echo $(( $(docker image inspect --format '{{.Size}}' "$1") / 1000000 )); }
echo "image sizes: app $(size_mb "$image") MB, migrate $(size_mb "$migrate_image") MB"
test "$(size_mb "$migrate_image")" -le 1000 || { echo "the migrate image is over its 1 GB budget" >&2; exit 1; }

E2E_BASE_URL=http://localhost:3100 npx playwright test "$@"

# Phase 42.6: the restore drill, for real: the household the browser tests just made, backed up by
# the nightly script and restored into a throwaway stack.
# Phase 61: encrypted with a throwaway age key, which the drill then decrypts with; and a backup
# with no public key is refused rather than made in the clear.
mkdir -p "$work/backups"
age-keygen -o "$work/backup-key.txt" 2> /dev/null
age-keygen -y "$work/backup-key.txt" > "$work/backup-recipients.txt"
if COMPOSE_PROJECT=familyos-test BACKUP_DIR="$work/backups" BACKUP_AGE_RECIPIENTS="$work/none.txt" scripts/backup-prod.sh 2> /dev/null; then
  echo "backup-prod.sh made a backup without a public key" >&2
  exit 1
fi
test -z "$(ls "$work"/backups/ 2> /dev/null)" || { echo "a refused backup left a file behind" >&2; exit 1; }
# Phase 67c: as if it were a Sunday and the 1st, so the weekly and monthly copies are made too.
COMPOSE_PROJECT=familyos-test BACKUP_DIR="$work/backups" BACKUP_AGE_RECIPIENTS="$work/backup-recipients.txt" BACKUP_TIERS="weekly monthly" scripts/backup-prod.sh
test -z "$(ls "$work"/backups/*.dump 2> /dev/null)" || { echo "a plain dump was left beside the encrypted one" >&2; exit 1; }
for tier in weekly monthly; do
  ls "$work"/backups/$tier/familyos-*.dump.age > /dev/null 2>&1 && ls "$work"/backups/$tier/familyos-*.dump.age.counts > /dev/null 2>&1 \
    || { echo "no $tier copy (with its counts) was kept" >&2; exit 1; }
done
AGE_IDENTITY_FILE="$work/backup-key.txt" scripts/restore-drill.sh "$(ls "$work"/backups/familyos-*.dump.age | head -n1)"
