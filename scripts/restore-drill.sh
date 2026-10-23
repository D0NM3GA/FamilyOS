#!/usr/bin/env bash
# Phase 42.6: the restore drill (README "Restore drill"). Restores a dump made by
# scripts/backup-prod.sh into a throwaway stack that can't touch anything real, and checks it:
#
#   scripts/restore-drill.sh /var/backups/familyos/familyos-<time>.dump
#
# The throwaway stack (-p familyos-drill) has its own database volume, settings and secrets: no
# background jobs, fresh keys (so no stored token or bank credential in the dump can be opened),
# no Microsoft, no alerts, no tunnel. It restores in one transaction, runs `migrate deploy` as an
# update would, starts the app and waits for it to be healthy, compares row counts with the
# .counts file beside the dump, checks `migrate deploy` accepts a database carrying a migration
# it doesn't know (what a rollback leaves), then removes everything it made.
# Phase 46: it runs the images the server runs (FAMILYOS_VERSION, pulled if they're missing);
# scripts/container-test.sh runs it on the images it just built (FAMILYOS_VERSION=local).
set -euo pipefail
cd "$(dirname "$0")/.."

dump="${1:?usage: scripts/restore-drill.sh <dump file>}"
[ -s "$dump" ] || { echo "No dump at $dump" >&2; exit 1; }
counts="$dump.counts"

work="$(mktemp -d)"
compose=(docker compose -p familyos-drill -f docker-compose.prod.yml)
cleanup() {
  FAMILYOS_ENV_FILE="$work/familyos.env" FAMILYOS_SECRETS_DIR="$work/secrets" FAMILYOS_BREAK_GLASS_DIR="$work/break-glass" \
    FAMILYOS_EDGE_SUBNET=172.30.142.0/24 "${compose[@]}" down -v --remove-orphans > /dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
fail() { echo "DRILL FAILED: $*" >&2; exit 1; }

key() { openssl rand -base64 32; }
password="$(openssl rand -hex 18)"
mkdir -p "$work/secrets" "$work/break-glass"
printf '%s' "$password" > "$work/secrets/db_password"
printf 'unused' > "$work/secrets/tunnel_token"
printf 'unused' > "$work/secrets/cf_dns_token"
cat > "$work/familyos.env" <<ENV
BETTER_AUTH_URL=http://localhost:3000
DATABASE_URL=postgresql://familyos:${password}@db:5432/familyos?schema=public
BETTER_AUTH_SECRET=$(key)
INTEGRATION_ENCRYPTION_KEY=$(key)
BACKGROUND_JOBS=0
ENV
export FAMILYOS_ENV_FILE="$work/familyos.env" FAMILYOS_SECRETS_DIR="$work/secrets" FAMILYOS_BREAK_GLASS_DIR="$work/break-glass"
# Its own network, so the drill can run beside the real stack.
export FAMILYOS_EDGE_SUBNET=172.30.142.0/24 FAMILYOS_APP_IP=172.30.142.20 FAMILYOS_TUNNEL_IP=172.30.142.10

echo "drill: restoring $(basename "$dump") into a throwaway database"
"${compose[@]}" down -v --remove-orphans > /dev/null 2>&1 || true
"${compose[@]}" up -d --wait db > /dev/null
"${compose[@]}" exec -T db pg_restore -U familyos -d familyos --clean --if-exists --single-transaction --no-owner < "$dump" \
  || fail "pg_restore couldn't restore it"

echo "drill: migrating and starting the app"
"${compose[@]}" up -d --wait migrate app > /dev/null || fail "the app didn't come up healthy on the restored data"

if [ -s "$counts" ]; then
  restored="$("${compose[@]}" exec -T db psql -U familyos -d familyos -At -F ' ' -c "$(cat scripts/drill-tables.sql)")"
  diff <(sort "$counts") <(echo "$restored" | sort) > /dev/null || {
    echo "Row counts differ (backup vs restored):" >&2
    diff <(sort "$counts") <(echo "$restored" | sort) >&2 || true
    fail "the restored database doesn't match the backup"
  }
  echo "drill: $(wc -l < "$counts" | tr -d ' ') tables match the backup's row counts"
else
  echo "drill: no $(basename "$counts") beside the dump; row counts not compared"
fi

# A rollback leaves a migration the older code doesn't know: migrate deploy must still succeed.
"${compose[@]}" exec -T db psql -U familyos -d familyos -q -c \
  "INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES ('drill', 'drill', '29991231000000_from_newer_code', now(), now(), 1)"
"${compose[@]}" run --rm migrate > /dev/null 2>&1 || fail "migrate deploy refused a database with a migration it doesn't know"

echo "drill: ok"
