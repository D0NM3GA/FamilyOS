#!/usr/bin/env bash
# Phase 43: the nightly database backup on the home server (README "Running in production"), run
# by the host's cron as the owner, e.g.
#
#   15 3 * * *  /opt/familyos/scripts/backup-prod.sh >> /var/log/familyos-backup.log 2>&1
#
# A custom-format pg_dump through the running db container (no extra image, no second copy of the
# password), checked with pg_restore --list, kept BACKUP_KEEP_DAYS days (14). Files are 600 in 700
# folders. A dump is only usable with the same BETTER_AUTH_SECRET and INTEGRATION_ENCRYPTION_KEY:
# keep familyos.env in the password manager.
#
# Phase 61 (the owner's call: three copies, two places, one off site): the dump is encrypted with
# `age` to the public keys in BACKUP_AGE_RECIPIENTS (default /etc/familyos/backup-recipients.txt)
# and only the encrypted file is kept. The private key lives in the password manager, never on
# the server, so the server can make backups it can't read. No recipients: it stops, rather than
# quietly making a plain one. Then it's copied to BACKUP_NAS_DIR (a NAS share the owner mounts) and
# to BACKUP_RCLONE_REMOTE (an rclone remote, e.g. onedrive:Backups/app), each checked. It records
# how it went for the app's System card (Data & backups) and calls BACKUP_PING_URL when set,
# with /fail on the end when anything failed.
# BACKUP_NAS_NOT_A_MOUNT=1 skips the "is it mounted" check (a test on a machine without
# `mountpoint`, such as a Mac); never on the server.
#
# Phase 67c: besides the nightly copies (BACKUP_KEEP_DAYS), Sunday's is also kept in weekly/ for
# BACKUP_KEEP_WEEKS weeks (8) and the 1st of the month's in monthly/ for BACKUP_KEEP_MONTHS months
# (12), in each place, so corruption noticed after a fortnight still has a good copy.
# BACKUP_RCLONE_PRUNE=0 stops it deleting anything off site, for a remote whose credentials can
# only add files, with the provider's versioning or retention rules doing the tidying (README).
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

dir="${BACKUP_DIR:-/var/backups/familyos}"
keep="${BACKUP_KEEP_DAYS:-14}"
keep_weekly_days="$(( ${BACKUP_KEEP_WEEKS:-8} * 7 ))"
keep_monthly_days="$(( ${BACKUP_KEEP_MONTHS:-12} * 31 ))"
# Which longer-kept folders tonight's copy also goes in (UTC, like the file names).
# BACKUP_TIERS ("weekly monthly") stands in for the date, for scripts/container-test.sh.
tiers=()
if [ -n "${BACKUP_TIERS:-}" ]; then
  for tier in $BACKUP_TIERS; do
    case "$tier" in weekly | monthly) tiers+=("$tier") ;; *) echo "BACKUP_TIERS takes weekly and monthly" >&2; exit 1 ;; esac
  done
else
  [ "$(date -u +%u)" = 7 ] && tiers+=(weekly)
  [ "$(date -u +%d)" = 01 ] && tiers+=(monthly)
fi
tier_days() { [ "$1" = weekly ] && echo "$keep_weekly_days" || echo "$keep_monthly_days"; }
recipients="${BACKUP_AGE_RECIPIENTS:-/etc/familyos/backup-recipients.txt}"
compose=(docker compose ${COMPOSE_PROJECT:+-p "$COMPOSE_PROJECT"} -f docker-compose.prod.yml)
log() { echo "$(date -u +%FT%TZ) $*"; }

