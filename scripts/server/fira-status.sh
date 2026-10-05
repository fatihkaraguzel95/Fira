#!/usr/bin/env bash
# Collects a server health report and stores it in public.system_status (read by the Fira admin page).
# Install: cp to ~/fira-status.sh, chmod +x; crontab: */5 * * * * ~/fira-status.sh >> ~/backups/status.log 2>&1
set -uo pipefail
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
STORAGE_DIR="${STORAGE_DIR:-$HOME/supabase/docker/volumes/storage}"
WEB_DIR="${WEB_DIR:-/var/www/fira}"
CERT="${CERT:-/etc/ssl/fira/server.crt}"
PSQL="docker exec -i supabase-db psql -U postgres -d postgres -Atq"

json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n'; }

# disk / memory / load
read -r DISK_TOTAL DISK_USED DISK_AVAIL DISK_PCT <<< "$(df -k / | awk 'NR==2 {print $2*1024, $3*1024, $4*1024, $5}')"
DISK_PCT=${DISK_PCT%\%}
read -r MEM_TOTAL MEM_AVAIL <<< "$(free -b | awk 'NR==2 {print $2, $7}')"
LOAD=$(cut -d' ' -f1-3 /proc/loadavg | tr ' ' ',')
UPTIME=$(cut -d' ' -f1 /proc/uptime)

# containers (name, status, health, image)
CONTAINERS="["
first=1
while IFS='|' read -r name status image id; do
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || echo unknown)
  [ $first -eq 1 ] || CONTAINERS+=","
  first=0
  CONTAINERS+="{\"name\":\"$(json_escape "$name")\",\"status\":\"$(json_escape "$status")\",\"health\":\"$health\",\"image\":\"$(json_escape "$image")\"}"
done < <(docker ps -a --format '{{.Names}}|{{.Status}}|{{.Image}}|{{.ID}}' | grep -E '^(supabase-|realtime-dev)' )
CONTAINERS+="]"

# certificate
CERT_END=$(openssl x509 -in "$CERT" -noout -enddate 2>/dev/null | cut -d= -f2)
CERT_ISSUER=$(openssl x509 -in "$CERT" -noout -issuer 2>/dev/null | sed 's/^issuer=//')
CERT_END_ISO=$( [ -n "$CERT_END" ] && date -d "$CERT_END" -u +%Y-%m-%dT%H:%M:%SZ || echo "" )

# backups
LAST_DB=$(ls -t "$BACKUP_DIR"/db-*.dump 2>/dev/null | head -1)
LAST_ST=$(ls -t "$BACKUP_DIR"/storage-*.tgz 2>/dev/null | head -1)
LAST_DB_AT=$( [ -n "$LAST_DB" ] && date -u -r "$LAST_DB" +%Y-%m-%dT%H:%M:%SZ || echo "" )
LAST_DB_SIZE=$( [ -n "$LAST_DB" ] && stat -c %s "$LAST_DB" || echo 0 )
LAST_ST_SIZE=$( [ -n "$LAST_ST" ] && stat -c %s "$LAST_ST" || echo 0 )
BACKUP_COUNT=$(ls "$BACKUP_DIR"/db-*.dump 2>/dev/null | wc -l)
BACKUP_TOTAL=$(du -sb "$BACKUP_DIR" 2>/dev/null | cut -f1)
LAST_BACKUP_LOG=$(tail -n 1 "$BACKUP_DIR/backup.log" 2>/dev/null)
# Yönetim ekranı yedekleri tek tek listeliyor (#F236F25C sonrası istek): ad,
# tür, boyut, tarih. Yalnız tarih göstermek "liste boş" hissi veriyordu.
BACKUP_FILES=$(ls -t "$BACKUP_DIR"/db-*.dump "$BACKUP_DIR"/storage-*.tgz 2>/dev/null | head -40 | while read -r f; do
  case "$f" in *db-*) k=db ;; *) k=storage ;; esac
  printf '{"name":"%s","kind":"%s","bytes":%s,"at":"%s"},' \
    "$(basename "$f")" "$k" "$(stat -c %s "$f" 2>/dev/null || echo 0)" "$(date -u -r "$f" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"
done)
BACKUP_FILES="[${BACKUP_FILES%,}]"
# Saklama süresi yedek betiğinden okunur; son başarılı/başarısız çalışma günlükten.
KEEP_DAYS_V=$(sed -n 's/^KEEP_DAYS="\${KEEP_DAYS:-\([0-9]*\)}"/\1/p' "$HOME/fira-backup.sh" 2>/dev/null | head -1)
LAST_OK_LOG=$(grep ' ok db=' "$BACKUP_DIR/backup.log" 2>/dev/null | tail -n 1)
LAST_ERR_LOG=$(grep -iE 'ERROR|FAILED' "$BACKUP_DIR/backup.log" 2>/dev/null | tail -n 1)

# storage + db
STORAGE_BYTES=$(du -sb "$STORAGE_DIR" 2>/dev/null | cut -f1)
DB_BYTES=$($PSQL -c "select pg_database_size('postgres')" 2>/dev/null)

# app
# The live bundle is the one index.html loads (assets/ also holds older builds; the alphabetical first was reported before DK-5).
BUNDLE=$(grep -o 'assets/index-[^"]*\.js' "$WEB_DIR/index.html" 2>/dev/null | head -1 | sed 's#assets/index-##; s#\.js##')
APP_VERSION=$(grep -o '"version": *"[^"]*"' "$HOME/Fira/package.json" 2>/dev/null | head -1 | sed 's/.*: *"//; s/"//')
NGINX=$(systemctl is-active nginx 2>/dev/null)
KONG_HTTP=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:8000/auth/v1/health)
HOSTNAME_S=$(hostname)

