# Ajan araçları

Bir kişinin Claude'unun Fira ile çalışırken kullandığı araçlar. Herkesin Claude'u aynı araçları kullanır; kişiye özel olan yalnız ajan anahtarıdır.

Yol haritası ve gerekçeler: `docs/ai-entegrasyon-raporu.md`. Kurallar: depo kökündeki `CLAUDE.md` ("AI devri", "Ajanlar", "Ajan anahtarı").

## Kurulum (bir kez)

1. Fira'da **Profil menüsü › Claude'um › Yeni anahtar**. Bağlantı kodunu kopyala (bir kez gösterilir).
2. Depo klasöründe: `node tools/agent/fira-agent.mjs login` ve kodu yapıştır.
3. `node tools/agent/fira-agent.mjs whoami` ajanın adını, sahibini ve ayarlarını yazar.

Gerekenler: Node 22.15 ya da üstü (canlı dinleme ve sistemdeki sertifikalar için), VPN. Fira'nın sertifikası ekibin kendi CA'sıyla imzalı; araç işletim sisteminin güvendiği sertifikaları ve varsa `public/fira-ca.crt` dosyasını kullanır.

Anahtar `~/.fira-agent/credentials.json` içinde durur (`FIRA_AGENT_HOME` ile klasör değişir), ekrana yazılmaz, depoya girmez. Oturum 15 dakikalıktır ve anahtardan yenilenir; anahtar Fira'da iptal edilince bu bilgisayar en geç 15 dakikada dışarıda kalır.

## Kuyruğu dinlemek

Claude Code oturumu açıldığında, bu bilgisayarda anahtar varsa Claude dinleyiciyi kendisi kurar (depo kuralı, `CLAUDE.md`). Elle:

```
node tools/agent/fira-agent.mjs watch
```

