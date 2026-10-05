#!/bin/bash
# Put the repo's nginx site file on the QA server (Git Bash on Windows, PuTTY's plink/pscp).
# usage: FIRA_DIR=<checkout> bash scripts/nginx-apply.sh diff    # what would change — nothing is written
#        FIRA_DIR=<checkout> bash scripts/nginx-apply.sh apply   # back up, copy, test, reload
#
# The server is shared: other teams' sites live in the same nginx. So the new file is
# TESTED (`nginx -t` checks the whole configuration) before anything is reloaded, the
# previous file is kept in ~/fira-nginx-backup/, and a failed test puts it back. A reload
# keeps open connections; nothing is stopped or restarted.
set -e
cd "${FIRA_DIR:-/c/Users/hp/development/nonsap-projects/fira/Fira}"
MODE="${1:-diff}"
SRC=deploy/nginx/sites-available/fira
DST=/etc/nginx/sites-available/fira
[ -f "$SRC" ] || { echo "no $SRC"; exit 1; }
while IFS='=' read -r k v; do
  v=${v%$'\r'}
  case $k in SERVER_SSH_USER) U=${v%@*} ;; SERVER_SSH_PASSWORD) P=$v ;; esac
done < .env
HK="SHA256:6CfTs/yY0oBeF0zXhPLySCgU6Cnuk4uxM/AfvqOZcCs"
H="$U@172.22.111.203"
run() { "/c/Program Files/PuTTY/plink" -ssh -pw "$P" -batch -hostkey "$HK" "$H" "$1"; }
NEW=$(mktemp); tr -d '\r' < "$SRC" > "$NEW"
"/c/Program Files/PuTTY/pscp" -pw "$P" -batch -hostkey "$HK" -q "$NEW" "$H:/tmp/fira-nginx-new"
rm -f "$NEW"
echo "--- server file vs repo file (- server, + repo):"
run "diff -u $DST /tmp/fira-nginx-new && echo '(identical)' || true"
[ "$MODE" = apply ] || { run "rm -f /tmp/fira-nginx-new"; echo "diff only; run with 'apply' to write"; exit 0; }
STAMP=$(date +%Y%m%d-%H%M%S)
run "set -e
mkdir -p ~/fira-nginx-backup && cp $DST ~/fira-nginx-backup/fira.$STAMP
echo '$P' | sudo -S -p '' cp /tmp/fira-nginx-new $DST
if echo '$P' | sudo -S -p '' nginx -t 2>&1; then
  echo '$P' | sudo -S -p '' systemctl reload nginx && echo RELOADED
else
  echo '$P' | sudo -S -p '' cp ~/fira-nginx-backup/fira.$STAMP $DST
  echo 'TEST FAILED — previous file restored, nothing reloaded'
  exit 1
fi
rm -f /tmp/fira-nginx-new
ls -t ~/fira-nginx-backup | tail -n +11 | while read f; do rm -f ~/fira-nginx-backup/\$f; done"
echo "applied; previous file: ~/fira-nginx-backup/fira.$STAMP (the ten newest are kept)"
