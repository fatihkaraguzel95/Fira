-- 095 — Anonim rolün çalıştırabildiği SECURITY DEFINER yardımcıları kapat (#990dfec5).
--
-- 053/054 kuralı: SECURITY DEFINER fonksiyonlar `anon`a açık olmaz. 054'ten sonra
-- eklenen ya da yeniden yaratılan dört fonksiyon PostgreSQL'in varsayılan
-- "PUBLIC EXECUTE" yetkisiyle anonim role de açık kalmıştı:
--   person_name(uuid)   — bir profil kimliğinden ad döndürüyor; oturumsuz biri
--                          anon anahtarıyla /rest/v1/rpc/person_name çağırabiliyordu
--   status_name(uuid)   — durum adı
--   ai_work_cancel_on_done(), tickets_mentions() — tetikleyici fonksiyonları
--
-- person_name/status_name yalnız tetikleyici ve SECURITY DEFINER gövdelerinin
-- içinden (tickets_activity, assignees_activity, log_mentions) çağrılıyor; istemci
-- kodu kullanmıyor. Tetikleyici fonksiyonlarında EXECUTE yetkisi çalışma anında
-- denetlenmez (yalnız CREATE TRIGGER sırasında), o yüzden tetikleyiciler etkilenmez.
-- Politikalarda kullanılan yardımcılar (project_team, ticket_team, team_role,
-- is_team_admin, can_write_team, is_system_admin) bilerek dokunulmadı: anonim bir
-- sorguda politika değerlendirilirken EXECUTE gerekiyor, kapatmak boş sonuç yerine
-- "permission denied" hatası üretirdi. Yalnız ekleme/yetki; şema değişmiyor.

revoke execute on function public.person_name(uuid) from public, anon;
revoke execute on function public.status_name(uuid) from public, anon;
grant execute on function public.person_name(uuid) to authenticated, service_role;
grant execute on function public.status_name(uuid) to authenticated, service_role;

revoke execute on function public.ai_work_cancel_on_done() from public, anon;
revoke execute on function public.tickets_mentions() from public, anon;
