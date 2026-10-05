#!/usr/bin/env bash
# Tekrarlayan görevler: zamanı gelenleri üretir, hatırlatmaları gönderir (#59e0b75e).
#
# Fira'da pg_cron yok (paylaşımlı sunucuya DB eklentisi kurulmuyor), bu yüzden
# tetik sunucunun kendi cron'u: */5 * * * * $HOME/fira-recurrences.sh
# Tek giriş noktası `recurrence_tick()`; üretilen ve hatırlatılan sayısını döner.
# İstemci de liste açılışında `generate_due_recurrences(<liste>)` çağırır, yani
# bu iş bir süre çalışmazsa görevler kaybolmaz, yalnız geç görünür.
set -u
LOG_TAG="fira-recurrences"

out=$(docker exec supabase-db psql -U postgres -d postgres -At \
        -c "select public.recurrence_tick()" 2>&1)
rc=$?

if [ $rc -ne 0 ]; then
  echo "$(date '+%F %T') $LOG_TAG ERROR rc=$rc $out"
  exit $rc
fi

# Sessiz kal: yalnız bir şey ürediyse ya da hatırlatma gittiyse yaz (cron logu şişmesin).
case "$out" in
  '{"created": 0, "reminded": 0}') exit 0 ;;
  *) echo "$(date '+%F %T') $LOG_TAG $out" ;;
esac
