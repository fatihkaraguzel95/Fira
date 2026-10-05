# Kılavuz ekran görüntüleri: tarifler

Kullanıcı kılavuzundaki (`docs/kullanici-kilavuzu.md`) ekran görüntülerinin nasıl alındığı. Arayüz değişince ilgili tarif yeniden çalıştırılır; görüntü yayından önce **açılıp bakılır**.

```bash
cd tools/agent/qa
node guide/run.mjs guide/batch-c.mjs                              # partideki tariflerin adları
FIRA_QA_SHOTS=<klasör> node guide/run.mjs guide/batch-c.mjs bolumler,dosyalar
python guide/crop.py <klasör>                                      # kırpma (Pillow gerekir)
python guide/sheet.py <klasör> <çıktı.png> 3 700 700 bolumler dosyalar   # toplu bakış sayfası
```

Sonra belgede görüntünün adresi `SHOT:<ad>` yapılır ve `fira-agent publish <sayfa> docs/kullanici-kilavuzu.md <klasör>` yayınlar.

## Kurallar

- **Yalnız demo takım ("Fira Tanıtım").** `run.mjs` kenar çubuğunda başka takım görünüyorsa ve demo takım yoksa çekmez.
- **Gizleme kapalı tarafa düşer.** Başka takımların satırlarını gösteren listeler (gelen kutusu, Görevlerim, Ana sayfa › Son açılanlar) kendini yeniden çizer; elle gizlenen satır geri gelir. Bu yüzden satırlar bir stil kuralıyla **varsayılan gizlidir**, yalnız demo takımın satırları işaretlenir (`data-qa-keep`). Yeniden çizilen satır işaretsizdir ve gizli kalır: görüntü satır kaybedebilir, kazanamaz. Çekimden önce ayrıca "ekrandaki her satır demo takımın mı" diye bakılır.
- **Gerçek kişi görünmez.** Demo takımın gerçek üyesi çekim anında uydurma bir adla ve baş harfle çizilir (`neutralPeople`); e-posta ve ajan anahtarı maskelenir (`maskSecrets`). Hiçbir şey kaydedilmez.
- **Çekim ham ve tam penceredir**, kırpma sonradan yapılır: kırpılmış ekran görüntüsü sayfayı yeniden boyutlandırıp düzeni kaydırabiliyor. Pencere örtülüyken yeni kare gelmesi için çekim sürerken görünmez bir nokta kıpırdatılır.
- Yazmadan önce odak kanıtlanır (`waitFocus`); pencere öne getirilmez.

## Demo verisine bağımlılıklar

Tarifler demo takımdaki şu veriye dayanır (silinirse ilgili tarif boş döner):

| Veri | Kullanan tarif |
|---|---|
| "Web sitesi yenileme" listesi ve görevleri (Ana sayfa tasarımı, İletişim formu, Hız ölçümü ve iyileştirme, Haftalık durum toplantısı notları, Erişilebilirlik denetimi) | çoğu |
| Kayıtlı görünüm "Önceliğe göre" | `gorunum-sekmeleri` (yoksa kendisi oluşturur) |
| Sayfa "Toplantı notları" (bir eski sürümüyle), çizim "Site haritası", whiteboard "Sprint 12 retrospektifi" | `sayfa`, `surum-gecmisi`, `cizim`, `whiteboard`, `kalem`, `tahta-menusu` |
| İçe aktarma kişisi "Elif Kaya" ve "Ana sayfa tasarımı"ndaki yorumları (gelen kutusunda demo satırı olsun diye) | `gelen-kutusu` |
| Çalıştırma kaydı "QA TL-346 …" (adımları, araçları, kuralları olan bir iş) | `calistirma-ayrintisi`, `uyulan-kurallar` |
| "Ana sayfa tasarımı"ndaki `ana-sayfa-taslak.png` ve onun okunmuş metni (`file_texts`); takımın "Görsellerdeki metni çıkar" anahtarı açık | `gorsel-metin` |
| Elif Kaya'nın "Ana sayfa tasarımı"ndaki İngilizce ve Almanca yorumları, "Pazarlama kampanyası" listesindeki "Newsletter copy review" görevi (İngilizce açıklama) ve bunların Türkçe çevirileri (`content_translations`); takımın "Açıklama ve yorumları çevir" anahtarı açık; QA hesabının okuma dili Türkçe (Ayarlar › Dil) | `ceviri-yorum`, `ceviri-orijinal`, `ceviri-aciklama`, `pasif-isler`, `okuma-dilleri` |

Çeviriler ve okunmuş metin bir çalıştırıcının pasif işiyle oluşur; demo verisi silinirse deneme ayarıyla yeniden üretilir (`fira-agent run --passive <n> --config <deneme ayarı>`, gerçek model çağrısı yapar).

## Tarifi olmayanlar

| Görüntü | Neden |
|---|---|
| Giriş ekranı | Oturumu kapatmayı gerektirir; QA penceresinde şifre yazılmaz. |
| Canlıya çıkış onayı kutusu (Onayla / Reddet düğmeleriyle) | Düğmeler ajanın kendi hesabına görünmez; QA hesabı ajanın kendisi. |
| Uygulama içi bildirim kartı | Başka birinin yaptığı gerçek bir olay gerekir (demo kişi adına veritabanında yorum eklenerek alındı). |

## Hangi tarif hangi görüntü

| Parti | Tarifler |
|---|---|
| `batch-a` | takimlar-menusu, takim-menusu, klasor-menusu, liste-menusu, guncelle-dugmesi, pano-karti, hizli-ekle, gorunum-menusu, tarih-hucresi, toplu-islem |
| `batch-b` | tanitim-turu, palet-filtreler, palet-filtreli, palet-arama, palet-komutlar, filtre-menusu, liste-penceresi (+ liste-ust, liste-durumlar), gorunum-sekmeleri |
| `batch-c` | planlanan-tekrarlar, bicim-cubugu, komut-menusu, tekrar-penceresi, ekleme-listesi, bos-alt-gorevler, bolumler (+ yapilacaklar), gorev-bagla, dosyalar, dosya-onizleme, etkinlik-paneli, claude-yaptir, ajan-satiri |
| `batch-d` | ayarlar-bildirimler, ayarlar-dil, ayarlar-kisayollar, claudeum, ajan-olustur, kisayol-listesi, f1-katmani, takim-uyeler, takim-yedek, takim-onenote, takim-ajan-kurallari |
| `batch-e`, `batch-e2` | sayfa, surum-gecmisi, cizim, whiteboard; kalem, tahta-menusu |
| `batch-f` | gelen-kutusu, gelen-kutusu-surum |
| `batch-g` | ana-sayfa, gorevlerim, ajan-paneli, calistirma-ayrintisi, uyulan-kurallar, yonetim |
| `batch-i` | dosya-ekle |

Genel görünüm, üst çubuk, profil menüsü, liste görünümü, görev penceresi ve Ayarlar › Temalar / Görünüm / Beta görüntüleri 0.94.1 belge turunda ayrı bir betikle alındı; aynı yardımcılarla (`board`, `listView`, `ticket`, ayar sekmesi) yeniden alınabilir.
