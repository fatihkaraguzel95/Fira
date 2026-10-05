# Bekleyen migration'lar (024 → 117)

Bu klasör **üretilmiş bir yardımcıdır**, şemanın kaynağı değildir.
Kaynak her zaman `supabase/migrations/` altındaki tek tek dosyalardır.
Çalıştırdıktan sonra bu klasörü silebilirsiniz.

## Durum

Supabase projeniz (`zkyegeioiyxaiamugbjt`) **023**'e kadar uygulanmış durumda:

- var: `profiles`, `tickets`, `teams`, `team_members`, `team_invitations`,
  `projects`, `ticket_statuses`, `tags`, `ticket_assignees`,
  `ticket_subtasks`, `ticket_deadlines`, `ticket_attachments`, `ticket_comments`
- yok: `projects.archived` (024) ve sonrası — yani **024–117 arası 94 migration**

Frontend 0.98.0 ve Telegram botu bunların tamamını bekliyor (sayfalar, gelen kutusu, favoriler,
kayıtlı görünümler, yapılacaklar, tuval, ajanlar, Telegram, yönetim ekranı…).

## Nasıl çalıştırılır

Supabase Dashboard → **SQL Editor** → her dosyayı **sırayla** yapıştırıp çalıştırın:

| sıra | dosya | kapsam |
|------|-------|--------|
| 1 | `part01_024-038.sql` | arşiv, roller/klasörler/renkler, görev modeli, tercihler, yönetim, etkinlik |
| 2 | `part02_039-065.sql` | davetler, Telegram, ağ istatistikleri, bildirimler, AI iş istekleri, sayfalar |
| 3 | `part03_066-081.sql` | sayfa sürümleri/çöp, yetim dosyalar, favoriler, kayıtlı görünümler |
| 4 | `part04_082-093.sql` | komut paleti araması (fuzzystrmatch), tekrar eden görevler |
| 5 | `part05_094-102.sql` | tuval (çizim/whiteboard), yapılacaklar, ajanlar, ajan token'ları |
| 6 | `part06_103-113.sql` | AI koşuları/adımları, kural sayfaları, pasif tarama, çeviriler |
| 7 | `part07_114-117.sql` | palet tür filtreleri, ajan ilk geçiş, **Telegram compose + AI** |

**Bir parça hata verirse sonrakine geçmeyin** — hatayı çözüp o parçayı
tamamlayın. Parçalar numara sırasına bağımlıdır.

## Notlar

- `ALTER PUBLICATION supabase_realtime ADD TABLE …` ifadeleri SQL Editor'da
  çalışır (postgres rolü publication'ın sahibi).
- `082` `fuzzystrmatch` eklentisini kurar (`extensions` şemasına) — Supabase'de izinli.
- Hiçbiri Dashboard'dan elle ayar gerektirmez; Storage bucket'ları yalnız okunur.
- Bitince kontrol: aşağıdaki tabloların hepsi gelmeli.

```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('user_preferences','ticket_activity','pages','page_versions',
                     'user_favorites','list_views','ticket_checklist_items',
                     'page_scenes','agents','ai_runs','content_translations')
order by 1;
-- 11 satır dönmeli
```
