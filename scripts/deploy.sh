#!/bin/bash
# Deploy the local dist/ to the QA server (Git Bash on Windows, PuTTY's plink/pscp).
# usage: FIRA_DIR=<checkout> bash scripts/deploy.sh <version> "<note without apostrophes>"
#
#  1. uploads dist/ to /tmp/fira-dist-new and keeps it as ~/fira-releases/<version> (rollback: scripts/rollback.sh)
#  2. copies it over /var/www/fira and writes a deploy_log row
#  3. prunes old assets and releases (scripts/server/fira-web-prune.sh, uploaded on every deploy so the
#     server always runs the repo's version) — DK-4 #221788ab: the web root and a full copy of it
#     (~/fira-dist-prev, no longer written) had grown to ~1 GB and helped fill the disk on 18 Sep 2026.
# Build first: MSYS_NO_PATHCONV=1 VITE_SUPABASE_URL=/api VITE_SUPABASE_ANON_KEY=<anon JWT> npx vite build
set -e
cd "${FIRA_DIR:-/c/Users/hp/development/nonsap-projects/fira/Fira}"
VER="$1"; NOTE="$2"
[ -n "$VER" ] || { echo "usage: deploy.sh <version> <note>"; exit 1; }
case "$NOTE" in *"'"*) echo "note must not contain apostrophes"; exit 1 ;; esac
# Go-live approval (109): on a computer that holds an agent key, the jobs that agent is
# working on decide whether anything may go out — a list set to "ask" needs a person's
# yes first, a list set to "never" lets nothing out. Without a key (a person deploying)
# there is nothing to ask.
if [ -f "${FIRA_AGENT_HOME:-$HOME/.fira-agent}/credentials.json" ]; then
  node tools/agent/fira-agent.mjs deploy-gate || { echo "not deploying: the go-live policy says no (see the GATE lines above)"; exit 1; }
fi
# The entry script named by index.html: lazy chunks can be called index-*.js too (mermaid's is), so no ls/glob.
BUNDLE=$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' dist/index.html | head -1 | cut -d/ -f2)
[ -n "$BUNDLE" ] && [ -f "dist/assets/$BUNDLE" ] || { echo "no entry script in dist/index.html — build first"; exit 1; }
# A failed build leaves the previous dist/ behind; its changelog does not know this version yet.
grep -qF "$VER" "dist/assets/$BUNDLE" || { echo "dist/ does not contain $VER — stale or failed build, not deploying"; exit 1; }
while IFS='=' read -r k v; do
  v=${v%$'\r'}
  case $k in SERVER_SSH_USER) U=${v%@*} ;; SERVER_SSH_PASSWORD) P=$v ;; esac
done < .env
HK="SHA256:6CfTs/yY0oBeF0zXhPLySCgU6Cnuk4uxM/AfvqOZcCs"
H="$U@172.22.111.203"
PRUNE=$(mktemp); tr -d '\r' < scripts/server/fira-web-prune.sh > "$PRUNE"
"/c/Program Files/PuTTY/plink" -ssh -pw "$P" -batch -hostkey "$HK" "$H" "rm -rf /tmp/fira-dist-new && mkdir -p /tmp/fira-dist-new" >/dev/null
"/c/Program Files/PuTTY/pscp" -pw "$P" -batch -hostkey "$HK" -r -q dist "$H:/tmp/fira-dist-new/"
"/c/Program Files/PuTTY/pscp" -pw "$P" -batch -hostkey "$HK" -q "$PRUNE" "$H:fira-web-prune.sh"
rm -f "$PRUNE"
"/c/Program Files/PuTTY/plink" -ssh -pw "$P" -batch -hostkey "$HK" "$H" \
  "mkdir -p ~/fira-releases && rm -rf ~/fira-releases/$VER && cp -r /tmp/fira-dist-new/dist ~/fira-releases/$VER && echo '$P' | sudo -S -p '' cp -r /tmp/fira-dist-new/dist/. /var/www/fira/ && ls /var/www/fira/assets | grep -c '$BUNDLE' && docker exec supabase-db psql -U postgres -d postgres -At -c \"insert into deploy_log(version, bundle, note) values ('$VER', '$BUNDLE', '$NOTE') returning id\" && rm -rf /tmp/fira-dist-new && chmod +x ~/fira-web-prune.sh && echo '$P' | sudo -S -p '' bash ~/fira-web-prune.sh \$HOME/fira-releases"
echo "deployed $VER $BUNDLE"