# How it went, for the System card: an upsert into system_heartbeat through psql. Fixed words and
# a size only, in UTC as Prisma stores times. Never fails the backup (a database from before
# Phase 61 has no such table).
heartbeat() {
  local ok="$1" detail="$2"
  local out
  out="$("${compose[@]}" exec -T db psql -U familyos -d familyos -q -v ON_ERROR_STOP=1 -v ok="$ok" -v detail="$detail" 2>&1 <<'SQL'
INSERT INTO system_heartbeat (name, "lastOkAt", "lastErrorAt", "lastError", detail, "updatedAt")
VALUES ('backup',
        CASE WHEN :'ok' = 'ok' THEN (now() AT TIME ZONE 'UTC') END,
        CASE WHEN :'ok' = 'ok' THEN NULL ELSE (now() AT TIME ZONE 'UTC') END,
        CASE WHEN :'ok' = 'ok' THEN NULL ELSE :'detail' END,
        CASE WHEN :'ok' = 'ok' THEN :'detail' END,
        (now() AT TIME ZONE 'UTC'))
ON CONFLICT (name) DO UPDATE SET
  "lastOkAt" = COALESCE(EXCLUDED."lastOkAt", system_heartbeat."lastOkAt"),
  "lastErrorAt" = COALESCE(EXCLUDED."lastErrorAt", system_heartbeat."lastErrorAt"),
  "lastError" = COALESCE(EXCLUDED."lastError", system_heartbeat."lastError"),
  detail = COALESCE(EXCLUDED.detail, system_heartbeat.detail),
  "updatedAt" = (now() AT TIME ZONE 'UTC');
SQL
)" || log "couldn't record this run for the System card: $(printf '%s' "$out" | tail -n1)"
}

ping() {
  [ -n "${BACKUP_PING_URL:-}" ] || return 0
  local url="${BACKUP_PING_URL%/}"
  [ "$1" = ok ] || url="$url/fail"
  curl -fsS -m 10 --retry 3 -o /dev/null "$url" || log "couldn't reach BACKUP_PING_URL"
}

step="starting"
finished=""
on_exit() {
  local status=$?
  [ -z "${tmp:-}" ] || rm -f "$tmp" "$tmp.age"
  if [ "$status" -ne 0 ] && [ -z "$finished" ]; then
    heartbeat failed "Failed while $step"
    ping failed
  fi
}
trap on_exit EXIT

step="checking the encryption key"
command -v age > /dev/null || { echo "age isn't installed (README \"Nightly backups\")" >&2; exit 1; }
[ -s "$recipients" ] || { echo "No public key at $recipients: refusing to make a backup that isn't encrypted (README \"Nightly backups\")" >&2; exit 1; }

mkdir -p "$dir" && chmod 700 "$dir"
# A plain dump from a run that was killed outright (power cut, SIGKILL) never outlives one night.
find "$dir" -maxdepth 1 -name '.familyos-*.tmp*' -delete
stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
final="$dir/familyos-$stamp.dump.age"
counts="$final.counts"
tmp="$dir/.familyos-$stamp.dump.tmp"

step="dumping the database"
"${compose[@]}" exec -T db pg_dump -U familyos -d familyos -Fc > "$tmp"
# A dump that pg_restore can't read is no backup: fail loudly instead of keeping it.
"${compose[@]}" exec -T db pg_restore --list < "$tmp" > /dev/null

step="encrypting it"
age -R "$recipients" -o "$tmp.age" "$tmp"
rm -f "$tmp"
# What age writes starts with its header; anything else is not an encrypted backup.
[ "$(head -c 21 "$tmp.age")" = "age-encryption.org/v1" ] || { echo "the encrypted file doesn't look like age's" >&2; exit 1; }
mv "$tmp.age" "$final"
chmod 600 "$final"

