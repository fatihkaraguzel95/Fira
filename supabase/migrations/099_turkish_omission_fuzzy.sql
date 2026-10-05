-- 099: Aramada Türkçe harflere duyarlı mesafe (#06903c11, v0.72.1)
--
-- Sorun: "grev" araması "Görev"i bulmuyordu, "gırev" buluyordu. 082'nin kuralı
-- harfleri katlıyor (ö→o) ve kelime düzeyinde Levenshtein uyguluyor, ama
--   1) 5 harften kısa terim yalnız birebir eşleşiyordu ("grev" 4 harf), ve
--   2) atlanan "ö" herhangi bir yanlış harf kadar (tam bir düzeltme) sayılıyordu.
-- "gırev" katlanınca "girev" (5 harf), "gorev"e 1 düzeltme: 0,8 — sınırda geçiyordu.
--
-- Yeni: Türkçe ağırlıklı Levenshtein (`fira_tr_similarity`). ç ğ ı ö ş ü klavyede
-- yoksa ya ASCII karşılığı yazılır (ö → o: katlamayla bedava) ya da hiç yazılmaz.
-- Bu harflerin **atlanması 0,5**, diğer her düzeltme 1; 3–4 harfli terimde diğer
-- düzeltmelere izin yok (genel yazım hatası kısa kelimede gürültü: "grav", "gorv"
-- "görev"i bulmaz). Kelimenin her önekiyle karşılaştırılır (yarım yazılmış kelime).
--   grev / görev          → 0,5 / 5  → 0,90     gırev / görev (düz yol) → 0,80
--   grevleri / görevleri  → 0,94     gncelleme / güncellemesi (önek) → 0,95
--   skstrma / sıkıştırma  → üç ı atlanmış, ş → s: 1,5 / 10 → 0,85 (karışık yazım)
--   blm / bölüm, srm / sürüm → 0,80
-- Birebir geçen terim yine 1 alır: "grev" araması "Grev" başlığını "Görev"in önüne koyar.
-- İstemcide aynısı: src/lib/fuzzy.ts (`trSimilarity`, `termScore`).
--
-- Hız: ağırlıklı yol plpgsql, yalnız ç ğ ı ö ş ü içeren kelimede ve ön süzgeçten
-- geçen metinde çalışır: terim, metnin bu harfler çıkarılmış hâlinde geçiyorsa ya
-- da terimin c g i o s u dışındaki harfleri (en az 3) metnin aynı harfleri de
-- çıkarılmış hâlinde geçiyorsa (bu harfler katlanabilir ya da atlanabilir; geri
-- kalanlar birebir olmalı). Düz yol (082) değişmedi.
--
-- Yalnız puanlama değişir; `palette_search` ve `fira_all_terms` bunu çağırdığı için
-- palet, liste/takım/durum süzgeçleri ve bağlama çubuğu birlikte düzelir.

create or replace function public.fira_tr_similarity(term text, w text)
returns real
language plpgsql immutable parallel safe strict
as $$
declare
  n int := length(term);
  m int := length(w);
  full_cost real := case when length(term) < 5 then 100 else 1 end;
  prev real[];
  cur real[];
  best real := 0;
  i int;
  j int;
  c text;
begin
  if n = 0 or m = 0 then return 0; end if;
  prev := array_fill(0::real, array[m + 1], array[0]);
  for j in 1..m loop
    c := substr(w, j, 1);
    prev[j] := prev[j - 1] + case when strpos('çğıöşü', c) > 0 then 0.5 else full_cost end;
  end loop;
  for i in 1..n loop
    cur := array_fill(0::real, array[m + 1], array[0]);
    cur[0] := i * full_cost;
    for j in 1..m loop
      c := substr(w, j, 1);
      cur[j] := least(
        prev[j] + full_cost,
        cur[j - 1] + case when strpos('çğıöşü', c) > 0 then 0.5 else full_cost end,
        prev[j - 1] + case when translate(c, 'çğıöşüâîûäß', 'cgiosuaiuas') = substr(term, i, 1) then 0 else full_cost end);
    end loop;
    prev := cur;
  end loop;
  for j in 1..m loop
    best := greatest(best, 1 - prev[j] / greatest(n, j));
  end loop;
  return best;
end
$$;

create or replace function public.fira_term_score(term text, txt text)
returns real
language sql immutable parallel safe
set search_path = public, extensions
as $$
  select case
    when term is null or term = '' then 1::real
    when strpos(public.fira_fold(txt), term) > 0 then 1::real
    when length(term) < 3 then 0::real
    else greatest(
      -- Düz yol (082, değişmedi): 5+ harfli terimde katlanmış kelimeye ve önekine Levenshtein.
      case when length(term) < 5 then 0::real else coalesce((
        select max(greatest(
                 1 - extensions.levenshtein(term, w)::real / greatest(length(term), length(w)),
                 case when length(w) > length(term)
                      then 1 - extensions.levenshtein(term, left(w, length(term)))::real / length(term)
                      else 0 end))
          from regexp_split_to_table(public.fira_fold(txt), '[^a-z0-9]+') w
         where w <> ''), 0)::real end,
      -- Türkçe yol (099): ön süzgeçten geçerse, Türkçe harf içeren kelimelerde ağırlıklı mesafe.
      case when strpos(lower(translate(txt, 'ÂÎÛÄİIâîûäßçğıöşüÇĞÖŞÜ', 'aiuaiiaiuas')), term) = 0
             and (length(translate(term, 'cgiosu', '')) < 3
                  or strpos(translate(lower(translate(txt, 'ÂÎÛÄİIâîûäßçğıöşüÇĞÖŞÜ', 'aiuaiiaiuas')), 'cgiosu', ''),
                            translate(term, 'cgiosu', '')) = 0)
           then 0::real
           else coalesce((
             select max(public.fira_tr_similarity(term, w))
               from regexp_split_to_table(lower(translate(txt, 'ÇĞÖŞÜİIÂÎÛÄ', 'çğöşüiiâîûä')), '[^a-z0-9çğıöşüâîûäß]+') w
              where w ~ '[çğıöşü]'), 0)::real end)
  end
$$;

revoke all on function public.fira_tr_similarity(text, text) from public, anon;
grant execute on function public.fira_tr_similarity(text, text) to authenticated, service_role;
