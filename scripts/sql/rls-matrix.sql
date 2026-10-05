-- Çalıştırma: docker exec -i supabase-db psql -U postgres -d postgres -At < rls-matrix.sql > docs/rls-matrix.md
-- public şemasındaki her tablo için politika matrisini (rol × işlem) Markdown olarak üretir.
-- Salt okunur; QA verisine dokunmaz.
SELECT '# RLS politika matrisi' || E'\n\n' ||
       'Üretim: `scripts/sql/rls-matrix.sql` — ' || to_char(now(), 'YYYY-MM-DD') || E'\n\n' ||
       'Sütunlar: her işlem için politikanın hangi rollere açık olduğu ve koşulun özeti. ' ||
       '`—` = o işlem için politika yok (RLS açıkken bu "kimse yapamaz" demektir). ' ||
       'Tam metin için `pg_policies`.' || E'\n';

WITH pol AS (
  SELECT tablename, cmd, policyname,
         array_to_string(roles::text[], ',') AS roles,
         coalesce(qual, '') AS q, coalesce(with_check, '') AS wc
  FROM pg_policies WHERE schemaname = 'public'
),
tbl AS (
  SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '%_legacy' ORDER BY tablename
),
cell AS (
  SELECT t.tablename, c.cmd,
         string_agg(
           '`' || p.roles || '` ' ||
           CASE
             WHEN p.q = 'true' OR p.wc = 'true' THEN '**herkese açık**'
             WHEN p.q ILIKE '%can_see_profile%' THEN 'profili görebilen (takımdaş)'
             WHEN p.q ILIKE '%team_role%' AND p.q ILIKE '%is_system_admin%' THEN 'takım üyesi ya da sistem yöneticisi'
             WHEN p.q ILIKE '%is_system_admin%' OR p.wc ILIKE '%is_system_admin%' THEN 'sistem yöneticisi'
             WHEN p.q ILIKE '%is_team_admin%' OR p.wc ILIKE '%is_team_admin%' THEN 'takım yöneticisi'
             WHEN p.q ILIKE '%can_write_team%' OR p.wc ILIKE '%can_write_team%' THEN 'yazma yetkili üye'
             WHEN p.q ILIKE '%team_role%' OR p.wc ILIKE '%team_role%' OR p.q ILIKE '%team_members%' THEN 'takım üyesi'
             WHEN p.q ILIKE '%auth.uid()%' OR p.wc ILIKE '%auth.uid()%' THEN 'sahibi / ilgili kişi'
             ELSE 'özel koşul'
           END || ' (' || p.policyname || ')', '<br>' ORDER BY p.policyname) AS txt
  FROM tbl t
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS c(cmd)
  LEFT JOIN pol p ON p.tablename = t.tablename AND (p.cmd = c.cmd OR p.cmd = 'ALL')
  GROUP BY t.tablename, c.cmd
)
SELECT E'\n| Tablo | RLS | SELECT | INSERT | UPDATE | DELETE |\n|---|---|---|---|---|---|' || E'\n' ||
       string_agg(
         '| `' || t.tablename || '` | ' || CASE WHEN t.rowsecurity THEN 'açık' ELSE '**KAPALI**' END || ' | ' ||
         coalesce((SELECT txt FROM cell WHERE cell.tablename = t.tablename AND cmd = 'SELECT'), '—') || ' | ' ||
         coalesce((SELECT txt FROM cell WHERE cell.tablename = t.tablename AND cmd = 'INSERT'), '—') || ' | ' ||
         coalesce((SELECT txt FROM cell WHERE cell.tablename = t.tablename AND cmd = 'UPDATE'), '—') || ' | ' ||
         coalesce((SELECT txt FROM cell WHERE cell.tablename = t.tablename AND cmd = 'DELETE'), '—') || ' |',
         E'\n' ORDER BY t.tablename)
FROM tbl t;

SELECT E'\n## Storage (`storage.objects`)\n\n| İşlem | Roller | Politika |\n|---|---|---|\n' ||
       string_agg('| ' || cmd || ' | `' || array_to_string(roles::text[], ',') || '` | ' || policyname || ' |', E'\n' ORDER BY cmd, policyname)
FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';

SELECT E'\n## SECURITY DEFINER fonksiyonlar ve kimlerin çalıştırabildiği\n\n| Fonksiyon | anon | authenticated |\n|---|---|---|\n' ||
       string_agg('| `' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')` | ' ||
                  CASE WHEN has_function_privilege('anon', p.oid, 'execute') THEN '**evet**' ELSE 'hayır' END || ' | ' ||
                  CASE WHEN has_function_privilege('authenticated', p.oid, 'execute') THEN 'evet' ELSE 'hayır' END || ' |',
                  E'\n' ORDER BY p.proname)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef;

SELECT E'\n## Denetim\n\n' ||
       '- Otomatik test: `scripts/sql/rls-audit-tests.sql` (yabancı hesap her tabloda 0 satır; token, profil, storage, RPC ve kod-deneme kontrolleri).' || E'\n' ||
       '- `USING (true)` kalıntısı: yalnızca `system_settings` okuması (duyuru/bakım metni, bilinçli).' || E'\n' ||
       '- Profil görünürlüğü: `can_see_profile()` (052) — kendin, takımdaşların, takımlarının görevlerinde geçen içe aktarılmış kişiler, seni davet eden.';