step="counting rows"
# Phase 42.6: row counts of the family's own tables beside each dump, which the restore drill
# (scripts/restore-drill.sh) compares a restored copy with. Table names and numbers only.
"${compose[@]}" exec -T db psql -U familyos -d familyos -At -F ' ' -c "$(cat scripts/drill-tables.sql)" > "$counts"
chmod 600 "$counts"
expire() { find "$1" -maxdepth 1 \( -name 'familyos-*.dump' -o -name 'familyos-*.dump.age' -o -name 'familyos-*.counts' \) -mtime +"${2:-$keep}" -delete; }
# Tonight's copy (and its counts) into the longer-kept folders of one place, then each folder's
# own expiry. Folders that exist are expired every night, so a weekly copy goes on time.
keep_tiers() {
  local place="$1" tier
  for tier in ${tiers[@]+"${tiers[@]}"}; do
    mkdir -p "$place/$tier"
    cp "$final" "$counts" "$place/$tier/"
    cmp -s "$final" "$place/$tier/$(basename "$final")" || { echo "the $tier copy in $place doesn't match" >&2; exit 1; }
  done
  for tier in weekly monthly; do
    [ -d "$place/$tier" ] && expire "$place/$tier" "$(tier_days "$tier")"
  done
  return 0
}
expire "$dir"
chmod 700 "$dir"
keep_tiers "$dir"
[ ! -d "$dir/weekly" ] || chmod 700 "$dir/weekly"
[ ! -d "$dir/monthly" ] || chmod 700 "$dir/monthly"
size="$(du -h "$final" | cut -f1)"
log "backed up $size (encrypted) to $final"
copies=("this server")

if [ -n "${BACKUP_NAS_DIR:-}" ]; then
  step="copying to the NAS"
  # An unmounted share is an empty folder on the VM's own disk: copying there would look like a
  # backup on the NAS and isn't. (Permissions on a NAS share are the share's, not chmod's.)
  if [ -z "${BACKUP_NAS_NOT_A_MOUNT:-}" ] && ! mountpoint -q "$BACKUP_NAS_DIR"; then
    echo "$BACKUP_NAS_DIR isn't mounted: the NAS copy was NOT made" >&2
    exit 1
  fi
  cp "$final" "$counts" "$BACKUP_NAS_DIR/"
  cmp -s "$final" "$BACKUP_NAS_DIR/$(basename "$final")" || { echo "the NAS copy doesn't match" >&2; exit 1; }
  expire "$BACKUP_NAS_DIR"
  keep_tiers "$BACKUP_NAS_DIR"
  log "copied to $BACKUP_NAS_DIR"
  copies+=("the NAS")
fi

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  step="copying off site"
  command -v rclone > /dev/null || { echo "rclone isn't installed (README \"Nightly backups\")" >&2; exit 1; }
  remote="${BACKUP_RCLONE_REMOTE%/}"
  rclone copyto "$final" "$remote/$(basename "$final")"
  rclone copyto "$counts" "$remote/$(basename "$counts")"
  # Both files arrived whole (size and hash), or it's a failure.
  rclone check --one-way --include "familyos-$stamp.*" "$dir" "$remote"
  for tier in ${tiers[@]+"${tiers[@]}"}; do
    rclone copyto "$final" "$remote/$tier/$(basename "$final")"
    rclone copyto "$counts" "$remote/$tier/$(basename "$counts")"
    rclone check --one-way --include "familyos-$stamp.*" "$dir" "$remote/$tier"
  done
  if [ "${BACKUP_RCLONE_PRUNE:-1}" != 0 ]; then
    # One day more than find's -mtime, so both ends keep the same nights. The nightly prune stays
    # in the top folder (rclone filters match at any depth), and each longer-kept folder has its own.
    rclone delete --max-depth 1 --min-age "$((keep + 1))d" --include "familyos-*" "$remote"
    rclone delete --min-age "$((keep_weekly_days + 1))d" --include "familyos-*" "$remote/weekly" 2>/dev/null || true
    rclone delete --min-age "$((keep_monthly_days + 1))d" --include "familyos-*" "$remote/monthly" 2>/dev/null || true
  fi
  log "copied to $remote"
  copies+=("off site")
fi

finished=1
detail="$size, kept on $(IFS=,; echo "${copies[*]}" | sed 's/,/, /g')"
heartbeat ok "$detail"
ping ok
