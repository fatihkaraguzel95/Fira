#!/usr/bin/env bash
# Keeps the web root and the release archive small (DK-4, #221788ab — the disk filled on 18 Sep 2026).
#
#  - WEB_DIR/assets keeps the files of the last KEEP_RELEASES releases and every file written in the
#    last KEEP_RECENT_DAYS days: a tab still running an older build lazy-loads its chunks from here,
#    so a build is not dropped the moment the next one lands. Everything else goes.
#  - REL_DIR keeps the last KEEP_RELEASES versions (version order) plus the pinned base (PINNED).
#
# Runs as root (the web root is root-owned); deploy.sh calls it after every deploy:
#   echo <pw> | sudo -S bash ~/fira-web-prune.sh /home/<user>/fira-releases
# usage: fira-web-prune.sh <release dir> [--dry-run]
set -euo pipefail
REL_DIR="${1:?release dir}"
DRY=0; [ "${2:-}" = "--dry-run" ] && DRY=1
WEB_DIR="${WEB_DIR:-/var/www/fira}"
KEEP_RELEASES="${KEEP_RELEASES:-10}"
KEEP_RECENT_DAYS="${KEEP_RECENT_DAYS:-2}"
PINNED="${PINNED:-0.24.2}"

[ -d "$WEB_DIR/assets" ] && [ -d "$REL_DIR" ] || { echo "prune: missing $WEB_DIR/assets or $REL_DIR"; exit 1; }
keep_rel=$(ls "$REL_DIR" | sort -V | tail -n "$KEEP_RELEASES")
[ -n "$keep_rel" ] || { echo "prune: no releases, nothing done"; exit 0; }

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
for v in $keep_rel; do ls "$REL_DIR/$v/assets" 2>/dev/null; done > "$tmp/keep"
find "$WEB_DIR/assets" -maxdepth 1 -type f -mtime -"$KEEP_RECENT_DAYS" -printf '%f\n' >> "$tmp/keep"
# The live index.html always survives, whatever the release archive says.
grep -o 'assets/[^"]*' "$WEB_DIR/index.html" | sed 's#assets/##' >> "$tmp/keep"
sort -u "$tmp/keep" -o "$tmp/keep"
ls "$WEB_DIR/assets" | sort > "$tmp/all"
comm -23 "$tmp/all" "$tmp/keep" > "$tmp/drop"

n=$(wc -l < "$tmp/drop")
mb=$( [ "$n" -gt 0 ] && (cd "$WEB_DIR/assets" && xargs -a "$tmp/drop" du -cm | tail -1 | cut -f1) || echo 0)
old_rel=$(ls "$REL_DIR" | sort -V | grep -vxF -f <(printf '%s\n' $keep_rel "$PINNED") || true)
echo "prune: assets drop=$n (${mb} MB) keep=$(wc -l < "$tmp/keep"); releases drop=[$(echo $old_rel)]"
[ "$DRY" -eq 1 ] && exit 0

(cd "$WEB_DIR/assets" && xargs -a "$tmp/drop" -r rm -f --)
for v in $old_rel; do rm -rf -- "${REL_DIR:?}/$v"; done
echo "prune: done, free $(df -h / | awk 'NR==2 {print $4}')"
