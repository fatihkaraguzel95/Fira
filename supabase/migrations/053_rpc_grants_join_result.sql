-- 053: RPC yetkileri ve kod deneme sayacının kalıcılığı
--
-- RLS denetim testi (scripts/sql/rls-audit-tests.sql) iki şey buldu:
--
--  1) Supabase varsayılanı yeni fonksiyonlara `anon` için de EXECUTE veriyor; sekiz
--     kritik RPC'de bu duruyordu. Hepsi auth.uid() kontrolü yaptığı için fiilen bir şey
--     yapılamıyordu, ama en az yetki ilkesi gereği kaldırıldı.
--  2) join_team_by_code hatalı denemeyi kaydedip RAISE ediyordu — istisna aynı işlemdeki
--     kaydı da geri alıyor, sayaç hiç dolmuyordu. Fonksiyon artık istisna atmıyor,
--     sonucu JSON olarak döndürüyor: {ok:true, team:{…}} ya da {ok:false, error:'…'}.
--     İstemci (useJoinTeamByCode) buna göre güncellendi.

REVOKE EXECUTE ON FUNCTION public.accept_invitation(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.accept_invitation_by_id(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.add_team_member_by_email(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.import_bundle(jsonb, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.merge_user_prefs(text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.log_import_completion(uuid, timestamptz, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_import_author(uuid, uuid, text, timestamptz) FROM anon;

-- Dördü PUBLIC üzerinden de açıktı (anon PUBLIC'ten miras alır); yalnızca authenticated kalsın.
REVOKE ALL ON FUNCTION public.accept_invitation(text) FROM public;
REVOKE ALL ON FUNCTION public.accept_invitation_by_id(uuid) FROM public;
REVOKE ALL ON FUNCTION public.add_team_member_by_email(uuid, text, text) FROM public;
REVOKE ALL ON FUNCTION public.merge_user_prefs(text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_invitation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invitation_by_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_team_member_by_email(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_user_prefs(text, jsonb) TO authenticated;

-- Dönüş tipi değiştiği için DROP + CREATE (CREATE OR REPLACE tip değişimine izin vermez).
DROP FUNCTION IF EXISTS public.join_team_by_code(text);

CREATE FUNCTION public.join_team_by_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t teams;
  v_code text := upper(trim(coalesce(p_code, '')));
  v_recent_fail int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Oturum bulunamadı'); END IF;

  DELETE FROM join_attempts WHERE user_id = auth.uid() AND attempted < now() - interval '1 day';

  SELECT count(*) INTO v_recent_fail
    FROM join_attempts
   WHERE user_id = auth.uid() AND NOT ok AND attempted > now() - interval '15 minutes';
  IF v_recent_fail >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.', 'locked', true);
  END IF;

  IF length(v_code) < 8 THEN
    INSERT INTO join_attempts (user_id, ok) VALUES (auth.uid(), false);
    RETURN jsonb_build_object('ok', false, 'error', 'Geçersiz takım kodu');
  END IF;

  SELECT * INTO t FROM teams WHERE code = v_code;
  IF NOT FOUND THEN
    INSERT INTO join_attempts (user_id, ok) VALUES (auth.uid(), false);
    RETURN jsonb_build_object('ok', false, 'error', 'Geçersiz takım kodu');
  END IF;
  IF EXISTS (SELECT 1 FROM team_members WHERE team_id = t.id AND user_id = auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Zaten bu takımın üyesisin');
  END IF;

  INSERT INTO team_members (team_id, user_id, role) VALUES (t.id, auth.uid(), 'member');
  INSERT INTO join_attempts (user_id, ok) VALUES (auth.uid(), true);
  RETURN jsonb_build_object('ok', true, 'team', to_jsonb(t));
END $$;

REVOKE ALL ON FUNCTION public.join_team_by_code(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.join_team_by_code(text) TO authenticated;
