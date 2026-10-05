#!/usr/bin/env bash
# Fira ağ toplayıcısı — dakikada bir (cron). nginx'in Fira JSON günlüğünden yalnızca yeni satırları
# okur, dakika bazında özetler, 429/5xx satırlarını ve son isteklerin kısa bir halka tamponunu
# public.net_samples / request_errors / request_recent tablolarına yazar; NIC sayaçlarını ekler.
# Kurulum: cp deploy/fira-net.sh ~/fira-net.sh; chmod +x; crontab: * * * * * ~/fira-net.sh >> ~/backups/net.log 2>&1
set -uo pipefail
LOG="${LOG:-/var/log/nginx/fira.access.log}"
STATE="${STATE:-$HOME/.fira-net.offset}"
NIC="${NIC:-ens33}"
PSQL="docker exec -i supabase-db psql -U postgres -d postgres -Atq -v ON_ERROR_STOP=1"

[ -r "$LOG" ] || { echo "$(date -Is) log okunamıyor: $LOG"; exit 0; }

# ── Yeni satırlar: dosya offset'i (döndürme → baştan) ────────────────────────
size=$(stat -c %s "$LOG")
inode=$(stat -c %i "$LOG")
prev_off=0; prev_inode=""
[ -f "$STATE" ] && read -r prev_off prev_inode < "$STATE"
[ "$inode" = "$prev_inode" ] && [ "$size" -ge "$prev_off" ] || prev_off=0
tmp=$(mktemp)
tail -c +"$((prev_off + 1))" "$LOG" | head -c "$((size - prev_off))" > "$tmp"
echo "$size $inode" > "$STATE"

# ── NIC sayaçları (toplam + 2 sn'lik hız) ───────────────────────────────────
read_nic() { awk -v n="$NIC:" '$1==n {print $2, $10}' /proc/net/dev; }
read -r rx1 tx1 <<< "$(read_nic)"; sleep 2; read -r rx2 tx2 <<< "$(read_nic)"
rx_rate=$(( (rx2 - rx1) / 2 )); tx_rate=$(( (tx2 - tx1) / 2 ))

# ── Satırları SQL'e çevir (python3: JSON güvenli) ────────────────────────────
python3 - "$tmp" "$rx2" "$tx2" "$rx_rate" "$tx_rate" <<'PY' | $PSQL >/dev/null
import sys, json, collections, statistics
path, rx, tx, rxr, txr = sys.argv[1], *map(int, sys.argv[2:6])
def q(s):
    return "NULL" if s is None else "'" + str(s).replace("'", "''") + "'"
per_min = collections.defaultdict(lambda: {"n":0,"bi":0,"bo":0,"s2":0,"s3":0,"s4":0,"s429":0,"s5":0,"ms":[],"paths":collections.Counter()})
errors, recent = [], []
with open(path, encoding="utf-8", errors="replace") as f:
    for line in f:
        line = line.strip()
        if not line.startswith("{"): continue
        try: r = json.loads(line)
        except Exception: continue
        t = r.get("t", "")
        if len(t) < 16: continue
        minute = t[:16] + ":00" + t[19:]          # 2026-09-01T12:34:00+03:00
        s = int(r.get("s") or 0)
        ms = int(float(r.get("ms") or 0) * 1000)
        m = per_min[minute]
        m["n"] += 1; m["bi"] += int(r.get("bi") or 0); m["bo"] += int(r.get("bo") or 0); m["ms"].append(ms)
        if 200 <= s < 300: m["s2"] += 1
        elif 300 <= s < 400: m["s3"] += 1
        elif s == 429: m["s429"] += 1; m["s4"] += 1
        elif 400 <= s < 500: m["s4"] += 1
        elif s >= 500: m["s5"] += 1
        p = (r.get("p") or "")[:200]
        m["paths"][p] += 1
        row = (t, r.get("ip"), r.get("m"), p, s, int(r.get("bi") or 0), int(r.get("bo") or 0), ms, (r.get("ua") or "")[:200], (r.get("r") or "")[:200])
        if s == 429 or s >= 500: errors.append(row)
        recent.append(row)