- İş düştüğü anda haber verir (Supabase Realtime). Bildirim kaçarsa diye kuyruğa `Claude'um › Yedek yoklama aralığı` kadar sürede bir yeniden bakar; doğruluk kaynağı her zaman tablodur.
- Aynı bağlantıyla ajanın durum kanalına girer; Claude'um ekranındaki **Dinliyor** bundan gelir ve dinleyici kapandığı anda "Bağlı değil" olur. Dakikada bir "buradayım" da der (canlı bağlantı yokken durum bundan, üç dakikalık pencereyle okunur).
- Çıktı satır satır olaydır, bir izleyiciye (Claude Code'da Monitor) bağlanır:
  - `AI_WORK_PENDING <istek>|<görev>|<başlık>`
  - `AI_WORK_CANCELLED <istek>|<görev>|<başlık>` (atama kaldırıldı ya da istek iptal edildi; süren iş bırakılır)
  - `AI_WATCH_OFFLINE <neden>` / `AI_WATCH_ONLINE`
- `--once` bir kez bakıp çıkar, `--poll-only` canlı kanalı açmaz.
- Fira'ya ulaşılamıyorsa (VPN kapalı, bilgisayar yeni uyandı) dinleyici kapanmaz: dakikada bir yeniden dener, beş dakika sürerse `AI_WATCH_OFFLINE`, bağlantı gelince `AI_WATCH_ONLINE` yazar. Anahtar reddedilirse kapanır.

## Bir isteği işlemek

| Adım | Komut |
|---|---|
| Üstlen ve tarifi oku | `fira-agent.mjs claim <istek>` |
| Kuralları oku | `fira-agent.mjs rules <görev>` |
| Görselleri ve videoları indir | `fira-agent.mjs media <görev> [klasör]` |
| Videodan kare çıkar | `qa/video-frames.mjs <video adresi> [klasör] [kare sayısı]` |
| Durumu değiştir | `fira-agent.mjs status <görev> "Devam Ediyor"` |
| Yorum yaz | `fira-agent.mjs comment <görev> <dosya.md>` |
| Teslim et | `fira-agent.mjs handover <görev> <dosya.md> [durum]` |
| İsteği kapat | `fira-agent.mjs finish <istek> done "<ne yapıldı>"` |

- `claim` yalnız bekleyen isteği alır; iptal edilmiş, başkasınca alınmış ya da görevi bitmiş isteği `SKIP <neden>` ile geri çevirir. İki dinleyici aynı işi alamaz.
- **Asıl istek çoğu zaman son yorumdadır.** `claim` görevin bütün yorumlarını ve medya adreslerini basar; açıklamadan iş çıkarma.
- **Kurallar tarifin sonundadır.** `claim` (ve `brief`, `resume`) görevin takımının ve listesinin kural sayfalarını, ardından ajan sahibinin kişisel tercihlerini basar; `rules <görev>` yalnız bunları basar. Sıra: zorunlu takım kuralları, diğer takım kuralları, liste kuralları, kişisel tercihler. Zorunlu kural kişisel tercihten önce gelir. Kuralları takım yöneticisi Takım ayarları › Ajan kuralları'ndan belirler; içerikleri sıradan Fira sayfasıdır.
- `handover` sırayla yorumu yazar, görevi taşır (varsayılan İncelemede), ajanın sahibini atar ve ajanın kendi atamasını bırakır. Yorum yazılamazsa hiçbir şey taşınmaz.
- `finish` iptal edilmiş bir isteği "bitti" yazmaz; gerçek durumu söyler.
- Dinleyici açılırken `AI_WORK_STALLED <istek>|…` yazarsa bu, önceki oturumun yarıda bıraktığı iştir (beş dakikadır kalp atışı yok). `fira-agent.mjs resume <istek>` işi canlandırır ve tarifi yeniden basar; dinleyici, canlandırılmayan işe kalp atışı göndermez.
- İş sürerken `fira-agent.mjs step <istek> "Tip denetimi ve testler"` adımı görevdeki çipe yazar ve çalıştırmanın zaman çizelgesine ekler. `status` ve `handover` kendi adımını kendisi yazar; ara adımlar için alışılmış adlar: "Tip denetimi ve testler", "Canlıya çıkış", "QA (tarayıcı)".
- Yorum dosyası Markdown'dır; tablo ve liste olduğu gibi görünür.

## Çalıştırıcı: iş başına ayrı oturum

`watch` bir sohbet oturumuna "iş var" der; işi o oturum yapar. `run` ise her iş için **ayrı, başsız** bir Claude Code oturumu açar: oturum kapalıyken de kuyruk yürür, her iş yalnız kendi bağlamını taşır.

```
node tools/agent/fira-agent.mjs run --init     # ~/.fira-agent/runner.json (kapalı, salt okunur varsayılanlarla)
node tools/agent/fira-agent.mjs run            # kalıcı: kuyruğu dinler, iş geldikçe oturum açar
node tools/agent/fira-agent.mjs run --once --request <istek> [--config <dosya>]   # tek iş
```

Ayar dosyası bu bilgisayarın sahibinindir; Fira'dan değiştirilemez:

| Alan | Anlamı | Varsayılan |
|---|---|---|
| `enabled` | Çalıştırıcı açık mı | `false` |
| `allowedTools` | Oturumun sormadan kullanabileceği araçlar (başsız oturum soramaz) | Fira araçları, `Read`, `Glob`, `Grep` |
| `permissionMode` | `default`, `acceptEdits` ya da `plan`; izinleri tümden atlayan kip **reddedilir** | `default` |
| `cwd` | Oturumların çalıştığı klasör | bu depo |
| `maxParallel`, `maxPerDay` | Aynı anda ve günde en çok kaç iş | 1, 10 |
| `maxTurns`, `maxMinutes`, `maxBudgetUsd` | İş başına tur, süre ve bütçe sınırı | 60, 45, yok |
| `maxApprovalHours` | Canlıya çıkış onayı için en çok kaç saat beklenir; dolunca iş dağıtılmadan teslim edilir | 24 |
| `passive` | Boştayken pasif iş: `enabled`, `maxPerDay`, `model`, `jobs` (aşağıda) | kapalı, 40, `haiku`, iki tür de |
| `sessionCommand` | `claude` yerine çalıştırılacak komut; yalnız çalıştırıcının kendi denemeleri için | `["claude"]` |
| `lists` | Listeye özel `allowedTools` / `permissionMode` / `cwd` / `maxTurns` / `model` (liste adı ya da kimliğiyle) | boş |

- Oturum şunu alır: kim olduğu, istek ve görev kimliği, görevin tarifi ve yorumları, kurallar, canlıya çıkış ayarı. Fira'ya bağlayıcının araçlarıyla dokunur.
- Varsayılan izinlerle oturum dosya değiştiremez ve kabuk çalıştıramaz; yalnız okuyup Fira'ya yazabilir. Kod işi için `allowedTools`'a `Edit`, `Write` ve gereken `Bash(...)` kalıpları eklenir (tercihen listeye özel).
- İş teslim edilmeden biterse (süre ya da tur sınırı, hata) istek başarısız kapanır ve nedeni göreve yorum olarak yazılır; görev olduğu gibi kalır.
- Olaylar: `AI_RUN_STARTED`, `AI_RUN_PARKED <istek>|<görev>|<başlık>|onay bekleniyor`, `AI_RUN_RESUMED <istek>|<görev>|<başlık>|<approved|rejected|expired>`, `AI_RUN_FINISHED <istek>|<görev>|<başlık>|<sonuç>|<tur>|<dakika>`, `AI_RUN_WAITING <neden>`. Sonuç isteğin kendi durumudur (`done`, `failed`, `cancelled`); oturum durdurulduysa nedeni yanında yazar: `failed (timeout)`.
- Testler: `node --test tools/agent/runner-test.mjs`.

### Sınırlar ve görünürlük

Çalıştırıcı her "buradayım" bildiriminde sınırlarını, günün sayacını ve iş almıyorsa nedenini de söyler (`agents.runner.limits`: `maxParallel`, `maxPerDay`, `maxTurns`, `maxMinutes`, `maxBudgetUsd`, `startedToday`, `running`, `waiting`). Claude'um ve ajan paneli bunu kartta gösterir; günlük sınır dolunca yeni iş üstlenilmez, istek kuyrukta bekler ve kartta uyarı çıkar. Sınırlar yalnız ayar dosyasından okunur; Fira'dan değiştirilemez.

Günün sayacı ayar dosyasının yanındaki `runner-state.json`'da durur ve bilgisayarın kendi takvim gününe göre sıfırlanır. `--config` ile verilen deneme ayarı kendi sayacını tutar.

### Oturum ne zaman durdurulur

Durdurma, oturumu ve başlattığı her şeyi (bağlayıcı süreci, kabuk) birlikte kapatır.

| Durum | Ne olur |
|---|---|
| İstek iptal edildi (atama kaldırıldı, görev kapatıldı) | Oturum saniyeler içinde durdurulur (canlı bağlantı; o yoksa 10 saniyede bir bakış). İstek `cancelled` kalır, göreve yorum yazılmaz. |
| `maxMinutes` aşıldı | Oturum durdurulur, istek `failed` kapanır, neden göreve yorum olarak yazılır. |
| Çalıştırıcı kapatıldı (Ctrl+C) | Süren oturumlar durdurulur, istekleri `failed` kapanır ("çalıştırıcı kapatıldı"); çalıştırıcı bu kayıtlar yazılana kadar bekler. |
| Oturum isteğini kendisi kapattı | Dokunulmaz, kendi bitmesi beklenir; 90 saniye içinde bitmezse durdurulur. |

Durdurulan oturum sonuç yazdıramaz; süresi saatten, tur, model, token ve araç sayıları oturum kaydından okunur (API karşılığı bilinmez, "ölçülmedi" görünür).

Oturum kimliği iş başlarken çalıştırma kaydına yazılır ve çalıştırma ayrıntısında görünür. Sahibi o bilgisayarda, çalıştırıcının klasöründe `claude --resume <kimlik>` ile oturumu açıp devam ettirebilir.

### Pasif işler: boştayken görsel okuma ve çeviri

Çalıştırıcı, süren ya da bekleyen ajan işi yokken **pasif iş** yapabilir: görevlere eklenen görselleri okur (içindeki metin, kısa anlatım, dil) ve sonucu Fira'ya yazar. Bu, bilgisayarın sahibinin kendi aboneliğiyle yaptığı bir bağıştır; iki ayrı izin gerekir:

- **Takım:** Takım ayarları › Ajan kuralları › Pasif işler › "Görsellerdeki metni çıkar" (varsayılan kapalı, takım yöneticisi açar). Kapalı takımın görselleri hiç sunulmaz.
- **Bilgisayar:** `runner.json` içinde `"passive": { "enabled": true, "maxPerDay": 40, "model": "haiku" }` (varsayılan kapalı). Yalnız bir türe izin vermek için `"jobs": ["image_text"]` ya da `["translate"]`; yazılmazsa ikisi de.

Oturum hiçbir araç kullanamaz (`--tools ""`), MCP sunucusu yoktur ve kaydı tutulmaz; görsel iletinin parçası olarak gider. Görsel başına yaklaşık 10–15 saniye ve Haiku ile yarım sentin biraz üstü (ölçüm: 13 sn, $0,006). Oturum çalıştırıcının durduğu klasörde değil, **kendi boş klasöründe** açılır: Claude Code açıldığı klasörün proje talimatlarını (`CLAUDE.md`) her çağrıya yüklüyor; çalıştırıcı bu depodan başlatıldığında aynı görsel $0,09 tuttu (15 kat). Her işin süresi ve API karşılığı sonuçla birlikte yazılır (`file_texts.ms`, `cost_usd`; 112); Claude'um kartı günün sayısını ve payını, ajan paneli dönemin toplamını gösterir.

```bash
node tools/agent/fira-agent.mjs run --passive 5      # elle: en çok 5 pasif iş yap ve çık (ajan işi almaz)
node tools/agent/fira-agent.mjs passive next         # sıradaki işi göster (üstlenir; 10 dk cevapsız kalırsa geri düşer)
```

**Çeviri (113):** takımın ayrı anahtarı var ("Açıklama ve yorumları çevir"). Kişiler okudukları dilleri Ayarlar › Dil bölümünde belirtir; bir açıklama ya da yorum, takımda o dili okumayan biri varsa onun diline çevrilir. Önce görseller, sonra metinler alınır (en yeni önce). Kurallar `translate.mjs`'te: kod, görsel, anma, bağlantı adresi, e-posta ve HTML etiketi modele gitmez (yerlerine ⟦n⟧ konur, sonra geri yazılır); yer tutucusu bozulan ya da kaynakta olmayan bağlantı taşıyan çeviri reddedilir (üç denemeden sonra bırakılır, okur orijinali görür). Okunan dilde olduğu açık olan metin (Türkçe, İngilizce, Almanca için yerel tahmin, yalnız emin olunca) model çağrılmadan "çeviri gerekmiyor" diye kapanır ve günün payını tüketmez; emin olunamayan kısa metin modele sorulur. 12 000 karakterden uzun metin çevrilmez. Ölçüm (Haiku, demo takım): üç çeviri 13–30 sn ve $0,004–0,014; "çeviri gerekmiyor" cevabı ~10 sn, $0,003.

Olaylar: `AI_PASSIVE_DONE <tür>|<dosya ya da alan → dil>|<görev>`, `AI_PASSIVE_FAILED …|<neden>`, `AI_PASSIVE_NONE translate|<n>` (n metin çağrısız kapandı), `AI_PASSIVE_WAITING günlük sınır doldu`. Sunucuya ulaşılamazsa adım `error` döner ve döngü bir sonraki kuyruk bakışına kadar durur. Okunamayan görsel en çok üç kez denenir; çok büyük (3,7 MB üstü), silinmiş ya da görsel olmayan dosya bir daha denenmez. Günün sayacı ajan işlerinin sayacından ayrıdır (`runner-state.json` `passive`); deneme de sayılır, bozuk bir görsel döngüye girmez. Taklidin `--stub-passive ok|bad|error` kipi bunu model harcamadan dener (çeviri çağrısında ayrıca `same`, `lost`, `link`; `--stub-lang`). Testler: `node --test tools/agent/passive-test.mjs tools/agent/translate-test.mjs`. `fira-agent passive next|save|fail` elle kullanım içindir ve yalnız görsel işlerini alır.

### Canlıya çıkış onayı: iş bekler, oturum aynı kalır

Başsız oturum bir kişinin cevabını oturup bekleyemez. "Onay ister" ayarlı listede (ya da ajanın kişisel ayarında) düzen şudur:

1. Oturum işi dağıtıma hazır hâle getirir, `ask_approval` ile neyin çıkacağını sorar ve **biter**; teslim etmez, isteği kapatmaz.
2. Çalıştırıcı işi **park eder**: istek açık kalır, oturumun kimliği ayar dosyasının yanındaki `runner-state.json`'a yazılır (`parked`), adım "Onay bekleniyor" olur. Park edilen iş süreç tutmaz, aynı andaki iş sınırına ve günün sayacına girmez, çalıştırıcı yeniden başlatılsa da kaybolmaz. Çalıştırıcı açıkken kalp atışı sürer (iş "yanıt vermiyor" görünmez).
3. Cevap gelince çalıştırıcı **aynı oturumu** sürdürür (`claude --resume <kimlik>`, aynı izinler, oturumun çalıştığı klasör) ve cevabı söyler:

| Cevap | Oturuma söylenen |
|---|---|
| Onaylandı | Sorduğunu canlıya çıkar, doğrula, teslim et, isteği kapat. |
| Reddedildi (notuyla) | Dağıtma; işi olduğu gibi bırak, neden çıkmadığını yazarak teslim et, isteği kapat. |
| `maxApprovalHours` içinde cevap yok | Reddedilmiş gibi: dağıtmadan teslim. |

- Cevap oturum daha çalışırken geldiyse park edilmeden, oturum biter bitmez sürdürülür.
- Park edilmiş işin isteği iptal edilirse (atama kaldırıldı) iş bırakılır; oturum açılmaz.
- Sürdürülen oturum da teslim etmeden biterse istek `failed` kapanır (ikinci kez park edilmez).
- Ölçüm iki parçanın toplamıdır (süre, tur, token, API karşılığı); araç sayıları oturum kaydının tamamından okunur. Oturum kimliği değişmez.
- Park edilmiş iş çalıştırıcınındır: çalıştırıcı kapalıyken sohbet oturumunun dinleyicisi onu "yarıda kalmış" diye bildirebilir; `resume` ile üstlenme, çalıştırıcıyı aç.

Deneme: taklidin `ask` kipi ilk çağrıda onay sorup biter, `--resume` ile çağrılınca istemdeki cevaba göre teslim eder; her çağrısını `<pids dosyası>.calls.json`'a yazar (ikinci çağrının aynı oturum kimliğiyle geldiği buradan görülür). Deneme isteğinin cevabı QA veritabanında elle işaretlenir (ajan kendi isteğini onaylayamaz).

### Durdurma yollarını denemek

`runner-stub.mjs` gerçek oturumun yerine geçen, hiçbir şeye mal olmayan bir taklittir; **yalnız deneme ayarında** `sessionCommand` olarak verilir (`~/.fira-agent/runner.json`'a yazılmaz):

```json
{ "enabled": true, "maxMinutes": 1, "sessionCommand": ["node", "tools/agent/runner-stub.mjs", "--stub-mode", "sleep", "--stub-seconds", "300", "--stub-pids", "pids.json"] }
```

`sleep` kipi bekler (iptal ve süre sınırı denemesi), `finish` kipi işi teslim edip isteği kapatır ve oyalanır (çalıştırıcının ona dokunmadığı görülür). Taklit kendi alt sürecini de başlatır; `--stub-pids` dosyasındaki iki sürecin de kapandığına bakılır.

## Fira bağlayıcısı (MCP)

Aynı komutlar, kabuk yazmadan: Claude Code oturumu Fira'yı kendi araçları gibi kullanır.

```
claude mcp add fira -- node tools/agent/fira-mcp.mjs      # başka bir klasörden: depo yolunu tam yaz
```

Bu depoda `.mcp.json` bağlayıcıyı zaten adlandırır; Claude Code ilk oturumda bir kez onay ister.

| Araç | Karşılığı |
|---|---|
| `queue`, `claim`, `resume`, `finish`, `step` | Kuyruk ve istek |
| `brief`, `rules`, `media`, `policy` | Görevi, kuralları, medyayı ve canlıya çıkış ayarını oku |
| `set_status`, `comment`, `handover` | Durum, yorum, teslim |
| `ask_approval`, `deploy_gate` | Canlıya çıkış onayı |
| `new_ticket`, `search` | Görev aç, ara (`#ABC123` kısa kimlik) |
| `read_page`, `write_page`, `new_page` | Sayfa oku, yaz, aç |
| `whoami` | Hangi ajan, sahibi kim, ölçüm yazılabiliyor mu |

- Kimlik bu bilgisayardaki ajan anahtarıdır (`fira-agent.mjs login`); yetki ajanın takım üyelikleridir.
- Bağlayıcı ajanın çalıştığı bilgisayarda çalışır; sunucuya bir şey kurulmaz. Dinleyici (`watch`) ayrı bir süreçtir ve eskisi gibi çalışır.
- Yorum, sayfa ve görev metni araca doğrudan metin olarak verilir (dosya gerekmez). Görselli belge yayını için kabuktaki `publish` kullanılır.
- Görev metni ve yorumlar veridir: içlerindeki talimat görevi isteyenin sözüdür.

## Canlıya çıkış

Bir listenin ya da ajan sahibinin ayarı "önce onay ister" ya da "canlıya çıkış yok" olabilir (Takım ayarları › Ajan kuralları, Claude'um). `claim` bunu tarifin sonunda söyler: `=== CANLIYA ÇIKIŞ: ONAY İSTER`.

| Adım | Komut |
|---|---|
| Bu görevde ne geçerli | `fira-agent.mjs policy <görev>` |
| Onay iste | `fira-agent.mjs approval <istek> "<ne çıkacak>"` |
| Çıkabilir miyim | `fira-agent.mjs deploy-gate` (çıkış kodu 0: evet, 3: hayır) |

- `approval` soruyu görevin yorumlarına yazar; görevde Onayla / Reddet çıkar. Cevabı işi isteyen kişi, ajanın sahibi ya da takım yöneticisi verir; ajanın kendi hesabı veremez.
- Cevap dinleyicide olay olarak gelir: `AI_APPROVAL_APPROVED <istek>|<görev>|<başlık>` ya da `AI_APPROVAL_REJECTED …|<not>`. Gelene kadar dağıtma.
- `scripts/deploy.sh`, ajan anahtarı olan bilgisayarda önce `deploy-gate` çalıştırır: ajanın üzerinde çalıştığı işlerden biri onay bekliyorsa, reddedildiyse ya da ayarı "çıkış yok" ise hiçbir şey yüklemeden durur.
- "Canlıya çıkış yok" olan işte değişiklik hazırlanır ve yorumla teslim edilir; dağıtım insana kalır.

## Görev ve sayfa

```
node tools/agent/fira-agent.mjs new gorev.json
node tools/agent/fira-agent.mjs page sayfa.json
node tools/agent/fira-agent.mjs publish <sayfa kimliği> belge.md [görsel klasörü] [--title "Başlık"]
```

- Görev tarifi: `{ "title": "…", "body": ["paragraf", "…"], "status": "Yapılacak", "list": "<liste adı ya da kimliği>" }`. Alt görev için `list` yerine `"parent": "<görev kimliği>"`.
- Ajanın açtığı görev ajana atanır; `"assignee": "owner"` sahibine atar, `"none"` kimseye atamaz. `status`, `claim` ve `resume` de hiç atananı olmayan göreve ajanı atar: ajanın üzerinde çalıştığı görev panoda sahipsiz görünmez.
- Sayfa tarifi: `{ "title": "…", "ticket": "<görev kimliği>", "file": "belge.md", "shots": "gorseller" }`. Yer **tek** olmalı: `ticket`, `list` (ad ya da kimlik), `folder`, `page` (alt sayfa) ya da `team` (ad ya da kimlik; takımın kökü). `file` verilirse sayfa aynı komutta yazılır (`publish` ile aynı yol; dosya ve görsel klasörü tarifin bulunduğu klasöre göre okunur); verilmezse boş sayfa açılır. Çıktının ilk satırı `PAGE <kimlik>`. Dosya yoksa sayfa da açılmaz.
- `publish` belgedeki `![…](SHOT:ad)` yer tutucularını `<klasör>/ad.png` dosyasını yükleyerek adresle değiştirir, sayfayı yazar, sonucu `belge.md.out.md` olarak bırakır ve sayfadaki metinle karşılaştırır.

## Tarayıcıyla doğrulama (`qa/`)

Görsel doğrulama kullanıcının kendi Chrome'unda **yapılmaz**. Ayrı bir Chromium penceresi açılır, kişi o pencerede **kendisi** giriş yapar (betikler şifre yazmaz, oturum enjekte etmez), betikler pencereye bağlanır.

```
cd tools/agent/qa && npm install        # bir kez; yalnız playwright-core
```

Pencere `qa-browser.mjs` ile açılır (Playwright'ın Chromium'u; profil klasörü ve Chromium yolu ilk seferde `--profile` / `--chrome` ile verilir, `~/.fira-agent/qa-browser.json`'da hatırlanır):

```
node tools/agent/qa/qa-browser.mjs start      # pencere açılır, klavyeyi önceki pencereye geri verir, arkada durur
node tools/agent/qa/qa-browser.mjs status     # çalışıyor mu, oturum açık mı, saniyede kaç kare çiziyor
node tools/agent/qa/qa-browser.mjs restart    # kapatıp yeniden açar
node tools/agent/qa/qa-browser.mjs stop       # tarayıcıya kapanmasını söyler (ada göre süreç öldürmez)
node tools/agent/qa/qa-browser.mjs start --headless   # hiç pencere yok (izlenecek bir şey de yok)
```

**Pencere izlemek içindir, ekranı almak için değil:**

- Betikler yeni sekme açmaz ve pencereyi öne getirmez: hepsi tek bir QA sekmesini yeniden kullanır (`browser.mjs` `qaTab`; kimliği `~/.fira-agent/qa-tab.json`). Tarayıcıda kişinin kendi sekmeleri varsa betikler onlara dokunmaz, arka planda kendi penceresini açar. Betik bitince sekme olduğu yerde kalır.
- Başlatırken Chromium penceresini kendisi etkinleştirir (engellenemiyor); `qa-window.ps1` klavyeyi yarım saniye içinde önde olan pencereye geri verir ve QA penceresini arkaya alır.
- Pencere başka bir pencerenin altındayken de çizer (`KEEP_DRAWING` bayrakları; yoksa Chromium örtülü pencereyi saniyede 1 kareye düşürür). **Simge durumuna küçültülmüş pencere çizmez**: küçültme, arkada bırak.
- Yakınlaştırma site başına profilde saklanır; QA penceresinde bırakılan bir yakınlaştırma sonraki kontrolün her ölçüsünü bozar. `open()` sayfa %100 değilse betiği durdurur.
- Yazmadan önce sabit bekleme değil `waitFocus(page, seçici)`: odak, alanı açan tuştan 60–700 ms sonra yerine oturuyor.

| Betik | Ne yapar |
|---|---|
| `qa/qa-prep.mjs <index özeti>` | Pencereyi yeni derlemeye geçirir, "Yenilikler" penceresini kapatır |
| `qa/qa-browser.mjs start \| status \| restart \| stop` | QA tarayıcısını açar, durumunu söyler, kapatır |
| `qa/close-extra-pages.mjs` | QA sekmesi dışındaki **bütün** sekmeleri kapatır (yeniden başlatmalarda biriken sekmeler için; kişinin o tarayıcıda kendi sekmesi varken çalıştırma) |
| `qa/del-ticket.mjs <görev>` | Adı `QA TL-<sayı>` ile başlayan deneme görevini siler; başka görevi silmez |
| `qa/browser.mjs` | Ortak yardımcılar: `attach` (QA sekmesi; öne getirmez), `open` (yakınlaştırma denetimiyle), `shot` (takılmayan ekran görüntüsü), `union`, `focusIn`, `waitFocus` |
| `qa/docshots.mjs` | Kılavuz görüntüsü yardımcıları: `docShot` (kenar çubuğunda yalnız demo takım kalır, sonra çeker), `onlyDemoTeam`, `hide`, `mask`, `unclip` |
| `qa/shot-page.mjs <sayfa> <ad> ["başlık"]` | Yayınlanan sayfayı, istenirse bir başlığa kaydırıp gösterir; yüklenemeyen görseli sayar |
| `qa/shot-ticket.mjs <görev> <ad>` | Görev penceresinin görüntüsü |
| `qa/video-frames.mjs <video adresi> [klasör] [kare]` | Yorumdaki ekran kaydından eşit aralıklı kareler (ajan videoyu izleyemez, karelerine bakar) |

### Kılavuz ekran görüntüsü tarifi

Kılavuzdaki görüntülerin tarifleri depoda: `qa/guide/` (`run.mjs` + `batch-*.mjs`; ne neyi çeker, hangi demo verisine dayanır: `qa/guide/README.md`). Arayüz değişince ilgili tarif yeniden çalıştırılır.

Kılavuz görüntülerinde yalnız demo takım ("Fira Tanıtım") görünür; başka takım ya da müşteri adı, anahtar, adres görünmez. `docshots.mjs` yalnız **çizileni** değiştirir (hiçbir şey kaydedilmez, sayfa yenilenince geri gelir):

```js
import { attach, open, union } from './browser.mjs'
import { docShot, hide, mask, unclip } from './docshots.mjs'
const { page, done } = await attach()
await open(page, '/me/agents')
await hide(page, ['[data-agent-runs]'])            // gerçek görev adları görüntüye girmesin
await mask(page, '[data-agent-key] code', 'fira_agt_••••…')
await unclip(page, '[data-agent-panel]')           // kendi içinde kayan panel tek karede
await docShot(page, 'ajan-paneli', await union(page, ['[data-agent-panel] header', '[data-agent-models]'], 14))
await done()
```

`docShot`, kenar çubuğunda takımlar görünüyorken demo takım ekranda yoksa görüntü **almaz**. Görüntüler `FIRA_QA_SHOTS` klasörüne `<ad>.png` olarak düşer; belgede `![açıklama](SHOT:ad)` ile anılır ve `publish` ya da `page` yükler.

Kurallar: deneme verisi demo takımda ("Fira Tanıtım") açılır ve iş bitince silinir; klavyeyle yazmadan önce odağın beklenen alanda olduğu kanıtlanır (`focusIn`), çünkü tek harfler Fira'da kısayoldur.

## Ölçüm

Her üstlenilen istek için Fira bir çalıştırma kaydı açar (`ai_runs`) ve kapanınca sonucu yazar; bunu veritabanı yapar, araç bir şey yapmasa da kayıt oluşur. Sayıları ajan ekler:

- `finish` Claude Code oturumu içinde çalışıyorsa o çalıştırmanın sayılarını oturum kaydından okuyup yazar: aktif süre, tur, model, token, API karşılığı, sürüm, oturum bağlantısı. Oturum dışında `--transcript <dosya>` verilir.
- `step <istek> "QA"` işin hangi adımda olduğunu yazar; `watch` süren işler için dakikada bir kalp atışı gönderir.
- `report <istek>` sayıları yeniden yollar. `usage <oturum.jsonl>` bir oturum kaydının özetini basar, `import-usage <oturum.jsonl>` geçmişi Fira'ya taşır.

Aktif süre, iki ileti arasındaki beş dakikadan uzun boşlukları saymaz (bekleme, derleme, gece). "API karşılığı" liste fiyatıyla bir kıyastır; abonelikte ödenmez. Oturum kaydının biçimi Claude Code'un iç biçimidir, sürümle değişebilir (`usage.mjs`).
