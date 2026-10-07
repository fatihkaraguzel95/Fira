# Telegram botu

Telefondan Fira görevi açmak için. Derdini yazarsın, yapay zekâ onu düzgün bir
görev kartına çevirir, onaylarsın, görev Fira'ya düşer.

Bot Vercel'de çalışır (`api/telegram.js`). Kimsenin bilgisayarının açık kalması
gerekmez.

---

## Kullanıcı için: hesabını bağla

Bir kere yapılır, bir daha sorulmaz.

1. Fira'da **Ayarlar → Bildirimler → Telegram → "Bağlantı kodu al"**
2. Çıkan **"Telegram'da aç"** düğmesine bas
   (ya da bota kendin gidip `/start KOD` yaz)
3. Bot "Bağlandık" derse tamamdır

Kod **tek kullanımlık** ve **15 dakika** geçerli. Süresi dolarsa yeni kod al.

Bağlandıktan sonra o sohbetten açılan her görev **senin adına** açılır. Hangi
listelere görev açabileceğini Fira'daki yetkilerin belirler — bot kimseye fazladan
yetki vermez.

### Kullanımı

Derdini düz yaz. Bot eksik gördüğü yeri sorar, sonra görev kartını önerir.
**"Görevi aç"** düğmesine basınca Fira'ya düşer. Düğmeye basmadan hiçbir şey
kaydedilmez.

Sohbetin tek çıktısı bir görevdir: bot destek vermez, çözüm önermez. Soru hakkı
**en fazla 3** ama soru istisnadır — ancak o bilgi olmadan görev gerçekten
yazılamıyorsa sorar, aksi halde eldeki bilgiyle kartı önerir. Konu dağılırsa
hangi işi kayda geçirmek istediğini sorup geri döner.

Açıklama her zaman **konuşmanın tamamının özeti** olur ve sabit bir şablonla
yazılır — hem okunabilir hem de görevi sonra işleyecek bir yapay zekânın
ayrıştırabileceği biçimde. Bölümler: `Özet` (her zaman), ardından varsa
`Adımlar`, `Beklenen`, `Gerçekleşen`, `Ortam`, `Not`. Bilgisi olmayan bölüm hiç
yazılmaz, "bilinmiyor" diye doldurulmaz.

"yeter", "aç", "oluştur" dersen soru sormayı bırakıp kartı hemen önerir.

Görev **hep aynı yere** açılır: hedef listenin **"Yapılacaklar"** sütununa. Bu
sorulmaz — telefondan yazılan her şey yeni iştir, yeni iş panonun başında durur.
Liste dışında bir yer gerekiyorsa görevi Fira'da taşırsın.

### Komutlar

| Komut | Ne yapar |
|---|---|
| `/yeni` | Adım adım yeni görev (`/yeni Yazıcı bozuk` → başlığı hemen verir) |
| `/ozet` | Konuşmayı görev kartına çevir |
| `/hedef` | Görevlerin açılacağı listeyi seç (sütun hep "Yapılacaklar") |
| `/proje` | Varsayılan listeyi değiştir |
| `/bana` | Bana atanmış açık görevler |
| `/bugun` | Bugün biten ve gecikmiş işlerim |
| `/gorev 118F5C` | Görev kartı + durum değiştirme düğmeleri |
| `/iptal` | Yarım kalan taslağı sil |
| `/yardim` | Komut listesi |

İlk görevden sonra seçtiğin liste varsayılan olur, sonraki görevlerde sorulmaz.

---

## Yeni birini eklemek

Yeni bot, yeni token, yeni deploy **gerekmez**. Bot çok kullanıcılıdır.

1. Kişinin bir Fira hesabı olsun (takıma davet et)
2. Yukarıdaki "hesabını bağla" adımlarını kendisi yapsın

Bot adını herkese açık paylaşabilirsin: geçerli bir kod olmadan bot hiçbir şey
yapmaz, sadece "önce bağlan" der. Kodlar Fira'nın içinden üretilir, yani giriş
yapmış olmak gerekir.

