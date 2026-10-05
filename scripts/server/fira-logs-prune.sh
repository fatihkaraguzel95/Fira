#!/usr/bin/env bash
# Keeps Supabase's log database to KEEP_DAYS days (DK-1, #99d5a204).
#
# Self-hosted Supabase ships every container's logs through Vector to Logflare (supabase-analytics),
# which stores them in the `_supabase` database, one `_analytics.log_events_<source>` table per source.
# Nothing ever deletes them: the Kong source (every API request) reached 5 M rows / 6.7 GB and helped
# fill the disk on 18 Sep 2026. This deletes rows older than KEEP_DAYS days, a day at a time (bounded
# transactions and WAL; the timestamp column has a BRIN index), then VACUUMs so the space is reused.
#
#   --full   VACUUM FULL afterwards: gives the space back to the disk. It rewrites each table and holds
#            an exclusive lock while it runs (Logflare's inserts wait), so it is for one-off cleanups;
#            it is skipped for a table when the free disk would not hold the new copy plus WAL.
#
# cron (after the 02:30 backup): 15 3 * * * $HOME/fira-logs-prune.sh >> $HOME/backups/logs-prune.log 2>&1
set -uo pipefail
KEEP_DAYS="${KEEP_DAYS:-7}"
FULL=0; [ "${1:-}" = "--full" ] && FULL=1
# The log tables belong to supabase_admin (Logflare connects as it); `postgres` is not a superuser here.
PSQL="docker exec -i supabase-db psql -U supabase_admin -d _supabase -v ON_ERROR_STOP=1 -Atq"
log() { echo "[$(date '+%F %T')] $*"; }
mb() { echo $(( $1 / 1048576 )); }
CUT="((now() at time zone 'utc') - interval '$KEEP_DAYS days')"

tables=$($PSQL -c "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = '_analytics' and c.relkind = 'r' and c.relname like 'log\_events\_%' order by 1") \
  || { log "ERROR: cannot list log tables"; exit 1; }
# ONLY=<substring> limits the run to matching tables (for trying it on a small one first).
[ -n "${ONLY:-}" ] && tables=$(printf '%s\n' $tables | grep -F -- "$ONLY")

total_deleted=0
for t in $tables; do
  q="_analytics.\"$t\""
  before=$($PSQL -c "select pg_total_relation_size('$q')")
  oldest=$($PSQL -c "select min(timestamp)::date from $q where timestamp < $CUT")
  deleted=0
  if [ -n "$oldest" ]; then
    d="$oldest"
    while :; do
      # Both bounds: without the lower one every window re-reads the pages of the days already deleted.
      n=$($PSQL -c "with x as (delete from $q where timestamp >= '$d'::date and timestamp < least('$d'::date + 1, $CUT) returning 1) select count(*) from x") \
        || { log "ERROR: delete failed on $t at $d"; break; }
      deleted=$((deleted + n))
      d=$(date -d "$d + 1 day" +%F)
      [ "$($PSQL -c "select '$d'::date > $CUT::date")" = "t" ] && break
    done
  fi
  $PSQL -c "vacuum (analyze) $q" >/dev/null || log "WARN: vacuum failed on $t"
  after=$($PSQL -c "select pg_total_relation_size('$q')")
  if [ "$FULL" -eq 1 ]; then
    # The rewritten copy ≈ live rows × their average size (sampled; the file is mostly free space after
    # the delete, so its size says nothing) × 1.3 for pages and the index, plus 1.5 GB for WAL.
    need=$($PSQL -c "select coalesce((select avg(pg_column_size(x.*)) from $q x tablesample system (2)), 2048)
      * (select greatest(n_live_tup, 1) from pg_stat_user_tables where schemaname = '_analytics' and relname = '$t') * 1.3 + 1610612736")
    need=${need%.*}
    free=$(( $(df -k / | awk 'NR==2 {print $4}') * 1024 ))
    if [ "${need:-0}" -lt "$free" ]; then
      # Two -c's: VACUUM cannot share a transaction with the SET (one -c with both runs as one transaction).
      $PSQL -c "set lock_timeout = '15s'" -c "vacuum (full, analyze) $q" >/dev/null && after=$($PSQL -c "select pg_total_relation_size('$q')") \
        || log "WARN: vacuum full skipped on $t (lock timeout or error)"
    else
      log "WARN: vacuum full skipped on $t — needs ~$(mb "$need") MB, free $(mb "$free") MB"
    fi
  fi
  [ "$deleted" -gt 0 ] || [ "$before" != "$after" ] && log "$t: deleted $deleted, $(mb "$before") MB -> $(mb "$after") MB"
  total_deleted=$((total_deleted + deleted))
done
log "ok keep=${KEEP_DAYS}d deleted=$total_deleted db=$($PSQL -c "select pg_size_pretty(pg_database_size('_supabase'))") free=$(df -h / | awk 'NR==2 {print $4}')"
