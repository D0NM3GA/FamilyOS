#!/usr/bin/env bash
# Phase 43: the nightly database backup on the home server (README "Running in production"), run
# by the host's cron as the owner, e.g.
#
#   15 3 * * *  /opt/familyos/scripts/backup-prod.sh >> /var/log/familyos-backup.log 2>&1
#
# A custom-format pg_dump through the running db container (no extra image, no second copy of the
# password), checked with pg_restore --list, kept BACKUP_KEEP_DAYS days (14), and copied to
# BACKUP_NAS_DIR when it's set (a NAS share the owner mounts on the VM). Files are 600 in 700
# folders. A dump is only usable with the same BETTER_AUTH_SECRET and INTEGRATION_ENCRYPTION_KEY:
# keep familyos.env in the password manager.
# BACKUP_NAS_NOT_A_MOUNT=1 skips the "is it mounted" check (a test on a machine without
# `mountpoint`, such as a Mac); never on the server.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

dir="${BACKUP_DIR:-/var/backups/familyos}"
keep="${BACKUP_KEEP_DAYS:-14}"
compose=(docker compose ${COMPOSE_PROJECT:+-p "$COMPOSE_PROJECT"} -f docker-compose.prod.yml)

mkdir -p "$dir" && chmod 700 "$dir"
stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
final="$dir/familyos-$stamp.dump"
tmp="$final.tmp"
trap 'rm -f "$tmp"' EXIT

"${compose[@]}" exec -T db pg_dump -U familyos -d familyos -Fc > "$tmp"
# A dump that pg_restore can't read is no backup: fail loudly instead of keeping it.
"${compose[@]}" exec -T db pg_restore --list < "$tmp" > /dev/null
mv "$tmp" "$final"
chmod 600 "$final"
# Phase 42.6: row counts of the family's own tables beside each dump, which the restore drill
# (scripts/restore-drill.sh) compares a restored copy with.
"${compose[@]}" exec -T db psql -U familyos -d familyos -At -F ' ' -c "$(cat scripts/drill-tables.sql)" > "$final.counts"
chmod 600 "$final.counts"
find "$dir" -maxdepth 1 \( -name 'familyos-*.dump' -o -name 'familyos-*.dump.counts' \) -mtime +"$keep" -delete
echo "$(date -u +%FT%TZ) backed up $(du -h "$final" | cut -f1) to $final"

if [ -n "${BACKUP_NAS_DIR:-}" ]; then
  # An unmounted share is an empty folder on the VM's own disk: copying there would look like a
  # backup on the NAS and isn't. (Permissions on a NAS share are the share's, not chmod's.)
  if [ -z "${BACKUP_NAS_NOT_A_MOUNT:-}" ] && ! mountpoint -q "$BACKUP_NAS_DIR"; then
    echo "$(date -u +%FT%TZ) $BACKUP_NAS_DIR isn't mounted: the NAS copy was NOT made" >&2
    exit 1
  fi
  cp "$final" "$final.counts" "$BACKUP_NAS_DIR/"
  cmp -s "$final" "$BACKUP_NAS_DIR/$(basename "$final")" || { echo "the NAS copy doesn't match" >&2; exit 1; }
  find "$BACKUP_NAS_DIR" -maxdepth 1 \( -name 'familyos-*.dump' -o -name 'familyos-*.dump.counts' \) -mtime +"$keep" -delete
  echo "$(date -u +%FT%TZ) copied to $BACKUP_NAS_DIR"
fi
