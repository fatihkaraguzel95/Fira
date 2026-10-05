#!/usr/bin/env bash
# Nightly Fira backup on the QA server: Postgres dump (custom format) + storage volume tarball.
# Keeps only the newest backup (KEEP_DAYS=1): the whole server is backed up separately (DK-3 #b01ec68e, 18 Sep 2026).
# Install: cp to ~/fira-backup.sh, chmod +x, crontab: 30 2 * * * ~/fira-backup.sh >> ~/backups/backup.log 2>&1
# Restore DB:  docker exec -i supabase-db pg_restore -U postgres -d postgres --clean --if-exists < db-YYYY-MM-DD.dump
# Restore files: tar -xzf storage-YYYY-MM-DD.tgz -C ~/supabase/docker/volumes/   (then docker compose restart storage)
#
# Order matters (18 Sep 2026 the disk filled): the old script checked the free space first and exited
# when it was tight — so exactly then no old backup was ever removed. Now:
#   1. leftovers of failed runs (*.tmp) go
#   2. free space < 2 GB: the previous backups are removed if that brings it to 2 GB (a fresh backup beats
#      an old one); otherwise nothing is touched and the run is skipped (the old backup stays)
#   3. dump + tarball + verify
#   4. everything older than KEEP_DAYS days except today's goes (with 1: only today's backup is left)
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
KEEP_DAYS="${KEEP_DAYS:-1}"
STORAGE_DIR="${STORAGE_DIR:-$HOME/supabase/docker/volumes/storage}"
MIN_FREE_KB="${MIN_FREE_KB:-2000000}"
DATE="$(date +%Y-%m-%d)"
mkdir -p "$BACKUP_DIR"
ts() { date '+%F %T'; }
echo "[$(ts)] start"

free_kb() { df -k "$BACKUP_DIR" | awk 'NR==2 {print $4}'; }
# Backups other than today's, older than $1 minutes (0 = all of them).
old_backups() { find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'storage-*.tgz' \) ! -name "*-$DATE.*" -mmin +"$1"; }
remove() { while read -r f; do [ -n "$f" ] && rm -f -- "$f" && echo "[$(ts)] removed $(basename "$f")"; done; }

find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.tmp' -delete

if [ "$(free_kb)" -lt "$MIN_FREE_KB" ]; then
  reclaim_kb=$(old_backups 0 | xargs -r du -ck | tail -1 | cut -f1); reclaim_kb=${reclaim_kb:-0}
  if [ $(( $(free_kb) + reclaim_kb )) -ge "$MIN_FREE_KB" ]; then
    echo "[$(ts)] WARN: <2GB free, removing the previous backups to make room"
    old_backups 0 | remove
  else
    echo "[$(ts)] ERROR: <2GB free, skipping (removing the previous backups would not be enough; they are kept)"; exit 1
  fi
fi

docker exec supabase-db pg_dump -U postgres -d postgres -Fc --no-owner > "$BACKUP_DIR/db-$DATE.dump.tmp"
mv "$BACKUP_DIR/db-$DATE.dump.tmp" "$BACKUP_DIR/db-$DATE.dump"
tar -czf "$BACKUP_DIR/storage-$DATE.tgz.tmp" -C "$(dirname "$STORAGE_DIR")" "$(basename "$STORAGE_DIR")"
mv "$BACKUP_DIR/storage-$DATE.tgz.tmp" "$BACKUP_DIR/storage-$DATE.tgz"

# Verify the dump is readable
docker exec -i supabase-db pg_restore --list < "$BACKUP_DIR/db-$DATE.dump" > /dev/null

# Keep KEEP_DAYS days (2 h slack for the nightly schedule: yesterday's 02:30 run is "a day old" at 02:31).
old_backups $(( KEEP_DAYS * 1440 - 120 )) | remove
echo "[$(ts)] ok db=$(du -h "$BACKUP_DIR/db-$DATE.dump" | cut -f1) storage=$(du -h "$BACKUP_DIR/storage-$DATE.tgz" | cut -f1) free=$(df -h "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
