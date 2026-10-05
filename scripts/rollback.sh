#!/bin/bash
# Put a kept build (~/fira-releases/<version>, written by scripts/deploy.sh) back into /var/www/fira and log it.
# usage: FIRA_DIR=<checkout> bash scripts/rollback.sh <version> ["<note>"]
# The server keeps the last 10 releases plus 0.24.2 (scripts/server/fira-web-prune.sh); `ls ~/fira-releases` lists them.
set -e
cd "${FIRA_DIR:-/c/Users/hp/development/nonsap-projects/fira/Fira}"
VER="$1"; NOTE="${2:-rollback to $VER}"
[ -n "$VER" ] || { echo "usage: rollback.sh <version> [note]"; exit 1; }
while IFS='=' read -r k v; do
  v=${v%$'\r'}
  case $k in SERVER_SSH_USER) U=${v%@*} ;; SERVER_SSH_PASSWORD) P=$v ;; esac
done < .env
HK="SHA256:6CfTs/yY0oBeF0zXhPLySCgU6Cnuk4uxM/AfvqOZcCs"
H="$U@172.22.111.203"
"/c/Program Files/PuTTY/plink" -ssh -pw "$P" -batch -hostkey "$HK" "$H" \
  "test -d ~/fira-releases/$VER && B=\$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' ~/fira-releases/$VER/index.html | head -1 | cut -d/ -f2) && echo '$P' | sudo -S -p '' cp -r ~/fira-releases/$VER/. /var/www/fira/ && docker exec supabase-db psql -U postgres -d postgres -At -c \"insert into deploy_log(version, bundle, note) values ('$VER', '\$B', '$NOTE') returning id\" && echo \"rolled back to $VER \$B\""
