-- 054: SECURITY DEFINER fonksiyonlarda anon yetkisi
--
-- Politika matrisi (docs/rls-matrix.md) gösterdi: yönetim RPC'leri, davet/üyelik
-- fonksiyonları, aktivite trigger fonksiyonları ve yardımcılar anon'a EXECUTE veriyordu
-- (Supabase varsayılanı). Hepsi içeride auth.uid()/admin_guard() kontrolü yaptığı için
-- fiilen bir şey yapılamıyordu; yine de en az yetki: anon yalnızca giriş öncesi gerçekten
-- gereken şeyi çalıştırabilsin.
--
-- Anon'da kalanlar:
--   • invitation_preview(token)   — davet bağlantısı giriş yapmadan önce açılıyor
--   • RLS politikalarının içinde çağrılan saf yardımcılar (team_role, can_write_team,
--     is_team_admin, is_system_admin, project_team, ticket_team, status_name, person_name):
--     bilgi sızdırmazlar; anon bir politikaya takıldığında "permission denied for function"
--     yerine sessizce 0 satır alsın.
DO $$
DECLARE
  f record;
  keep text[] := ARRAY['invitation_preview','team_role','can_write_team','is_team_admin','is_system_admin',
                       'project_team','ticket_team','status_name','person_name','activity_actor'];
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND NOT (p.proname = ANY (keep))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM public, anon', f.proname, f.args);
    -- Trigger fonksiyonları rol tarafından çağrılmaz; diğerlerini authenticated çalıştırabilsin.
    IF (SELECT prorettype::regtype::text FROM pg_proc WHERE oid = f.oid) <> 'trigger' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', f.proname, f.args);
    END IF;
  END LOOP;
END $$;