Bir Telegram hesabı aynı anda tek bir Fira hesabına bağlıdır. Başka bir kodla
`/start` yapılırsa önceki bağlantı silinir, yenisi geçerli olur.

---

## Yönetici için: tek seferlik kurulum

Bir kere yapılır.

### 1. Bot aç

BotFather'dan bot aç, token'ı al.

### 2. Vercel ortam değişkenleri

Settings → Environment Variables:

| Değişken | Ne |
|---|---|
| `TELEGRAM_BOT_TOKEN` | BotFather'ın verdiği token |
| `TELEGRAM_WEBHOOK_SECRET` | Aşağıdaki komutla üretilen rastgele değer |
| `SUPABASE_ANON_KEY` | Supabase → API Keys |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API Keys |
| `NVIDIA_API_KEY` | Yapay zekâ için (yoksa bot düğmeli akışla çalışır) |
| `FIRA_BASE_URL` | Fira'nın adresi — mesajlardaki linklerin kökü |
| `FIRA_PROJECT` | Görevlerin düşeceği **liste** adı (takım adı değil) |
| `FIRA_STATUS` | Görevlerin düşeceği sütun — boşsa `Yapılacaklar` |
| `VITE_TELEGRAM_BOT_USERNAME` | Botun kullanıcı adı, `@` olmadan |

Webhook sırrı üretmek için:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Telegram bu alanda yalnız `A-Z a-z 0-9 _ -` kabul eder. Base64 üretme, `+ / =`
karakterleri reddedilir.

> `VITE_` ile başlayan değişkenler **derleme anında** pakete gömülür. Ekledikten
> sonra **redeploy** gerekir, yoksa eski değer canlıda kalır.

### 3. Deploy

`main`'e push → Vercel otomatik alır.

### 4. Webhook kaydı

Telegram'a "bu botun mesajlarını şu adrese yolla" demek. **Tek seferlik.**
Sürekli çalışan bir şey değil; yaptıktan sonra bilgisayarını kapatabilirsin.

```bash
node scripts/telegram-webhook.mjs set https://<adres>/api/telegram
```

Ya da tarayıcıdan:

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<adres>/api/telegram&secret_token=<SECRET>
```

`{"ok":true,...,"description":"Webhook was set"}` görmelisin.

Durumu görmek için: `node scripts/telegram-webhook.mjs info`

### 5. Veritabanı

Migration'lar `supabase/migrations/` altında, numara sırasıyla uygulanır.
Telegram için gerekenler: **047**, **048**, **049**, **116**, **117**.

---

## Sorun giderme

| Belirti | Sebep |
|---|---|
| Bot hiç cevap vermiyor | Webhook kurulu değil ya da sır eşleşmiyor. `scripts/telegram-webhook.mjs info` ile bak — Telegram son hatayı orada saklar. |
| `secret token contains illegal characters` | Sırda izinsiz karakter var. Hex üret. |
| Sırrı değiştirdim, yine olmuyor | Vercel'de env değişince **redeploy** gerekiyor. |
| "Telegram'da aç" düğmesi yok | `VITE_TELEGRAM_BOT_USERNAME` boş. Yanlış bota götürmemek için gizleniyor. |
| "Yapay zekâ kapalı" | `NVIDIA_API_KEY` yok. Bot `/yeni` ile çalışmaya devam eder. |
| "Hiç listen yok görünüyor" | `FIRA_PROJECT` hiçbir liste adıyla eşleşmedi. `/proje` ile elle seç. |
| Görev yanlış sütuna düştü | `FIRA_STATUS` o listedeki hiçbir sütun adıyla eşleşmiyor. Sütunun adını yaz ya da değişkeni sil. |
| Kod geçersiz diyor | Kod tek kullanımlık ve 15 dakikalık. Yenisini al. |
| Grupta çalışmıyor | Kasıtlı: görevler kişisel hesaba yazıldığı için yalnız özel sohbette çalışır. |