PAYLOAD=$(cat <<EOF
{"host":"$HOSTNAME_S","uptime_s":$UPTIME,"load":[$LOAD],
"disk":{"total":$DISK_TOTAL,"used":$DISK_USED,"avail":$DISK_AVAIL,"pct":$DISK_PCT},
"mem":{"total":$MEM_TOTAL,"avail":$MEM_AVAIL},
"containers":$CONTAINERS,
"cert":{"not_after":"$CERT_END_ISO","issuer":"$(json_escape "$CERT_ISSUER")"},
"backup":{"last_db_at":"$LAST_DB_AT","last_db_bytes":$LAST_DB_SIZE,"last_storage_bytes":$LAST_ST_SIZE,"count":$BACKUP_COUNT,"total_bytes":${BACKUP_TOTAL:-0},"last_log":"$(json_escape "$LAST_BACKUP_LOG")",
  "keep_days":${KEEP_DAYS_V:-7},"last_ok":"$(json_escape "$LAST_OK_LOG")","last_error":"$(json_escape "$LAST_ERR_LOG")","files":$BACKUP_FILES},
"storage_bytes":${STORAGE_BYTES:-0},"db_bytes":${DB_BYTES:-0},
"app":{"bundle":"$BUNDLE","version":"$APP_VERSION","nginx":"$NGINX","kong_health_http":"$KONG_HTTP"},
"versions":{"docker":"$(docker --version 2>/dev/null | sed 's/Docker version //; s/,.*//')","nginx":"$(nginx -v 2>&1 | sed 's#nginx version: nginx/##')","os":"$(. /etc/os-release && echo "$PRETTY_NAME")"}}
EOF
)
printf '%s' "$PAYLOAD" > /tmp/fira-status.json
$PSQL -c "insert into system_status (payload) values (\$json\$$(cat /tmp/fira-status.json)\$json\$::jsonb); delete from system_status where collected_at < now() - interval '30 days';" >/dev/null && echo "[$(date '+%F %T')] status ok disk=${DISK_PCT}% bundle=$BUNDLE" || echo "[$(date '+%F %T')] status FAILED"
rm -f /tmp/fira-status.json

# ── Disk alert (DK-5, #addb4475) ─────────────────────────────────────────────
# 18 Sep 2026 the disk filled and the database stopped while this report said 100% for hours on an
# admin page nobody watched. Now the system admins get a Telegram message through the bot's outbox
# (049; the bot sends what lands there): from the admin page's threshold (system_settings
# alerts.disk_pct, default 85) at most every 6 h, from 95% every hour, a rise to 95% at once, and one
# "back to normal" message once the disk is below DISK_OK again. State: $BACKUP_DIR/.disk-alert.
[ -n "${DISK_WARN:-}" ] || DISK_WARN=$($PSQL -c "select coalesce((select (value->>'disk_pct')::int from system_settings where key = 'alerts'), 85)" 2>/dev/null)
DISK_WARN=${DISK_WARN:-85}; DISK_CRIT=${DISK_CRIT:-95}; DISK_OK=${DISK_OK:-$(( DISK_WARN - 5 ))}
ALERT_STATE="$BACKUP_DIR/.disk-alert"
A_LEVEL=none; A_AT=0
[ -f "$ALERT_STATE" ] && read -r A_LEVEL A_AT < "$ALERT_STATE"
NOW=$(date +%s)
LEVEL=none
[ "$DISK_PCT" -ge "$DISK_WARN" ] && LEVEL=warn
[ "$DISK_PCT" -ge "$DISK_CRIT" ] && LEVEL=crit
FREE_H=$(df -h / | awk 'NR==2 {print $4}')
send_admins() {  # $1 = message (Telegram HTML); one outbox row per admin with a linked account
  $PSQL -c "insert into telegram_outbox (user_id, body) select p.id, \$m\$$1\$m\$ from profiles p join telegram_accounts a on a.user_id = p.id and a.blocked_at is null where p.is_admin" >/dev/null \
    && echo "[$(date '+%F %T')] disk alert sent: $LEVEL ${DISK_PCT}%" || echo "[$(date '+%F %T')] disk alert FAILED"
}
if [ "$LEVEL" != none ]; then
  EVERY=$([ "$LEVEL" = crit ] && echo 3600 || echo 21600)
  if [ "$A_LEVEL" = none ] || { [ "$LEVEL" = crit ] && [ "$A_LEVEL" != crit ]; } || [ $(( NOW - A_AT )) -ge "$EVERY" ]; then
    ICON=$([ "$LEVEL" = crit ] && echo '🚨' || echo '⚠️')
    send_admins "$ICON <b>Fira sunucusu: disk %${DISK_PCT} dolu</b> (${FREE_H} boş).
Disk dolarsa veritabanı durur ve Fira herkes için hata verir. Yönetim: https://fira.flpconsulting.de/admin"
    echo "$LEVEL $NOW" > "$ALERT_STATE"
  fi
elif [ "$A_LEVEL" != none ] && [ "$DISK_PCT" -lt "$DISK_OK" ]; then
  send_admins "✅ <b>Fira sunucusu: disk normale döndü</b> — %${DISK_PCT} dolu (${FREE_H} boş)."
  rm -f "$ALERT_STATE"
fi
