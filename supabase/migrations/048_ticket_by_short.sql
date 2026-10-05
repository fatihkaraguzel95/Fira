-- 048: Kısa kimlikle görev bulma
--
-- Arayüzde kartların üstünde görünen kısa kimlik (#118F5C) görevin UUID'sinin ilk altı
-- hanesi. Telegram botunda "/gorev 118F5C" yazabilmek ve düğme verisine sığdırmak için
-- (Telegram callback_data en fazla 64 bayt) ön ekten görev bulmak gerekiyor.
--
-- SECURITY INVOKER: RLS aynen uygulanır, yani kullanıcı yalnızca görebildiği görevi bulur.

CREATE OR REPLACE FUNCTION public.ticket_by_short(p_code text)
RETURNS SETOF public.tickets
LANGUAGE sql STABLE AS $$
  SELECT t.*
  FROM public.tickets t
  WHERE p_code IS NOT NULL
    AND length(regexp_replace(p_code, '[^0-9A-Fa-f]', '', 'g')) BETWEEN 4 AND 32
    AND replace(t.id::text, '-', '') LIKE lower(regexp_replace(p_code, '[^0-9A-Fa-f]', '', 'g')) || '%'
  ORDER BY t.created_at
  LIMIT 5
$$;

REVOKE ALL ON FUNCTION public.ticket_by_short(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ticket_by_short(text) TO authenticated;