out = []
last = None
for minute, m in sorted(per_min.items()):
    ms = sorted(m["ms"]); avg = int(statistics.fmean(ms)) if ms else None
    p95 = ms[int(len(ms) * 0.95) - 1] if len(ms) >= 2 else (ms[0] if ms else None)
    top = json.dumps([{"path": k, "n": v} for k, v in m["paths"].most_common(5)], ensure_ascii=False)
    out.append(f"INSERT INTO public.net_samples (minute, requests, bytes_in, bytes_out, s2xx, s3xx, s4xx, s429, s5xx, avg_ms, p95_ms, top_paths) "
               f"VALUES ({q(minute)}, {m['n']}, {m['bi']}, {m['bo']}, {m['s2']}, {m['s3']}, {m['s4']}, {m['s429']}, {m['s5']}, {avg if avg is not None else 'NULL'}, {p95 if p95 is not None else 'NULL'}, {q(top)}::jsonb) "
               f"ON CONFLICT (minute) DO UPDATE SET requests = net_samples.requests + EXCLUDED.requests, bytes_in = net_samples.bytes_in + EXCLUDED.bytes_in, bytes_out = net_samples.bytes_out + EXCLUDED.bytes_out, "
               f"s2xx = net_samples.s2xx + EXCLUDED.s2xx, s3xx = net_samples.s3xx + EXCLUDED.s3xx, s4xx = net_samples.s4xx + EXCLUDED.s4xx, s429 = net_samples.s429 + EXCLUDED.s429, s5xx = net_samples.s5xx + EXCLUDED.s5xx, "
               f"avg_ms = coalesce(EXCLUDED.avg_ms, net_samples.avg_ms), p95_ms = greatest(coalesce(EXCLUDED.p95_ms,0), coalesce(net_samples.p95_ms,0)), top_paths = EXCLUDED.top_paths;")
    last = minute
# NIC sayaçları: bu dakikanın satırına (satır yoksa yalnızca NIC ile bir satır aç)
import datetime
now_min = datetime.datetime.now().astimezone().replace(second=0, microsecond=0).isoformat()
out.append(f"INSERT INTO public.net_samples (minute, nic_rx, nic_tx, nic_rx_rate, nic_tx_rate) VALUES ({q(now_min)}, {rx}, {tx}, {rxr}, {txr}) "
           f"ON CONFLICT (minute) DO UPDATE SET nic_rx = EXCLUDED.nic_rx, nic_tx = EXCLUDED.nic_tx, nic_rx_rate = EXCLUDED.nic_rx_rate, nic_tx_rate = EXCLUDED.nic_tx_rate;")
for (t, ip, mth, p, s, bi, bo, ms, ua, ref) in errors[:500]:
    out.append(f"INSERT INTO public.request_errors (at, ip, method, path, status, bytes_out, ms, ua, referer) VALUES ({q(t)}, {q(ip)}, {q(mth)}, {q(p)}, {s}, {bo}, {ms}, {q(ua)}, {q(ref)});")
for (t, ip, mth, p, s, bi, bo, ms, ua, ref) in recent[-1000:]:
    out.append(f"INSERT INTO public.request_recent (at, ip, method, path, status, bytes_in, bytes_out, ms, ua) VALUES ({q(t)}, {q(ip)}, {q(mth)}, {q(p)}, {s}, {bi}, {bo}, {ms}, {q(ua)});")
out.append("SELECT public.net_prune();")
print("BEGIN;"); print("\n".join(out)); print("COMMIT;")
PY
rc=$?
rm -f "$tmp"
[ $rc -eq 0 ] || echo "$(date -Is) yazma hatası (rc=$rc)"
