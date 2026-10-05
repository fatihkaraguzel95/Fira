-- 086: Yeni listenin varsayılan durumları kategorisiz açılıyordu (#59e0b75e sırasında bulundu)
--
-- 033 `ticket_statuses.category`yi ekledi ve mevcut satırları doldurdu, ama dört
-- varsayılan durumu üreten `create_default_statuses()` tetikleyicisi güncellenmedi.
-- Sonuç: 033'ten sonra açılan her listede "Tamamlandı" da dahil dört durum da
-- `active` kategorisinde kalıyordu. Etkisi: görev tamamlandı sayılmıyor (kutlama
-- yok, "kapatılanları göster" süzgeci boş, `durum:tamamlandı` araması tutmuyor,
-- tekrarlayan görev serisi hep "açık görev var" görüyor).
--
-- Kategoriler 033'teki adlandırma kurallarıyla aynı: Yapılacak → backlog,
-- Devam Ediyor / İncelemede → active, Tamamlandı → closed (mevcut listelerin
-- tamamı böyle; StatusManager de listede bir `closed` durum bekliyor).

create or replace function public.create_default_statuses() returns trigger as $$
begin
  insert into public.ticket_statuses (project_id, name, color, order_index, category) values
    (new.id, 'Yapılacak',    '#6b7280', 0, 'backlog'),
    (new.id, 'Devam Ediyor', '#3b82f6', 1, 'active'),
    (new.id, 'İncelemede',   '#f59e0b', 2, 'active'),
    (new.id, 'Tamamlandı',   '#10b981', 3, 'closed');
  return new;
end;
$$ language plpgsql;

-- 033'ten sonra açılmış listelerdeki yanlış kategorileri düzelt: yalnız adı
-- kalıbı tutan ve hâlâ `active` olan satırlara dokunur (elle verilmiş kategori
-- ya da yeniden adlandırılmış durum olduğu gibi kalır).
update public.ticket_statuses set category = 'closed'
 where category = 'active' and lower(name) ~ '(kapat|closed|iptal|cancel)';
update public.ticket_statuses s set category = 'closed'
 where s.category = 'active' and lower(s.name) ~ '(tamamlan|done|bitti|complete)'
   and not exists (select 1 from public.ticket_statuses c
                    where c.project_id = s.project_id and c.category in ('done', 'closed'));
update public.ticket_statuses set category = 'done'
 where category = 'active' and lower(name) ~ '(tamamlan|done|bitti|complete)';
update public.ticket_statuses set category = 'backlog'
 where category = 'active' and lower(name) ~ '(backlog|yapılacak|yapilacak|to ?do|başlanmadı|baslanmadi|planlan)';
update public.ticket_statuses set category = 'blocked'
 where category = 'active' and lower(name) ~ '(bloke|blocked|beklemede|engel)';
