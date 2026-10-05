/**
 * Fira changelog — single source of truth for the app version and the
 * "Yenilikler" dialog. Newest release first.
 *
 * Rules:
 *  - `features` and `fixes` are separate lists.
 *  - An entry with `major: true` gets a big title + description block;
 *    everything else renders as a one-line item.
 *  - A new release goes on top here AND into package.json's "version" (APP_VERSION,
 *    src/version.ts, is read from package.json at build time; src/changelog.test.ts
 *    fails when the two differ).
 */
export interface ChangelogEntry {
  title: string
  description?: string
  major?: boolean
}

export interface ChangelogRelease {
  version: string
  date: string // YYYY-MM-DD
  summary?: string
  features: ChangelogEntry[]
  fixes: ChangelogEntry[]
}

export const CHANGELOG: ChangelogRelease[] = [
  {
    version: '0.98.0',
    date: '2026-10-02',
    summary: 'Ajanın işi sonuçla ölçülür: ilk seferde onay oranı, dönem özeti, kartta "Claude çalışıyor".',
    features: [
      {
        title: 'İlk seferde onay oranı',
        description: 'Ajan panelinde yeni bir sayı: ajanın incelemeye getirdiği işlerin kaçı geri dönmeden kapandı. Bir kez teslim edilip tamamlanan görev "ilk seferde onay", ajana yeniden verilen görev "geri döndü" sayılır; hâlâ incelemede bekleyen iş orana girmez. Panelin başındaki satır dönemi tek cümlede özetler: kaç iş incelemeye geldi, kaçı ilk seferde onaylandı, kaçı geri döndü, ne kadar çalışıldı. Aynı satırın son yedi günü Claude\'um kartında da durur.',
        major: true,
      },
      { title: 'Ajan bir görevin üzerinde çalışırken pano kartında ve liste satırında rozet: "Claude çalışıyor" ve o anki adım; iş bitince kalkar, yanıt vermeyen iş ayrı renkte görünür' },
    ],
    fixes: [],
  },
  {
    version: '0.97.1',
    date: '2026-10-02',
    summary: 'Aramada tür:çizim ve tür:whiteboard.',
    features: [
      { title: 'Arama çubuğunda tür:çizim ve tür:whiteboard: yalnız çizimleri ya da yalnız whiteboard\'ları listeler; tür:sayfa artık yalnız yazı sayfalarını getirir' },
      { title: 'Arama sonuçlarında çizim ve whiteboard kendi ikonuyla görünür (önce hepsi sayfa ikonuyla çıkıyordu)' },
    ],
    fixes: [],
  },
  {
    version: '0.97.0',
    date: '2026-10-02',
    summary: 'Whiteboard\'da ortak zamanlayıcı: tahtadaki herkes aynı geri sayımı görür.',
    features: [
      {
        title: 'Whiteboard zamanlayıcısı',
        description: 'Tahtanın sağ altındaki saat düğmesi (ya da tahta menüsündeki "Zamanlayıcı") bir geri sayım başlatır: 1, 2, 3, 5, 10, 15 dakika tek tıkla, başka bir süre artı ve eksi ile. Geri sayım tahtanın altında, ortada durur ve tahtadaki herkeste aynıdır; sonradan açan da kalan süreyi görür. Duraklatılabilir, bir dakika eklenebilir, kapatılabilir. Süre dolunca "Süre doldu" yazar ve kısa bir ses çalar; sesi yalnız kendin için kapatabilirsin.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.96.1',
    date: '2026-10-02',
    summary: 'Koyu temada bağlantılar okunur renkte; odak ve seçim çerçeveleri görünür.',
    features: [],
    fixes: [
      { title: 'Koyu temada "Tekrar ekle", "Kişi ata", "Orijinali göster" gibi bağlantılar koyu zeminde soluk kalıyordu; artık açık tonla çizilir' },
      { title: 'Yorum kutusu, hızlı ekleme, komut paleti ve renk seçicide odak ve seçim çerçevesi çizilmiyordu (marka renginin iki tonu tanımsızdı)' },
    ],
  },
  {
    version: '0.96.0',
    date: '2026-10-02',
    summary: 'Okumadığın dilde yazılan açıklama ve yorumlar senin diline çevrilir (takım açarsa).',
    features: [
      {
        title: 'Açıklama ve yorum çevirisi',
        description: 'Ayarlar › Dil bölümünde okuduğun dilleri ve çevirinin dilini seçersin. Bu dillerden birinde olmayan görev açıklamaları ve yorumlar senin için çevrilir: çeviriyi görürsün, altındaki "Orijinali göster" ile yazılanın kendisine dönersin. Çeviri "yapay zekâ çevirdi" diye işaretlenir ve yanılabilir; kod, bağlantı ve anmalar çevrilmez, metin değişince eski çeviri gösterilmez. Varsayılan kapalıdır: takım yöneticisi Takım ayarları › Ajan kuralları › Pasif işler bölümünden açar ve işi, çalıştırıcısında pasif işlere izin vermiş bir üyenin ajanı boştayken yapar.',
        major: true,
      },
      { title: 'Ajan panelinin dipnotu çevrilen metinleri de sayar' },
    ],
    fixes: [
      { title: 'Pasif işlere ulaşılamadığında (sunucu, ağ) çalıştırıcı üç saniyede bir yeniden denemez; kuyruğa bir sonraki bakışını bekler' },
    ],
  },
  {
    version: '0.95.1',
    date: '2026-10-02',
    summary: 'Pasif işler Claude\'um kartında ve ajan panelinde görünür.',
    features: [
      { title: 'Ajan bir çalıştırıcıyla dinliyorsa kartında pasif işlerin durumu da yazar: o bilgisayarda açık mı, bugün kaç görsel okundu, günün payı kaç' },
      { title: 'Ajan panelinin altında dönemin pasif işleri ayrı bir satırda: kaç görsel okundu, ne kadar sürdü, API karşılığı (ajan işlerinin sayılarına girmez)' },
    ],
    fixes: [
      { title: 'Pasif iş kendi boş klasöründe açılır: çalıştırıcının durduğu projenin talimat dosyası her görselle birlikte modele gidiyordu, görsel başına maliyet 15 kat fazlaydı' },
    ],
  },
  {
    version: '0.95.0',
    date: '2026-10-02',
    summary: 'Görsellerdeki metin okunur, önizlemede görünür, aramada bulunur (takım açarsa).',
    features: [
      {
        title: 'Görsellerdeki metin',
        description: 'Görevlere eklenen görseller okunabilir: içinde yazan metin ve görselin ne gösterdiğine dair kısa bir anlatım dosyanın yanında saklanır. Dosya önizlemesinde üstteki "Metin" düğmesi bu metni yanda açar ve kopyalatır; komut paleti görseldeki kelimelerle de görevi bulur. Varsayılan kapalıdır: takım yöneticisi Takım ayarları › Ajan kuralları › Pasif işler altından açar. İşi, pasif işlere izin vermiş bir takım üyesinin ajanı boştayken yapar; sonuç "yapay zekâ çıkardı" diye işaretlenir ve yanılabilir.',
        major: true,
      },
      { title: 'Ajan bir görevi üstlenirken görsellerde yazanı da okur (görseli indirmeden içeriğini bilir)' },
    ],
    fixes: [],
  },
  {
    version: '0.94.1',
    date: '2026-10-02',
    summary: 'Panodan açılan görevde görsel seçili görünmüyor.',
    features: [],
    fixes: [
      { title: 'Açıklaması bir görselle biten görev panodan açılınca görsel mavi çerçeve ve boyut çubuğuyla, seçilmiş gibi çiziliyordu; artık yalnız tıkladığında seçilir' },
      { title: 'Görselin seçim çerçevesi ve boyut çubuğu editör odaktayken çizilir; editörden çıkınca kaybolur' },
    ],
  },
  {
    version: '0.94.0',
    date: '2026-10-02',
    summary: 'İkon geçişi tamamlandı: bütün uygulama tek sette.',
    features: [
      {
        title: 'Bütün ikonlar tek setten',
        description: 'Sayfalar, çizim ve whiteboard ekranının çerçevesi, gelen kutusu, ayarlar, takım ayarları, ajan ekranları, kısayol listesi ve sürüm notları da yeni ikon setine geçti. Uygulamada artık eski ikon kalmadı: gördüğün her ikon Ayarlar › Görünüm › İkonlar bölümünde seçtiğin setten (Kalın ya da İnce) çiziliyor. Durum halkası, öncelik bayrağı ve whiteboard araçları ikon değil, kendi çizimleri olarak kaldı.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.93.1',
    date: '2026-10-02',
    summary: 'Windows bildirimlerindeki simge artık net.',
    features: [],
    fixes: [
      { title: 'Windows bildirimi ilk çıktığında avatar ve harfler tırtıklı görünüyordu: simge büyük çizilip Windows tarafından kabaca küçültülüyordu; artık gösterildiği boyutta çiziliyor' },
    ],
  },
  {
    version: '0.93.0',
    date: '2026-10-02',
    summary: 'Yeni ikonlar: görev penceresi ve editör.',
    features: [
      { title: 'Görev penceresi (başlık çubuğu, özellikler, bölümler, dosyalar, etkinlik akışı) ve editörün araç çubuğu yeni ikon setine geçti' },
      { title: 'Editör araç çubuğundaki 23 özel çizim de artık seçtiğin setten geliyor' },
    ],
    fixes: [],
  },
  {
    version: '0.92.0',
    date: '2026-10-02',
    summary: 'Yeni ikonlar: pano kartları ve liste görünümü.',
    features: [
      { title: 'Pano kartları, sütun başlıkları, liste görünümü, liste araç çubuğu, hızlı ekleme satırı ve toplu işlem çubuğu yeni ikon setine geçti' },
      { title: 'Kart ve satırdaki küçük göstergeler (açıklama, dosya, yorum, engel) 14 yerine 16 piksel' },
    ],
    fixes: [
      { title: 'Profil menüsündeki "Çıkış yap" satırı kırmızı olması gerekirken gri görünüyordu' },
    ],
  },
  {
    version: '0.91.0',
    date: '2026-10-02',
    summary: 'Yeni ikonlar: üst çubuk, filtre, komut paleti, profil menüsü, afişler ve giriş ekranı.',
    features: [
      { title: 'Üst çubuk, liste başlığı, filtre menüsü, komut paleti, profil menüsü, bildirim kartları, afişler ve giriş ekranı da yeni ikon setine geçti (Ayarlar › Görünüm › İkonlar: Kalın ya da İnce)' },
      { title: 'İnce ikon seti artık yalnız onu seçenlerde indiriliyor; uygulamanın ilk açılışı herkes için hafifledi' },
    ],
    fixes: [],
  },
  {
    version: '0.90.7',
    date: '2026-10-02',
    summary: 'Fotoğrafı olmayan herkesin kendi rengi var.',
    features: [
      { title: 'Gelen kutusunda ve etkinlik panelinde fotoğrafı olmayan kişiler artık kendi renkleriyle görünür (hepsi aynı mavi tondaydı)' },
      { title: 'Kişi renkleri 6 yerine 12 ton ve gördüğün kişilere sırayla dağıtılır: 12 kişiye kadar herkes farklı renktedir; renk avatarda, gelen kutusunda ve bildirim simgesinde aynıdır' },
    ],
    fixes: [],
  },
  {
    version: '0.90.6',
    date: '2026-10-02',
    summary: 'Claude\'um ve ajan paneli çalıştırıcının sınırlarını gösterir.',
    features: [
      { title: 'Ajan bir çalıştırıcıyla dinliyorsa kartında sınırları yazar: bugün kaç iş üstlendi, aynı anda kaç iş, iş başına tur ve süre; günlük sınır dolunca nedeniyle birlikte uyarı görünür' },
      { title: 'Ajan panelindeki kart da ajanın sohbet oturumuyla mı çalıştırıcıyla mı dinlediğini söyler' },
    ],
    fixes: [],
  },
  {
    version: '0.90.5',
    date: '2026-10-02',
    summary: 'Çalıştırma ayrıntısında oturum kimliği.',
    features: [
      { title: 'Çalıştırma ayrıntısında oturum kimliği görünür; çalıştırıcının açtığı oturumlar için onu o bilgisayarda devam ettiren komut da yazar ve kopyalanabilir' },
    ],
    fixes: [],
  },
  {
    version: '0.90.4',
    date: '2026-10-02',
    summary: 'Görseller yalnız sol tıkla açılır.',
    features: [],
    fixes: [
      { title: 'Editördeki görsel sağ tıkla, tekerlek tuşuyla ve farenin yan tuşlarıyla da büyüyordu; artık yalnız sol tıkla açılır (sağ tık menüsü görselin üstünde açılır)' },
    ],
  },
  {
    version: '0.90.3',
    date: '2026-10-02',
    summary: 'Görev penceresinde akış varsayılan olarak yorumları gösterir.',
    features: [
      { title: 'Etkinlik ve yorumlar başlığındaki seçim "Yorumlar / Tümü" sırasına geçti ve varsayılan artık Yorumlar; değişiklik geçmişi için "Tümü"ne bas, seçimin hesabında saklanır' },
    ],
    fixes: [],
  },
  {
    version: '0.90.2',
    date: '2026-10-02',
    summary: 'Açılır pencereler üst üste binmiyor: biri açılınca diğeri kapanır.',
    features: [],
    fixes: [
      { title: 'Listede art arda farklı satırların atama düğmesine basınca atama pencereleri üst üste açılıyordu; artık yeni açılan öncekini kapatır' },
      { title: 'Aynı kural bütün küçük pencerelerde: atama, durum, öncelik, tarih, filtre, bağlantı seçici, profil menüsü, sağ tık menüsü' },
    ],
  },
  {
    version: '0.90.1',
    date: '2026-10-02',
    summary: 'Sol panel varsayılan olarak beşte bir daha geniş.',
    features: [
      { title: 'Sol panelin varsayılan genişliği 256 pikselden 308 piksele çıktı (%20); kendi sürüklediğin genişlik aynen duruyor' },
    ],
    fixes: [],
  },
  {
    version: '0.90.0',
    date: '2026-10-02',
    summary: 'Üst çubukta geri ve ileri düğmeleri.',
    features: [
      {
        title: 'Geri ve ileri düğmeleri',
        description: 'Arama kutusunun solunda iki ok: geri ve ileri (Teams ve VS Code\'daki gibi). Kısayolları Alt+← ve Alt+→. Düğmeler, kısayollar, tarayıcının kendi düğmeleri, farenin yan tuşları ve dokunmatik yüzeydeki kaydırma hareketi aynı geçmişte yürür; geri her zaman daha genel ekrana ya da bir önceki ekrana götürür. Gidilecek yer yoksa düğme soluk görünür.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.89.0',
    date: '2026-10-02',
    summary: 'İkon seti artık senin seçimin: kalın ya da ince.',
    features: [
      {
        title: 'İkon seti seçimi',
        description: 'Ayarlar › Görünüm › İkonlar: "Kalın" (kalın çizgi, küçük boyutta kolay seçilir) ya da "İnce" (ince çizgi, daha ayrıntılı). Varsayılan Kalın. Seçim bu tarayıcıda saklanır ve anında uygulanır. Şimdilik kenar çubuğundaki ikonlar bu sete bağlı; uygulamanın geri kalanı sırayla geçecek.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.88.0',
    date: '2026-10-02',
    summary: 'Geri tuşu artık yönü bilir: özelden genele gider.',
    features: [
      {
        title: 'Geri tuşu genele doğru gider',
        description: 'Genelden özele gitmek ileri, özelden genele gitmek geridir; yön hangi sırayla gezdiğine bağlı değildir. Bir görevden alt görevine geçtiysen geri tuşu seni üst göreve döndürür, pencereyi tümden kapatmaz. Alt görevden "üst görev" bağlantısıyla yukarı çıkarsan alt görev geride kalmaz: bir sonraki geri seni panoya götürür. Bildirimden açtığın bir sayfadan üst görevine çıkarsan geri tuşu o sayfaya değil, bildirimi açmadan önceki ekranına döner. ✕ ve Esc görev penceresini yine tek seferde kapatır. Aynı kural bütün ekranlarda geçerli: zaten geçmişte olan bir ekrana gidince yeni kayıt açılmaz, oraya geri dönülür.',
        major: true,
      },
    ],
    fixes: [
      { title: 'İki ekran arasında gidip gelince geçmiş şişmiyor; geri tuşu aynı iki ekran arasında dönüp durmuyor' },
    ],
  },
  {
    version: '0.87.0',
    date: '2026-10-02',
    summary: 'Kenar çubuğunda yeni, okunaklı ikonlar.',
    features: [
      {
        title: 'Kenar çubuğunda yeni ikon seti',
        description: 'Şerit, panel, ağaç ve satır menülerindeki ikonlar değişti. Eskiler 24 piksel için çizilmiş, 12–14 piksele küçültülmüş çizgilerdi: çizgiler piksellerin arasına düşüp bulanıyor, ayrıntı kapanıyordu. Yenileri gösterildikleri boyut için (16 ve 20 piksel) çizilmiş; ağaçtaki ikonlar 14 yerine 16 piksel ve soluklaştırılmadan, yazıyla aynı renkte. Liste ve klasörlere seçtiğin işaretler aynı kaldı, yalnız çizimleri yenilendi. Uygulamanın geri kalanı sırayla aynı sete geçecek.',
        major: true,
      },
    ],
    fixes: [
      { title: 'Ağaçtaki liste işareti 12 pikseldi, seçilen şekil okunmuyordu: 16 piksel' },
    ],
  },
  {
    version: '0.86.1',
    date: '2026-10-02',
    summary: 'Ayarlar: Temalar sekmesi sadeleşti, Görünüm ve Beta özellikler ayrı sekme oldu.',
    features: [
      { title: 'Ayarlar › Temalar artık yalnız renkler: açık / koyu / otomatik ve renk paleti' },
      { title: 'Yeni sekme "Görünüm": yazı boyutu, yoğunluk, görev penceresi, bitirme kutlaması, kod bloklarında satır numarası' },
      { title: 'Yeni sekme "Beta özellikler": yeni kabuk, çizim ve whiteboard anahtarları tek yerde' },
      { title: 'Komut paletinde "Ayarlar: Görünüm" ve "Ayarlar: Beta özellikler"' },
    ],
    fixes: [],
  },
  {
    version: '0.86.0',
    date: '2026-10-02',
    summary: 'Fira bağlayıcısı: Claude Code, Fira\'yı araç olarak kullanır.',
    features: [
      {
        title: 'Fira bağlayıcısı (MCP)',
        description: 'Claude Code oturumu Fira\'yı kendi araçları gibi kullanır: kuyruğu okur, görevi üstlenir, görevi ve kuralları okur, durum değiştirir, yorum yazar, teslim eder, görev ve sayfa açar, arar. Kabuk komutu gerekmez. Kimlik ajan anahtarıdır, yetki ajanın takım üyeliğidir. Bağlayıcı ajanın çalıştığı bilgisayarda çalışır; sunucuya bir şey kurulmaz. Kurulum komutu Ayarlar › Claude\'um › Kurulum bölümünde.',
        major: true,
      },
      { title: 'Bağlayıcı üzerinden üstlenilen işlerin süresi ve tokeni de ölçülür' },
    ],
    fixes: [],
  },
  {
    version: '0.85.0',
    date: '2026-10-02',
    summary: 'Canlıya çıkış onayı: ajanın işini kendisinin mi çıkaracağı, onay mı isteyeceği liste ve kişi düzeyinde ayarlanır.',
    features: [
      {
        title: 'Canlıya çıkış ayarı',
        description: 'Üç seçenek var: ajan kendisi çıkar (bugüne kadarki davranış), önce onay ister, canlıya çıkış yok. Liste için Takım ayarları › Ajan kuralları\'nda takım yöneticisi, kişi için Ayarlar › Claude\'um\'da ajanın sahibi ayarlar; ikisinden sıkı olan geçerlidir.',
        major: true,
      },
      {
        title: 'Görevde onay',
        description: 'Ayar "önce onay ister" ise ajan neyin canlıya çıkacağını yazar ve bekler. Görevde "Canlıya çıkış onayı bekliyor" kutusu çıkar; işi isteyen kişi, ajanın sahibi ya da takım yöneticisi Onayla ya da Reddet der (ret için not yazılabilir). Ajan cevabı anında öğrenir. Soru da cevap da görevin yorumlarına düşer. Ajan kendi isteğini onaylayamaz.',
        major: true,
      },
      { title: 'Onay gelmeden dağıtım betiği çalışmaz: ajanın üzerinde çalıştığı iş onay bekliyorsa ya da listesinde canlıya çıkış yoksa dağıtım reddedilir' },
    ],
    fixes: [],
  },
  {
    version: '0.84.0',
    date: '2026-10-02',
    summary: 'Çalıştırma ayrıntısında "Uyulan kurallar": ajan o işte hangi kural sayfalarını okudu, sonradan değişti mi.',
    features: [
      {
        title: 'Uyulan kurallar',
        description: 'Ajan panelinde bir çalıştırmanın ayrıntısında yeni kutu: iş üstlenilirken okunan kural sayfaları (takım ya da liste, zorunlu mu, okunan sürümün zamanı). Kural sayfası o günden sonra değiştirildiyse "Sonradan değişti", silindiyse "Sayfa artık yok" yazar; sayfanın adına tıklayınca sayfa açılır. Ajan sahibinin kişisel tercihleri okunduysa o da belirtilir.',
        major: true,
      },
      { title: 'Kayıt 2 Ekim 2026\'dan itibaren tutuluyor; daha eski çalıştırmalarda kutu bunu söyler' },
    ],
    fixes: [],
  },
  {
    version: '0.83.0',
    date: '2026-10-02',
    summary: 'Ajan kuralları: takımın ve listenin kuralları Fira sayfası olarak yazılır, ajan işe başlarken okur.',
    features: [
      {
        title: 'Ajan kuralları',
        description: 'Takım ayarlarında yeni "Ajan kuralları" sekmesi: takımın ajanlarının bir işe başlamadan önce okuyacağı sayfaları seçersin. Takım kuralları bütün listelerde, liste kuralları yalnız o listenin görevlerinde geçerlidir. Kural sıradan bir Fira sayfasıdır; takımdaki herkes okur ve düzenler, eski sürümleri saklanır. Hangi sayfaların kural olduğunu ve hangisinin zorunlu olduğunu takım yöneticisi belirler.',
        major: true,
      },
      {
        title: 'Kişisel tercihler',
        description: 'Ayarlar › Claude\'um ekranında ajanının her işte aklında tutmasını istediklerini yazabilirsin (üslup, diller, çalışma biçimi). Yalnız senin ajanını etkiler; takımın zorunlu bir kuralıyla çelişirse takım kuralı geçerlidir.',
        major: true,
      },
      { title: 'Ajan bir işi üstlenirken kuralları sırayla görür: zorunlu takım kuralları, diğer takım kuralları, liste kuralları, kişisel tercihler; her sayfanın son değişiklik zamanıyla' },
    ],
    fixes: [],
  },
  {
    version: '0.82.1',
    date: '2026-10-02',
    summary: 'Soldaki şeritte Takımlar ve Ana sayfa tıklanır tıklanmaz açılıyor; logolar bir kez iniyor.',
    features: [],
    fixes: [
      {
        title: 'Takımlar paneli beklemeden açılıyor',
        description: 'Şeritte Takımlar ya da Ana sayfa\'ya tıklayınca düğme, panel başlığı ve bir iskelet hemen görünür; ağaç arkasından dolar. Önce bütün takımların ağacı kurulmadan ekranda hiçbir şey değişmiyordu, takımı çok olan kişide düğme takılmış gibi duruyordu. Panelin içeriği ayrıca gereksiz yere iki kez kuruluyordu (bir de görünmeyen telefon çekmecesinde); artık bir kez kuruluyor.',
        major: true,
      },
      { title: 'Liste ve müşteri logoları tarayıcıda bir yıl saklanıyor: önce saatte bir yeniden isteniyor, küçük resmin her biri yaklaşık 300 ms sürüyordu' },
    ],
  },
  {
    version: '0.82.0',
    date: '2026-10-02',
    summary: 'Ajan paneline görünür giriş, takıma göre görünüm, tarih aralığı ve telefonda okunur liste.',
    features: [
      {
        title: 'Ajan paneline görünür giriş',
        description: 'Panele artık komut paletini bilmeden ulaşılır: Ana sayfa panelinin altında "Ajan paneli" satırı (görebildiğin bir ajan varsa) ve her takımın menüsünde "Ajan paneli". Takım menüsünden açınca panel o takımın çalıştırmalarını ve o takımda çalışan ajanları gösterir; başlıktaki ✕ bütün takımlara döner.',
        major: true,
      },
      { title: 'Ajan panelinde tarih aralığı: dönem seçicide "Aralık" başlangıç ve bitiş günü sorar; iki gün de dahildir' },
      { title: 'Ajan paneli telefonda: çalıştırmalar dokuz sütunlu tablo yerine okunur bir liste olarak gelir, satıra dokununca ayrıntı açılır' },
    ],
    fixes: [],
  },
  {
    version: '0.81.4',
    date: '2026-10-02',
    summary: 'Fira\'dan kopyalanan metin başka bir uygulamaya arka plan ve renk taşımıyor.',
    features: [],
    fixes: [
      {
        title: 'Kopyalanan metinde arka plan kalmıyor',
        description: 'Bir yorumdan, okunan bir sayfadan ya da ekrandaki herhangi bir metinden kopyalayıp e-postaya, Word\'e ya da Teams\'e yapıştırınca metin Fira\'nın arka planını, yazı rengini ve yazı tipini de götürüyordu (koyu temada koyu bir kutu). Artık yalnız içerik ve biçimi gider: paragraf, başlık, liste, tablo, kod, bağlantı, kalın ve eğik. Editörün içinden yapılan kopya zaten böyleydi.',
        major: true,
      },
      { title: 'Okuma görünümündeki kod kutusundan kopyalarken çubuktaki dil adı, satır sayısı ve "Kopyala" yazısı metne karışmıyor' },
    ],
  },
  {
    version: '0.81.3',
    date: '2026-10-02',
    summary: 'Ajanın durumu her ekranda aynı: çalışırken Claude\'um da "Çalışıyor" der.',
    features: [],
    fixes: [
      { title: 'Ajan bir iş üzerindeyken Ayarlar › Claude\'um "Dinliyor", ajan paneli "Çalışıyor" gösteriyordu; iki ekran artık aynı kuralı ve aynı rozeti kullanıyor (Bağlı değil, Dinliyor, Çalışıyor)' },
    ],
  },
  {
    version: '0.81.2',
    date: '2026-10-02',
    summary: 'Gelen kutusu, içinden bir şey açınca ya da şeritte başka bir menüye geçince kendiliğinden kapanıyor.',
    features: [
      { title: 'Gelen kutusundan ana ekranda bir şey açınca (görev, sürüm notları, yorumdaki bir bağlantı) gelen kutusu kapanır; görevi kapattığında kaldığın ekrandasın' },
      { title: 'Gelen kutusu açıkken soldaki şeritte Ana sayfa ya da Takımlar\'a tıklamak gelen kutusunu kapatıp o paneli gösterir' },
    ],
    fixes: [],
  },
  {
    version: '0.81.1',
    date: '2026-10-02',
    summary: 'Çalıştırma ayrıntısı: pencerenin üstünde kalan açık şerit giderildi, süren iş doğru anlatılıyor.',
    features: [],
    fixes: [
      { title: 'Ajan panelinde çalıştırma ayrıntısı açıldığında arkadaki karartma 16 piksel aşağıdan başlıyor, üst kenarda açık bir şerit kalıyordu; karartma artık pencerenin tamamını kaplıyor' },
      { title: 'Süren bir işin ayrıntısında "ölçülmedi: yalnız kuyruk kaydı var" yazıyordu; artık "iş bitince ölçülür" diyor, araç kullanımı, oturum, sonuç ve ölçüm kaynağı satırları da işin sürdüğünü söylüyor' },
    ],
  },
  {
    version: '0.81.0',
    date: '2026-10-02',
    summary: 'Yeni sürüm artık işin ortasında pencere açmıyor: yenilikler gelen kutusuna düşüyor, bekleyen sürüm için üst çubukta Güncelle düğmesi var.',
    features: [
      {
        title: 'Yenilikler gelen kutusunda',
        description: 'Fira güncellendiğinde sürüm notları kendiliğinden açılmaz. Gelen kutusuna okunmamış bir satır düşer; satıra tıklayınca yeni sürümün özellikleri ve düzeltmeleri gelen kutusunun içinde listelenir, altındaki "Tüm sürüm notları" düğmesi bütün geçmişi açar. Açmadığın satır sonraki sürümleri de üstüne alır: bir hafta uzak kalsan da tek satır görürsün.',
        major: true,
      },
      {
        title: 'Güncelle düğmesi',
        description: 'Yeni bir sürüm hazır olduğunda üst çubukta, profil resminin yanında "Güncelle" düğmesi belirir; tıklayınca sayfa yeni sürümle açılır. Ekranın altındaki "Yeni sürüm hazır" çubuğu ve açıklaması kaldırıldı.',
        major: true,
      },
      { title: 'Sürüm satırı okundu bilgisini hesabında tutar: bir cihazda okuduğun satır diğerinde de okunmuş görünür' },
    ],
    fixes: [],
  },
  {
    version: '0.80.0',
    date: '2026-10-02',
    summary: 'Ajan panelinde çalıştırma ayrıntısı: zaman çizelgesi, araç kullanımı, oturum.',
    features: [
      {
        title: 'Çalıştırma ayrıntısı',
        description: 'Ajan panelindeki bir çalıştırmaya tıklayınca ayrıntısı açılır: işin adımları gerçekleştiği anla ve süresiyle (istendi, üstlenildi, Devam Ediyor, test, QA, teslim, kapandı), hangi aracın kaç kez çağrıldığı, Claude oturumunun bağlantısı, çıkan sürüm ve ölçümün kaynağı.',
        major: true,
      },
      { title: 'Ajan çalışırken adımlarını kendiliğinden bildirir: görevin durumunu değiştirmek ve teslim etmek birer adım olarak kaydedilir; ara adımlar (test, canlıya çıkış, QA) ajan tarafından adlandırılır' },
      { title: '15 Eylül\'den beri oturum kaydı bulunan 95 çalıştırmaya araç kullanımı işlendi. Adım kaydı bugünden itibaren tutuluyor; eski çalıştırmalarda yalnız başlangıç ve bitiş görünür' },
    ],
    fixes: [],
  },
  {
    version: '0.79.1',
    date: '2026-10-02',
    summary: 'Yarıda kalan iş artık görünüyor ve ajan dönünce kaldığı yerden sürüyor.',
    features: [
      { title: 'Görevdeki "Claude çalışıyor" çipi, ajan bildirdiğinde o anki adımı da gösterir ("test", "QA")' },
      { title: "Takımda birden çok ajan varsa \"Claude'a yaptır\" düğmesi görevi senin ajanına devreder; ajanın yoksa takımdaki ilk ajana" },
    ],
    fixes: [
      { title: 'İş sürerken ajanın dinleyicisi kapanırsa görevde süresiz "Claude çalışıyor" yazıyordu. Beş dakika ses gelmeyince çip "Claude yanıt vermiyor" olur; ajan panelinde de çalıştırma "Yanıt vermiyor" görünür' },
      { title: 'Yarıda kalan iş kaybolmuyor: ajan yeniden bağlandığında iş kendisine yeniden bildirilir ve kaldığı yerden sürer. Beklemek istemeyen İptal ile durdurabilir' },
    ],
  },
  {
    version: '0.79.0',
    date: '2026-10-02',
    summary: "Herkes kendi Claude'unu bağlayabiliyor: ajan oluşturma ve kurulum adımları.",
    features: [
      {
        title: "Claude'unu bağla",
        description: "Profil menüsü › Claude'um artık herkese açık. Ajanı olmayan kişi buradan kendi ajanını oluşturur: bir ad verir, ajanın hangi takımlarda çalışacağını seçer. Ajan yalnız sahibinin üyesi olduğu takımlara eklenebilir ve oradaki yetkisi sahibininkini aşamaz; sahibi takımdan çıkarsa ajan da çıkar.",
        major: true,
      },
      { title: "Kurulum adımları: ajan kimliği, bağlantı anahtarı, dinleyicinin başlaması ve deneme görevi. Her adım gerçek duruma göre işaretlenir; dördü de tamamlanınca liste tek satıra katlanır" },
      { title: "Claude'um › Takımlar: ajanın hangi takımlarda çalıştığı görünür, sahibi değiştirebilir" },
      { title: "Takım ayarları › Üyeler: ajanların yanında e-posta yerine kimin adına çalıştığı yazar; takım sahipliği bir ajana devredilemez" },
      { title: 'Komut paleti: "Ayarlar: Claude\'um"' },
    ],
    fixes: [],
  },
  {
    version: '0.78.1',
    date: '2026-10-02',
    summary: "Claude'un \"Dinliyor\" durumu artık anında değişiyor.",
    features: [],
    fixes: [
      { title: "Claude'un dinleyicisi kapatıldığında Claude'um ve ajan paneli üç dakikaya kadar \"Dinliyor\" göstermeye devam ediyordu. Durum artık dinleyici kapandığı anda \"Bağlı değil\"e, yeniden açıldığı anda \"Dinliyor\"a dönüyor; ekranı yenilemek gerekmiyor" },
      { title: "\"Bağlı değil\" durumundaki ajanın kartında \"kuyruğu canlı dinliyor\" yazmaya devam ediyordu; ajan bağlı değilken yalnız çalıştığı yer gösteriliyor. Yarıda kalmış bir işi olan ama bağlı olmayan ajan panelde \"Çalışıyor\" görünmüyor" },
    ],
  },
  {
    version: '0.78.0',
    date: '2026-10-01',
    summary: 'Ajan paneli: Claude hangi görevde ne kadar çalıştı, ne tüketti.',
    features: [
      {
        title: 'Ajan paneli',
        description: "Yeni ekran: tamamlanan görev sayısı, aktif çalışma süresi, üretilen çıktı ve API karşılığı; her ajanın kartı (sahibi, şimdiki işi, nerede çalıştığı, modeli, tetiklemesi); gün başına görev ve aktif dakika grafikleri; model dağılımı ve çalıştırma listesi. Dönem seçilebilir (bugün, 7 gün, 30 gün, tümü). Komut paletinde \"Ajan paneli\", Claude'um ekranında \"Çalıştırmaları gör\", yöneticiler için Yönetim › Ajanlar.",
        major: true,
      },
      { title: 'Her çalıştırmanın kaydı tutuluyor: gerçek başlangıç ve bitiş, aktif süre, tur, model, token, API karşılığı, çıkan sürüm. Görev silinse de ölçüm kalır' },
      { title: '8 Eylül\'den beri yapılan işler panele aktarıldı: 93 işin süre ve token ölçümü oturum kayıtlarından, 102 işin yalnız açılış ve kapanış zamanı kuyruktan' },
      { title: 'Kimin neyi gördüğü: takım üyeleri kendi takımlarının çalıştırmalarını, ajanın sahibi kendi ajanınınkileri, sistem yöneticisi hepsini görür' },
    ],
    fixes: [],
  },
  {
    version: '0.77.0',
    date: '2026-10-01',
    summary: 'Claude kuyruğu canlı dinliyor: atanan iş saniyeler içinde başlıyor.',
    features: [
      {
        title: 'Canlı dinleme',
        description: "Ajan artık kuyruğu canlı dinliyor: görev atandığında ya da \"Claude'a yaptır\" dendiğinde haberi saniyeler içinde alıyor, atama kaldırılınca iptali de aynı hızla öğreniyor. Eskiden kuyruğa dakikada bir bakılıyordu. Canlı bildirim kaçarsa diye kuyruğa ayarlanan aralıkla yeniden bakılıyor.",
        major: true,
      },
      { title: "Claude'um: \"Kuyruğa bakma aralığı\" artık \"Yedek yoklama aralığı\"; ajan dakikada bir \"buradayım\" dediği için \"Dinliyor\" göstergesi aralıktan bağımsız ve üç dakikada güncel" },
      { title: 'Ajan aracı (tools/agent/fira-agent.mjs) işin tamamını kapsıyor: dinleme, üstlenme, yorum, durum, atama, teslim, görev açma ve sayfa yayını. Yorumlar Markdown olarak yazılıyor; tablo ve liste olduğu gibi görünüyor' },
    ],
    fixes: [],
  },
  {
    version: '0.76.0',
    date: '2026-10-01',
    summary: 'Ajan anahtarı: Claude Fira\'ya kendi anahtarıyla bağlanıyor.',
    features: [
      {
        title: 'Ajan anahtarı',
        description: "Ayarlar › Claude'um ekranında ajanın sahibi anahtar üretir. Anahtar tek bir bağlantı kodu olarak bir kez gösterilir; ajanın çalışacağı bilgisayarda tek komutla (fira-agent login) tanıtılır. Ajan bundan sonra Fira'ya kendi hesabının yetkileriyle bağlanır; sunucu erişimi ve veritabanı parolası gerekmez.",
        major: true,
      },
      { title: 'Anahtar listesi: her anahtarın adı, oluşturulma ve son kullanım zamanı. Kullanılmayan anahtar "İptal et" ile geçersiz kılınır; iptal edilen anahtarla açılmış oturum en geç 15 dakikada kapanır' },
      { title: 'Depoda yeni araç: tools/agent/fira-agent.mjs (login, whoami, queue, logout). Anahtar bilgisayarda kullanıcı klasöründe saklanır, ekrana yazılmaz' },
    ],
    fixes: [],
  },
  {
    version: '0.75.1',
    date: '2026-10-01',
    summary: 'Bildirimlerde Fira logosu yerine işlemi yapan kişinin avatarı.',
    features: [
      { title: 'Sistem bildiriminin simgesi artık işlemi yapan kişinin avatarı (fotoğrafı yoksa baş harfleri, uygulamadaki rengiyle). Başlıkta kişinin adı, altında ne yaptığı ve görevin adı yazar; hatırlatmalarda Fira simgesi kalır' },
      { title: 'Durum değişikliği bildirimde durumun kendi rengindeki noktayla yazılır. Uygulama içindeki bildirim gelen kutusu satırı gibi görünür: avatar, kalın ad ve renkli durum çipi' },
      { title: 'Ayarlar › Bildirimler › Test bildirimi yeni görünümü kendi avatarınla gösterir' },
    ],
    fixes: [],
  },
  {
    version: '0.75.0',
    date: '2026-10-01',
    summary: "Görevi Claude'a atamak işi başlatıyor; atamayı kaldırmak durduruyor.",
    features: [
      {
        title: 'Atama ile iş başlatma',
        description: "Bir görevi yapay zekâ ajanına atamak artık işi başlatır: atama anında istek kuyruğa düşer, görevde \"kuyrukta\" ve \"çalışıyor\" durumu görünür. Atamayı kaldırmak bekleyen ya da süren işi hemen durdurur. \"Claude'a yaptır\" düğmesi aynı kuyruğu kullanmaya devam eder. Tamamlanmış göreve atama, görev kopyalama ve taşıma iş başlatmaz.",
        major: true,
      },
      { title: "Ayarlar › Claude'um: ajanın sahibi için yeni sekme. Ajan bağlı mı, en son ne zaman görüldü, şu an hangi görevde, sırada ne var" },
      { title: "Claude'um › Tetikleme: \"Atanınca işe başla\" anahtarı ve kuyruğa bakma aralığı. Ayarları yalnız ajanın sahibi değiştirir" },
      { title: 'Kişi seçicide ajanın satırında "Atayınca işe başlar" ipucu; süren işte atamayı kaldırma düğmesi işin duracağını söyler' },
    ],
    fixes: [],
  },
  {
    version: '0.74.0',
    date: '2026-09-30',
    summary: 'Açılır pencerede dışına tıklamak görevi kapatmayabilir.',
    features: [
      { title: 'Ayarlar › Temalar › Görev penceresi: açılır pencere seçiliyken "Dışına tıklayınca kapat" anahtarı. Kapatılırsa görev yalnız ✕, Esc ya da Geri ile kapanır; ayar kişiseldir' },
    ],
    fixes: [],
  },
  {
    version: '0.73.1',
    date: '2026-09-30',
    summary: 'Metindeki görseller büyütülebiliyor.',
    features: [],
    fixes: [
      { title: 'Açıklama ve sayfalardaki görsel belli bir boydan sonra büyümüyordu: kutusu genişliyor, görsel ortada kalıp yanlarına boşluk alıyordu. Genişlik elle verilince yükseklik sınırı kalkıyor; küçük görseller de istenen boya büyüyor' },
    ],
  },
  {
    version: '0.73.0',
    date: '2026-09-30',
    summary: 'Tanıtım turu görev penceresini de anlatıyor.',
    features: [
      {
        title: 'Tanıtım turuna görev penceresi bölümü',
        description: 'Ana ekran turu bitince "Görev penceresine geç" ekrandaki ilk görevi açar ve pencereyi adım adım gösterir: başlık, üst satır, özellikler, Claude\'a yaptır, açıklama, alt görev ve yapılacaklar gibi bölümler, etkinlik ve yorumlar, kısayollar. Görev açıkken başlatılan tur doğrudan bu bölümle başlar; ilk görev açışında bir kez kendiliğinden de gelir.',
        major: true,
      },
      { title: 'Görev penceresinin ⋯ menüsünde "Bu pencereyi tanıt"; komut paletinde "Tanıtım turu"' },
      { title: 'Turun Yenilikler adımları, yalnız düzeltme içeren bir sürümden sonra da son yeni özellikleri gösterir' },
    ],
    fixes: [],
  },
  {
    version: '0.72.1',
    date: '2026-09-30',
    summary: 'Arama, atlanan Türkçe harflere dayanıklı.',
    features: [],
    fixes: [
      { title: 'Arama "grev" yazınca "Görev"i bulmuyordu: Türkçe harflere duyarlı mesafe — ç ğ ı ö ş ü atlanırsa yarım hata, ASCII karşılığı yazılırsa hata değil; karışık yazım da tutuyor ("grev" → görev, "skstrma" → sıkıştırma, "gncelleme" → güncelleme). 3–4 harfli kelimeler yalnız bu yoldan bulunur' },
    ],
  },
  {
    version: '0.72.0',
    date: '2026-09-30',
    summary: 'Görev bağlama çubuğu: satır boyunca, üst aramanın süzgeçleriyle, panodaki sırayla.',
    features: [
      {
        title: 'Görev bağla artık bir giriş çubuğu',
        description: 'Bağlı Görevler\'in altında, alt görev ve yapılacaklar kutusu gibi satır boyunca. Odaklanınca bu listenin görevleri panodaki sırayla (önce durum sütunu, sonra kart sırası) listelenir. Yazınca üstteki arama gibi arar: yazım hatalarına dayanıklı eşleşme, atanan:ben, oluşturan:ad, durum:açık gibi süzgeçler; liste:ad başka bir listede arar. Çubuğun sağında zorunlu ilişki türü (varsayılan İlişkili), Ekle ve Vazgeç.',
        major: true,
      },
    ],
    fixes: [
      { title: 'Dosya simgesi (ataş) küçük boyutta leke gibi görünüyordu' },
      { title: 'Ekleme listesindeki "Sayfa / Çizim / Whiteboard ekle" satırında "ekle" öncesinde fazla boşluk vardı' },
    ],
  },
  {
    version: '0.71.0',
    date: '2026-09-30',
    summary: 'Görev penceresi sadeleşti: boş bölümler yerine tek bir ekleme listesi.',
    features: [
      {
        title: 'Görev penceresinde tek ekleme listesi',
        description: 'Boş alt görev, yapılacaklar, bağlı görev, sayfa ve dosya bölümleri artık yer kaplamıyor. Açıklamanın altındaki listeden Alt görev ekle, Yapılacak madde ekle, Görev bağla, Sayfa / Çizim / Whiteboard ekle ya da Dosya ekle: bölüm açılır ve listeden düşer. Alt görev ve madde kutusunda Enter ekler, kutu açık kalır; birden çok satır yapıştırmak her satırı ayrı madde yapar. Boş bölümü başlığındaki ✕ ya da boş kutuda Esc kapatır.',
        major: true,
      },
      { title: 'Sayfa, çizim ve whiteboard\'lar görev penceresinde "Ekler" bölümünde; ekleme listesinden seçilen tür oluşturulup ana ekranda açılır' },
      { title: 'Dosyalar "Dosya ekle" satırına sürüklenip bırakılabilir' },
    ],
    fixes: [
      { title: 'Yüklü uygulamada tam ekran editörün ve dosya önizlemesinin üst çubuğu pencere düğmelerinin altında kalıyordu ("Okuma sütunu", kapat ve indir tıklanamıyordu)' },
    ],
  },
  {
    version: '0.70.0',
    date: '2026-09-30',
    summary: 'Görevlere yapılacaklar listesi.',
    features: [
      {
        title: 'Görevlere yapılacaklar listesi',
        description: 'Görev penceresinde alt görevlerin altında: alt görev olacak kadar büyük olmayan işler için bir satır ve bir işaret. Başlıkta tamamlanan/toplam ve yüzde; sürükleyerek sırala, çift tıkla düzenle, menüden alt göreve çevir. Birden çok satır yapıştırınca her satır ayrı madde olur.',
        major: true,
      },
      { title: '"Panoda göster" ile maddeler pano kartında da görünür ve karttan işaretlenebilir' },
      { title: 'İlerleme kartta ve liste görünümünün yeni "Yapılacaklar" sütununda (tamamlanan/toplam); görev kopyalanınca maddeler de kopyalanır' },
    ],
    fixes: [],
  },
  {
    version: '0.69.0',
    date: '2026-09-29',
    summary: 'Kısayollar yenilendi: F1 ile ekrandaki kısayollar, Teams tarzı kısayol listesi, yeni tuşlar.',
    features: [
      {
        title: 'F1\'i basılı tut: ekrandaki kısayollar',
        description: 'F1 basılıyken ekranın üstüne saydam bir katman gelir; kısayolu olan her görünür düğme çerçevelenir ve tuşları yanında yazar. F1\'i bırakınca ekran eski hâline döner.',
        major: true,
      },
      { title: 'Klavye kısayolları listesi (Ctrl + .): Teams\'teki gibi arama kutusu ve katlanır bölümler; editör kısayolları da listede' },
      { title: 'Yeni kısayollar: gelen kutusu, Ana sayfa, Takımlar, Yönetim (Ctrl+Shift+1…4), Görevlerim, Son açılanlar, yeni sayfa, liste ayarları, açık/koyu tema' },
      { title: 'Açık görev ve sayfada favori (Alt+Shift+S) ve bağlantı kopyalama (Alt+Shift+L); görev penceresinde küçült, önceki göreve dön, sonraki durum, tamamla ve yoruma git' },
      { title: 'Varsayılan tuşlar değişti: yeni görev Alt+Shift+N, filtre Ctrl+Shift+F, Pano ↔ Liste Alt+Shift+V, ayarlar Ctrl+,  — bir şey yaratan kısayol artık tek harf değil ("/" arama aynı)' },
    ],
    fixes: [],
  },
  {
    version: '0.68.10',
    date: '2026-09-29',
    summary: 'Konum çubuğunda sağ tık, sol paneldeki menünün aynısını açıyor.',
    features: [
      { title: 'Liste başlığında, görev penceresinde ve sayfanın konum satırında takım, klasör, liste ya da sayfaya sağ tıklayınca sol paneldeki menünün aynısı açılıyor (menü tuşu ya da Shift+F10 da çalışır)' },
    ],
    fixes: [],
  },
  {
    version: '0.68.9',
    date: '2026-09-29',
    summary: 'Açılışta ara sıra düşen davet isteği ve yönetim paneli sorguları artık hata vermiyor.',
    features: [],
    fixes: [
      { title: 'Bekleyen davetler isteği uygulama açılırken ara sıra 502 hatası alıyordu' },
      { title: 'Yönetim panelindeki okuma sorguları aynı sebeple ara sıra hata veriyordu; artık bir kez yeniden deneniyor' },
    ],
  },
  {
    version: '0.68.8',
    date: '2026-09-29',
    summary: 'ABAP kod blokları artık renkli.',
    features: [
      { title: 'Kod bloğunda ABAP renklendirmesi: anahtar kelimeler, yorumlar, metinler, şablonlar, sayılar, tipler, metot çağrıları ve sy- alanları' },
    ],
    fixes: [],
  },
  {
    version: '0.68.7',
    date: '2026-09-29',
    summary: 'Yönetici disk uyarısı kapatılınca bir saat görünmüyor.',
    features: [
      { title: 'Yönetici disk uyarısı ✕ ile bir saat gizlenir; sayfa yenilense ya da başka cihazdan girilse de. Disk %95\'i aşarsa uyarı beklemeden geri gelir' },
    ],
    fixes: [
      { title: 'Kapatılan disk uyarısı sayfa yenilenince ya da disk bir puan artınca hemen geri geliyordu' },
    ],
  },
  {
    version: '0.68.6',
    date: '2026-09-29',
    summary: 'Tasarım ölçekleri: okunaklı küçük yazılar, daha rahat tıklanan simgeler, tutarlı köşe ve gölgeler.',
    features: [
      { title: 'En küçük yazı 12 piksel; 11 piksel yalnız rozet ve sayaçlarda. Küçük yazılar da yazı boyutu ayarıyla büyüyor' },
      { title: 'Simge düğmeleri en az 24×24; dokunmatik ekranda 40×40 dokunma alanı' },
      { title: 'Köşe yarıçapı ve gölge üçer değere indi: arayüz baştan sona aynı ölçüyü kullanıyor' },
    ],
    fixes: [],
  },
  {
    version: '0.68.5',
    date: '2026-09-29',
    summary: 'Daha hızlı ilk açılış: ana paket 770 KB\'tan 292 KB\'a (sıkıştırılmış) indi.',
    features: [
      { title: 'İlk açılışta inen kod üçte bire indi', description: 'Editör, markdown okuyucu, görev penceresi, liste görünümü, ayarlar, gelen kutusu, sürüm notları ve İngilizce/Almanca sözlükler artık ilk kullanıldıklarında iniyor. Uygulama kurulduktan sonra hepsi zaten cihazda.', major: true },
    ],
    fixes: [],
  },
  {
    version: '0.68.4',
    date: '2026-09-29',
    summary: 'Görev penceresi sadeleşti: araç çubukları odakta, etkinlikte süzgeç, Sil ⋯ menüsünde.',
    features: [
      { title: 'Açıklamanın ve yorum kutusunun araç çubuğu yalnız içine tıklayınca (ya da Tab ile girince) görünüyor' },
      { title: 'Etkinlik & Yorumlar: "Tümü" ya da yalnız "Yorumlar"; seçim hatırlanır' },
      { title: 'Aynı kişinin art arda açıklama düzeltmeleri tek satırda: kaç kez ve net değişim' },
      { title: 'Görevi silmek başlıktaki ⋯ menüsünde; onay yine başlıkta' },
    ],
    fixes: [],
  },
  {
    version: '0.68.3',
    date: '2026-09-29',
    summary: 'Temalar sekmesi yeniden düzenlendi: yazı boyutu ve yoğunluk seçilebiliyor.',
    features: [
      { title: 'Yazı boyutu: Küçük, Normal, Büyük, Çok büyük (Profil › Temalar)', description: 'Yazı ve boşluklar bütün uygulamada birlikte büyür ya da küçülür. Seçim bu tarayıcıda saklanır.', major: true },
      { title: 'Yoğunluk: Rahat ya da Sıkı — sıkı düzende pano kartları ve kenar çubuğu ağacı daralır' },
      { title: 'Temalar sekmesi iki başlıkta: Görünüm (tema, palet, yazı boyutu, yoğunluk, kabuk) ve Davranış (görev penceresi, kutlama, kod satır numarası)' },
      { title: 'Palet önizlemeleri şu anki temanla gösteriliyor; her paletin iki temaya da uyduğu tek cümleyle anlatılıyor' },
    ],
    fixes: [],
  },
  {
    version: '0.68.2',
    date: '2026-09-29',
    summary: 'Durumlar kategori sırasında; paylaşılan liste bağlantısı her seferinde doğru listeyi açıyor.',
    features: [
      { title: 'Yeni durum kendi kategorisinin sonuna yerleşiyor (ör. "Planlanıyor" artık "Tamamlandı"nın sağına düşmüyor)' },
      { title: 'Liste ayarları: sıra kategorilere uymuyorsa "Kategoriye göre sırala" ile tek tıkla düzeltilir' },
    ],
    fixes: [
      { title: 'Paylaşılan liste bağlantısı (/list/…) ara sıra en son açılan listeyi açıyordu' },
      { title: 'Uygulama kabuğu her açılışta sunucuya soruluyor; yeni sürümden sonra eski paket açılmıyor' },
    ],
  },
  {
    version: '0.68.1',
    date: '2026-09-29',
    summary: 'Kod bloğu: satır numaraları düzeldi, dil seçici ve renkler temaya uyuyor.',
    features: [
      { title: 'Kod bloğunun renkleri temadan ve paletten geliyor: açık temada açık kutu, koyu temada paletin en koyu tonu' },
      { title: 'Yeni dil seçici: uygulamanın menüleri gibi görünüyor, yazarak süzülüyor, klavyeyle gezilebiliyor' },
    ],
    fixes: [
      { title: 'Düzenlerken satır numaraları tek satıra diziliyordu; artık her satırın yanında ve yatay kaydırmada solda sabit' },
      { title: 'Dil seçicinin listesi koyu temada okunmuyordu' },
      { title: 'İngilizce ve Almanca arayüzde kod bloğunun "Düz metin" etiketi Türkçe kalıyordu' },
    ],
  },
  {
    version: '0.68.0',
    date: '2026-09-29',
    summary: "Sayfa ve görevin yanına iki yeni bileşen (beta): Çizim ve Whiteboard. Profil > Temalar > Beta özelliklerden açılır.",
    features: [
      {
        title: 'Çizim (beta)',
        major: true,
        description: "Excalidraw ile el çizimi görünümlü şekiller, oklar, metin ve diyagramlar. Sayfa gibi takım köküne, klasöre, listeye, göreve ya da sayfanın altına eklenir; kendiliğinden kaydedilir, aynı anda açık olanlar birbirinin imlecini ve çizdiklerini canlı görür. PNG, SVG ve .excalidraw olarak dışa aktarılır.",
      },
      {
        title: 'Whiteboard (beta)',
        major: true,
        description: "Teams Whiteboard gibi: basınca duyarlı kalemler (gökkuşağı, galaksi ve ok kalemi dahil), vurgulayıcı, silgi, kementle seçme, yapışkan notlar, metin, şekiller, tepkiler, görseller ve şablonlar (retrospektif, kanban, beyin fırtınası, SWOT, haftalık plan, zihin haritası). Canlı ortak çalışma, geri al/yinele, arka plan ve ızgara seçimi.",
      },
      {
        title: "Whiteboard dışa ve içe aktarma",
        major: true,
        description: "Whiteboard PNG, SVG ya da görselleri içinde bir dosya olarak indirilir; bu dosya başka bir whiteboard'a (başka bir Fira'ya da) içe aktarılır. Fira içindeki başka bir whiteboard'dan doğrudan içerik alınabilir. Microsoft Whiteboard dışa aktarımı (.zip) da açılır: mürekkep çizildiği gibi, notlar, not ızgaraları, metinler, şekiller, bağlayıcılar, görseller, bağlantılar ve yorumlar gelir.",
      },
      { title: 'Beta özellikler ayarı', description: "Çizim ve Whiteboard ayrı ayrı açılır, varsayılan kapalı. Kapalıyken bu öğeler ağaçta, aramada, favorilerde hiçbir yerde görünmez; kapatınca oluşturulanlar silinmez. Betası kapalı birine gelen bağlantı ne olduğunu söyler ve ayarı açmayı önerir." },
      { title: 'Tuval sürümleri', description: "Çizim ve whiteboard düzenlenirken yarım saatte bir, içe aktarmadan ve geri dönmeden önce kopya alınır; Sürümler penceresinden önizlenip geri dönülür." },
    ],
    fixes: [],
  },
  {
    version: '0.67.1',
    date: '2026-09-29',
    summary: 'Sayfa çökmesi, canlı bağlantı döngüsü ve palet olay çakışması düzeltildi.',
    features: [],
    fixes: [
      { title: 'Sayfa ara sıra "Bir şeyler ters gitti" ekranına düşmüyor', description: 'Editör bileşeninin yeni sürümü, yerine yenisi konan editörün verisini siliyor; sayfa o anda eski editörden metin okumaya çalışınca çöküyordu. Kapatılmış editör artık okunmuyor.' },
      { title: 'Canlı bağlantı kendi kendine kopup bağlanmıyor', description: 'Bir kez kopan bağlantı, eski kanalın kapanma bildirimini yeni bir kopma sanıp yarım dakikada bir yeniden bağlanıyor ve her seferinde bütün verileri baştan çekiyordu. Eski kanalın bildirimi artık yok sayılıyor.' },
      { title: 'Renk paleti seçmek arama çubuğunu açmıyor', description: 'Renk paleti değişikliği, arama çubuğunu açan olayla aynı adı taşıyordu.' },
    ],
  },
  {
    version: '0.67.0',
    date: '2026-09-28',
    summary: 'Genel kalite denetiminin basit düzeltmeleri: gecikme rengi, klavye, erişilebilirlik, kontrast, güvenlik.',
    features: [
      { title: 'Sayfa başlığında favori ve bağlantı', description: 'Sayfa ekranının başlığında, görev penceresindeki gibi favori yıldızı ve "Bağlantıyı kopyala" düğmesi var.' },
      { title: 'Ana sayfada son açılanlar doğrudan listede', description: 'Ana sayfa panelindeki "Son açılanlar" bölümü son 8 öğeyi doğrudan gösteriyor; tam liste altta "Tüm son açılanlar" ile açılıyor.' },
    ],
    fixes: [
      { title: 'Tamamlanan görev gecikmiş görünmüyor', description: 'Pano kartında ve listede bitmiş görevin geçmiş tarihi artık kırmızı ▲ ile gösterilmiyor. Panoda bugün biten görev de sabahtan itibaren gecikmiş sayılıyordu; kıyas artık günün başına göre ve dört ayrı kopya tek kurala indi.' },
      { title: 'Klavyeyle gezinme', description: '"İçeriğe geç" bağlantısı artık sayfadaki ilk Tab durağı; şeritteki her öğe iki kez Tab alıyordu, artık bir kez.' },
      { title: 'Erişilebilirlik düzeltmeleri', description: 'Görünüm sekmeleri geçerli bir düğme grubu oldu; liste başlık ve satırlarından hatalı "düğme" rolü kalktı; bitiş tarihi, bağlantı türü, takım adı ve sahiplik devri alanlarına ad verildi; şifre göster düğmesi klavyeyle erişilebilir; giriş ekranında ana bölge ve başlık düzeni düzeldi.' },
      { title: 'Kontrast', description: 'Avatar baş harfleri, gelen kutusu rozeti, etiket ve durum çipleri, tamamlanmış yapılacak maddeleri, şeritteki sürüm etiketi ve açık temadaki yeşil/sarı (başarı/uyarı) yazılar en az AA okunurlukta.' },
      { title: 'Güvenlik ve bakım', description: 'Bağımlılık açıkları 17 taneden 5 taneye indi (kalanlar geliştirme araçlarında ve xlsx paketinde); iki yardımcı veritabanı fonksiyonu oturumsuz kullanıcıya kapatıldı; yönetim ekranı ana paketten ayrıldı.' },
    ],
  },
  {
    version: '0.66.1',
    date: '2026-09-28',
    summary: 'Arama çubuğu genişledi; sonuç başlıkları okunuyor.',
    features: [],
    fixes: [
      { title: 'Arama çubuğu genişledi', description: 'Üst çubuktaki arama kutusu geniş ekranda 672 piksele kadar büyüyor (v0.65.0 ile ekran ortasına alınırken yaklaşık 300 piksele daralmıştı). Sonuç listesi de aynı genişlikte açıldığı için görev ve sayfa başlıkları artık kesilmeden okunuyor. Dar pencerede kutu marka ve avatarın üstüne binmeyecek kadar küçülüyor.' },
    ],
  },
  {
    version: '0.66.0',
    date: '2026-09-28',
    summary: 'Temalar bölümüne renk paletleri geldi: Arduvaz, Grafit, Kum, Gece mavisi ve Yüksek kontrast.',
    features: [
      {
        title: 'Renk paletleri',
        major: true,
        description: 'Profil > Temalar > "Renk paleti" altında beş seçenek var: Arduvaz (bugünkü görünüm), Grafit (tam nötr gri), Kum (sıcak, kâğıt tonlu), Gece mavisi (maviye çalan serin tonlar) ve Yüksek kontrast (koyu yazı, belirgin çizgiler). Palet açık ve koyu temada, klasik ve yeni kabukta birlikte çalışır; marka rengi değişmez. Soluk yazılar her palette en az AA okunurlukta; Yüksek kontrast çizgileri de belirginleştirir.',
      },
    ],
    fixes: [],
  },
  {
    version: '0.65.0',
    date: '2026-09-28',
    summary: 'Yeni kabukta tonlar yumuşadı, arama çubuğu ortalandı, satır menüsü doğru yerde açılıyor.',
    features: [
      { title: 'Arama çubuğu ekranın ortasında', description: 'Geniş ekranda üst çubuktaki arama kutusu ekranın tam ortasında duruyor; eskiden soldaki marka ile sağdaki avatarın genişlik farkı kadar kayıyordu.' },
    ],
    fixes: [
      { title: 'Yeni kabukta tonlar yumuşadı', description: 'Tam beyaz ve tam siyah yerine: her iki temada da ana panel daha açık, şerit ve panel daha koyu bir tonda. Liste başlığının köşe yuvarlaklığı da kalktı.' },
      { title: 'Satır menüsü tıklanan düğmenin altında', description: 'Kenar çubuğu iki kez çizildiği için (masaüstü paneli ve telefon çekmecesi) bazı menüler ekranın sol üst köşesinde açılıyordu; menü artık tıklanan düğmenin kutusuna göre yerleşiyor.' },
      { title: 'Bırakma alanının yanında seviye çizgisi yok', description: 'Takımın kök bırakma alanı ağacın bir dalı olmadığı için solundaki seviye çizgisi kaldırıldı.' },
      { title: 'Ana ekranın kenar boşlukları geri geldi', description: 'Bir önceki sürümde kaldırılan yan ve alt boşluklar geri alındı.' },
    ],
  },
  {
    version: '0.64.3',
    date: '2026-09-28',
    summary: 'Yeni kabukta içerik yaprağın kenarlarına kadar uzanıyor.',
    features: [],
    fixes: [
      { title: 'Ana ekranın yan ve alt boşlukları kalktı', description: 'Yeni kabukta liste ve araç çubuğu yaprağın kenarlarına kadar uzanıyor; altta da boşluk kalmadı. Pano kendi yan boşluğunu koruyor, kartlar kenara yapışmıyor.' },
    ],
  },
  {
    version: '0.64.2',
    date: '2026-09-28',
    summary: 'Panelde oklar sağa geçti, sürükleme çubuğu gizlendi, yaprak üst çubuğa yaslandı.',
    features: [],
    fixes: [
      { title: 'Katlama okları satırın sağında', description: 'Klasör, liste ve sayfa satırlarındaki katlama okları takım satırındaki gibi sağa alındı; satır menüsü onların soluna kaydı. Simgeler satırın başında hizalı duruyor.' },
      { title: 'Seviye çizgisi simgenin ortasından iniyor', description: 'Ağaçtaki dikey seviye çizgisi, açan satırın simgesinin tam ortasından geçiyor.' },
      { title: 'Sürükleme çubuğu gizlendi', description: 'Panel ile ana ekran arasındaki sürükleme çubuğu normalde görünmüyor; üzerine gelince (ya da sürüklerken) ortasında üç dikey çizgili tutamak beliriyor.' },
      { title: 'Yaprak üst çubuğa ve panele yaslandı', description: 'Yeni kabukta içerik yaprağının üstündeki ve sol tarafındaki boşluklar kaldırıldı; yaprak yalnız sağda ve altta yüzüyor.' },
    ],
  },
  {
    version: '0.64.1',
    date: '2026-09-28',
    summary: 'Yeni kabukta ayraç, ok ve takım satırı hizaları düzeltildi.',
    features: [],
    fixes: [
      { title: 'Kabuktaki beyaz çizgiler kalktı', description: 'Gelen kutusu, şerit ve panel başlığının altındaki yatay ayraçlar yeni kabukta kaldırıldı: gri zeminde beyaz çizgi gibi görünüyorlardı. Ağaçtaki dikey seviye çizgileri kaldı ama zeminden biraz koyu bir griye çekildi.' },
      { title: 'Liste oku klasörle aynı hizada', description: 'Sayfası olan bir listenin katlama oku satırın solunda, dışarıda duruyordu; artık klasörlerdekiyle aynı yuvada. Sayfası olmayan listelerde yuva boş durduğu için bütün simgeler aynı hizada.' },
      { title: 'Takım logosu panel başlığıyla hizalı', description: 'Takım satırının solundaki 8 piksellik boşluk kaldırıldı; takım logosu panel başlığındaki simgeyle aynı hizada başlıyor.' },
    ],
  },
  {
    version: '0.64.0',
    date: '2026-09-28',
    summary: 'Yeni kabuk beta olarak geldi: tek gri çerçeve, içerikte beyaz yaprak.',
    features: [
      {
        title: 'Yeni kabuk (beta)',
        major: true,
        description: 'Profil > Temalar altındaki "Yeni kabuk (beta)" anahtarını açınca şerit, üst çubuk ve panel aynı koyu gride buluşuyor; pano ve liste ise köşeleri yuvarlak, gölgeli, tam beyaz (koyu temada tam siyah) bir yaprağın içinde açılıyor. Varsayılan kapalı, beğenmezsen anahtarı kapatman yeter; seçim bu tarayıcıda saklanır.',
      },
    ],
    fixes: [],
  },
  {
    version: '0.63.0',
    date: '2026-09-28',
    summary: 'Konum satırından gösterme artık gelen kutusu ve yönetim ekranı açıkken de tamamlanıyor; liste adımı listeyi de açıyor.',
    features: [
      { title: 'Liste adımı listeyi de açıyor', description: 'Sayfanın ya da görevin konum satırında listenin adına tıklayınca liste soldaki ağaçta gösterilmekle kalmıyor, ana ekranda da açılıyor.' },
    ],
    fixes: [
      { title: 'Gelen kutusu ve yönetim ekranı gösterme davranışını engellemiyor', description: 'Konum satırından "ağaçta göster" isteyince gelen kutusu çekmecesi kapanıyor, yönetim ekranı açıksa ondan çıkılıyor ve kenar çubuğu Takımlar paneline geçiyor. Önceden ikisi de ekranın üstünde kalıyordu, gösterme perdenin arkasında oluyordu.' },
    ],
  },
  {
    version: '0.62.1',
    date: '2026-09-28',
    summary: 'Yorumlardaki paragraf bağlantısı geri alındı.',
    features: [],
    fixes: [
      { title: 'Yorumlarda bölüm bağlantısı yok', description: 'Yorum balonlarındaki zincir düğmesi kaldırıldı: yorumun tek bir paragrafına bağlantı verme özelliği geri alındı. Sayfalarda ve görev açıklamasında paragraf bağlantısı eskisi gibi duruyor. Daha önce paylaşılmış "yorumun şu paragrafı" bağlantıları görevi açmaya devam ediyor, sadece paragrafa kaydırmıyor.' },
    ],
  },
  {
    version: '0.62.0',
    date: '2026-09-28',
    summary: 'Yeni liste görünümü beta olmaktan çıktı: artık tek liste görünümü o.',
    features: [
      {
        title: 'Liste görünümü herkese açık',
        major: true,
        description: 'Gruplama, sıralama, sütun seçme, satır içi düzenleme, toplu işlem ve kayıtlı görünümlerle gelen liste artık varsayılan: Profil > Temalar altındaki "Yeni liste görünümü (beta)" anahtarı kalktı, anahtarı hiç açmamış olanlar da aynı listeyi görüyor. Görevlerim de aynı motorla çiziliyor, yani kayıtlı görünümler ve sütun ayarları orada da var.',
      },
    ],
    fixes: [],
  },
  {
    version: '0.61.0',
    date: '2026-09-28',
    summary: 'Liste görünümüne "Oluşturan" sütunu eklendi.',
    features: [
      { title: '"Oluşturan" sütunu', description: 'Liste görünümünde görevi kimin açtığını gösteren sütun var: Sütunlar menüsünden (ya da tablonun sağındaki +) eklenir, avatar ve adla görünür, ada göre sıralanır ve CSV dışa aktarımına da giriyor. Sütun kapalıyken veri de çekilmiyor, yani liste ağırlaşmıyor.' },
    ],
    fixes: [],
  },
  {
    version: '0.60.2',
    date: '2026-09-28',
    summary: 'Yorumdaki bölüm bağlantısı düğmesi görünür oldu.',
    features: [],
    fixes: [
      { title: 'Yorumun bir paragrafına bağlantı veren zincir düğmesi görünmüyordu: düğme paragrafın solunda, yorum balonunun dışında kalıyor ve balonun yuvarlak köşeleri onu kırpıyordu. Artık paragrafın sağında, balonun içinde ve üzerine gelince beliriyor.' },
    ],
  },
  {
    version: '0.60.1',
    date: '2026-09-28',
    summary: 'Bağlantı bandı üst çubuğun hemen altına taşındı.',
    features: [],
    fixes: [
      { title: 'Çevrimdışı ve "canlı bağlantı koptu" bantları artık arama çubuğunun olduğu üst çubuğun hemen altında, tam genişlikte duruyor ve ekranın geri kalanını aşağı itiyor; kenar çubuğu, gelen kutusu çekmecesi ve tam ekran görev penceresi de bandın altından başlıyor.' },
    ],
  },
  {
    version: '0.60.0',
    date: '2026-09-28',
    summary: 'Hata bildirimleri ne olduğunu söylüyor; teknik detay tek tıkla açılıyor.',
    features: [
      {
        title: 'Hata bildiriminde "Detay göster"',
        description: 'Bir işlem başarısız olduğunda çıkan bildirimde artık "Detay göster" var: tıklayınca hatanın teknik özeti (kod, HTTP durumu, sunucunun kendi mesajı ve varsa ipucu) açılıyor. Kapalıyken bildirim yine kısa ve sade duruyor.',
        major: true,
      },
    ],
    fixes: [
      { title: 'Görev taşıma/kopyalama kuralları "bir şeyler ters gitti" diyordu: sunucunun anlattığı sebep (yetki, aynı takım şartı, silinmiş liste) artık olduğu gibi gösteriliyor.' },
      { title: 'Taşıma ve kopyalama kurallarının metinleri de ne yapman gerektiğini söylüyor; örneğin "Başka bir takımın listesine taşımak için her iki takımda da yönetici olman gerekiyor".' },
    ],
  },
  {
    version: '0.59.0',
    date: '2026-09-28',
    summary: 'Görev penceresindeki konum satırı da soldaki ağaçta gösteriyor.',
    features: [
      { title: 'Görevin konum satırı ağaçta gösteriyor', description: 'Sayfalarda olan davranış görev penceresine de geldi: üstteki takım ve liste adına tıklayınca görev kapanıp o liste panoda açılıyor ve aynı anda soldaki ağaçta yol açılıp satır vurgulanıyor. Böylece açtığın görevin hangi listede durduğu bir tıkla görünüyor.' },
    ],
    fixes: [],
  },
  {
    version: '0.58.2',
    date: '2026-09-28',
    summary: 'Dosya sürüklerken kenara yaklaşınca sayfa kendiliğinden kayıyor.',
    features: [],
    fixes: [
      { title: 'Dosyayı sürüklerken pencerenin üst ya da alt kenarına yaklaşınca içerik kendiliğinden kayıyor; ne kadar yaklaşırsan o kadar hızlı. Dosyayı aşağıdaki Dosyalar bölümünden yukarıdaki açıklamaya taşımak için artık sürüklemeyi bırakmak gerekmiyor.' },
      { title: 'Dosya kartının imleci dört oklu "taşı" yerine kopyalama imleci (ok + artı): dosya metne kopyalanıyor, yerinden taşınmıyor.' },
    ],
  },
  {
    version: '0.58.1',
    date: '2026-09-28',
    summary: 'Bağlantı kopyalayınca onay çıkıyor ve kopyalanan adres doğrudan yapıştırılabiliyor.',
    features: [],
    fixes: [
      { title: 'Bağlantı kopyalandığında sağ altta "Bağlantı panoya kopyalandı" onayı ve adresin kendisi çıkıyor; düğmeye basılıp basılmadığı anlaşılmıyordu.' },
      { title: 'Kopyalanan adres düz metin olarak artık markdown değil, adresin kendisi: tarayıcıya ya da sohbete yapıştırınca doğrudan çalışıyor. Teams, Outlook gibi biçimli kutulara yapıştırınca yine başlığıyla tıklanabilir bağlantı oluyor.' },
    ],
  },
  {
    version: '0.58.0',
    date: '2026-09-28',
    summary: 'Sunucuya ulaşılamadığında dönen tekerlek yerine ne olduğunu söyleyen ekran.',
    features: [
      {
        title: 'Sunucuya ulaşılamıyor ekranı',
        description: 'Şirket ağına (VPN) bağlı değilken Fira açılışta boş bir ekranda dönüp duruyordu: ne hata, ne bilgi. Artık altı saniye içinde bağlanamazsa ne olduğunu yazan bir ekran geliyor — sunucuya ulaşılamadığı, en sık sebebin VPN bağlantısı olduğu ve bağlantı gelirse uygulamanın kendiliğinden açılacağı. Deneme kendiliğinden ve artan aralıklarla sürüyor (5, 10, 20, 30, 60 saniye) ve bir sonraki denemeye kaç saniye kaldığı ekranda yazıyor; "Şimdi dene" ile beklemeyi atlayabilirsin. Sunucu cevap verdiği anda uygulama kaldığı yerden açılıyor.',
        major: true,
      },
      { title: 'Giriş ekranında da uyarı', description: 'Oturum açmadan önce sunucuya ulaşılamıyorsa giriş formunun üstünde aynı bilgi ve geri sayım çıkıyor; "Giriş yap" düğmesine basıp boş bir hata beklemek gerekmiyor.' },
    ],
    fixes: [],
  },
  {
    version: '0.57.1',
    date: '2026-09-25',
    summary: 'Görev penceresi açıkken ayarın eski değerine dönmesi düzeldi.',
    features: [],
    fixes: [
      {
        title: 'Ayar değiştirince eski değerine dönüyordu',
        description: 'Özellikle görev penceresi açıkken bir ayarı değiştirdiğinde ekran doğru değeri gösteriyor, sonra kendiliğinden eskiye dönüyordu. Sebep: tercihleri yazan yerlerden bazıları kullanıcı bilgisi henüz gelmeden yazdığı için ikinci bir yazma sırası açılıyor, iki istek birbiriyle yarışıyordu. Artık tek sıra, tek istek. Ek olarak yazılan değer sunucu onu geri verene kadar ekranda korunuyor ve kaydedilemezse (bağlantı, oran sınırı) artan aralıklarla yeniden deneniyor; olmuyorsa sessiz kalmak yerine uyarı çıkıyor.',
        major: true,
      },
    ],
  },
  {
    version: '0.57.0',
    date: '2026-09-25',
    summary: 'Görev açıklamasındaki ve yorumlardaki bir paragrafa da bağlantı verilebiliyor; bağlantı düğmesi düzeldi.',
    features: [
      {
        title: 'Açıklama ve yorumlarda bölüm bağlantısı',
        description: 'Sayfalarda olan "şu paragrafa bağlantı ver" artık görev açıklamasında ve yorumlarda da var. Açıklamayı düzenlerken metni seçince çıkan çubuktaki zincir düğmesi, yorumlarda ise paragrafın soluna gelince çıkan zincir düğmesi o bölümün adresini kopyalıyor. Bağlantıyla gelen kişide görev açılıyor ve o paragrafa kayıp kısa süre vurguluyor.',
        major: true,
      },
    ],
    fixes: [
      { title: 'Bağlantı düğmesi: imleç bir kelimenin içindeyken adres verince artık o kelime bağlantı oluyor (eskiden imlecin olduğu yere çıplak adres yazılıyordu).' },
      { title: 'Bağlantı kutusunda yazılı "Bağlantıyı kaldır" düğmesi var; eskiden kaldırmak için kutuyu boşaltıp Enter tuşuna basmak gerekiyordu ve bunu kimse bulamıyordu.' },
    ],
  },
  {
    version: '0.56.1',
    date: '2026-09-25',
    summary: 'Dosya sürüklemesi artık kendini belli ediyor.',
    features: [],
    fixes: [
      { title: 'Dosyanın sürüklenebildiği ve adının çift tıkla değiştirilebildiği hiçbir yerden anlaşılmıyordu: dosya kartının imleci artık taşıma imleci, adın üstünde yazı imleci ve ikisi de ipucunda yazıyor.' },
      { title: 'Sürükleme başlayınca bırakılabilecek yerler (açıklama ve yorum kutuları) kesikli bir çerçeveyle işaretleniyor.' },
      { title: 'Metnin içindeki bırakma imleci beyaz görünüyordu; uygulamanın diğer bırakma işaretleriyle aynı mor-mavi tona geçti.' },
    ],
  },
  {
    version: '0.56.0',
    date: '2026-09-25',
    summary: 'Dosyalar bölümündeki bir belge açıklamaya ya da yoruma konabiliyor.',
    features: [
      {
        title: 'Dosyalardan metne ekleme',
        description: 'Şimdiye kadar yol tek yönlüydü: metne yapıştırılan dosya Dosyalar bölümüne de giriyordu ama tersi yoktu; metinden çıkarılan bir görseli geri koymak için dosyayı yeniden yüklemek gerekiyordu. Artık Dosyalar bölümündeki her belge (kaynağı ne olursa olsun) açıklamaya ya da yorum kutusuna eklenebiliyor: satırın ⋯ menüsünde "Açıklamaya ekle" ve "Yorum kutusuna ekle" var, ayrıca dosya satırı doğrudan editöre sürüklenebiliyor. Görsel ve videolar görsel olarak, diğer belgeler adıyla bağlantı olarak giriyor.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.55.2',
    date: '2026-09-25',
    summary: 'Metin seçince çıkan biçim çubuğu iki temada da okunur.',
    features: [],
    fixes: [
      { title: 'Metin seçince çıkan biçim çubuğu koyu temada okunmuyordu: zemin beyaza dönüyor, simgeler açık gri kalıyordu. Çubuk artık uygulamanın diğer açılır kutuları gibi yüzey rengini, çerçevesini ve gölgesini kullanıyor; simgeler ve seçili (etkin) düğmeler iki temada da net.' },
      { title: 'Yapıştırılan metin için çıkan "Biçimlendir" kutusu da aynı şekilde düzeltildi (koyu temada beyaz üstüne beyaz yazı kalıyordu).' },
    ],
  },
  {
    version: '0.55.1',
    date: '2026-09-25',
    summary: 'Tercihler tek bir gecikmeli istekle kaydediliyor.',
    features: [],
    fixes: [
      { title: 'Görünüm, katla/aç, son açılanlar gibi tercihler artık her tıkta ayrı istek göndermiyor: aynı kayda yazan yerler tek tamponda birleşiyor ve son değişiklikten kısa süre sonra tek istek gidiyor (en geç iki buçuk saniye). Sekme kapanırken bekleyen yazma da gönderiliyor.' },
    ],
  },
  {
    version: '0.55.0',
    date: '2026-09-25',
    summary: 'Görev ekleme satırı boşken görünmüyor; denetimleri kendi sütunlarının altında ve başlıktaki + listenin başına ekliyor.',
    features: [
      {
        title: 'Görünmeyen görev ekleme satırı',
        description: 'Liste görünümünde grubun sonundaki ekleme satırı artık boşken hiç görünmüyor — ne halka, ne yer tutucu, ne düğme. Görev eklemeyle ilgilenmeyen kişi boş bir satır bile görmüyor. Üzerine gelince ya da içine tıklayınca hepsi birden beliriyor.',
        major: true,
      },
      { title: 'Denetimler kendi sütunlarının altında', description: 'Kişi, tarih, öncelik ve etiket düğmeleri sağda toplu durmak yerine ilgili sütunun altında duruyor; başlık ve durum halkası zaten öyleydi. Kapalı bir sütunun düğmesi kaybolmuyor, başlığın sonunda kalıyor.' },
      { title: 'Grup başlığındaki + listenin başına ekliyor', description: 'Durum başlığının yanındaki + artık aşağıdaki satıra odaklanmıyor, grubun en üstünde yeni bir ekleme satırı açıyor ve oraya yazılan görev listenin başına giriyor. Alttaki satır ise listenin sonuna eklemeye devam ediyor.' },
    ],
    fixes: [
      { title: 'Liste bağlantısındaki görünüm seçimi artık tutuyor: pano/liste tercihi adresle geldiğinde kayıtlı tercih tarafından eziliyordu.' },
    ],
  },
  {
    version: '0.54.0',
    date: '2026-09-25',
    summary: 'Sayfanın üstündeki konum satırı tıklanabilir: soldaki ağaçta nerede durduğunu gösteriyor.',
    features: [
      {
        title: 'Sayfa nerede duruyor? Konum satırına tıkla',
        description: 'Aramayla bulunup açılan bir sayfanın ağaçtaki yeri görünmüyordu. Sayfanın üstündeki konum satırının her adımı (takım, klasör, liste, üst sayfa ve sayfanın kendisi) artık tıklanabiliyor: kenar çubuğu Takımlar paneline geçiyor, yalnız o yol açılıyor, satır görünür alana kayıyor ve kısa süre vurgulanıyor. Kapalı dallardan sadece yol üzerindekiler açılıyor; takımın tamamı açılmıyor.',
        major: true,
      },
      { title: 'Liste ve üst sayfa adımları çift tıkla açılıyor', description: 'Tek tık ağaçta gösteriyor; eskiden olduğu gibi listeyi panoda ya da üst sayfayı açmak için çift tıklamak yeterli. İpucunda yazıyor.' },
    ],
    fixes: [],
  },
  {
    version: '0.53.0',
    date: '2026-09-25',
    summary: 'Liste, sayfa ve sayfa içindeki bir bölüm bağlantı olarak paylaşılabiliyor.',
    features: [
      {
        title: 'Bağlantı olarak kopyala',
        description: 'Görev bağlantısı zaten vardı; artık liste (pano) ve sayfa da bağlantı olarak paylaşılabiliyor. Kenar çubuğundaki liste, sayfa ve favori satırlarının menüsünde (sağ tık da olur) "Bağlantıyı kopyala" var; bağlantı, Teams gibi yerlere tıklanabilir şekilde yapışıyor. Liste bağlantısını açan kişide o liste seçili geliyor.',
        major: true,
      },
      {
        title: 'Sayfa içinde bir bölüme bağlantı',
        description: 'Bir sayfanın tek bir paragrafına ya da başlığına bağlantı verilebiliyor. Okuma görünümünde bloğun soluna gelince çıkan zincir düğmesi, düzenlerken de metni seçince çıkan çubuktaki zincir düğmesi o bloğun adresini kopyalıyor. Bağlantıyla gelen kişide sayfa o bloğa kayıyor ve blok kısa süre vurgulanıyor. Adres bloğun metninden türetildiği için sayfa düzenlense de bağlantı çalışmaya devam ediyor; metin tamamen değişmişse sayfa başında kalınıyor.',
      },
    ],
    fixes: [],
  },
  {
    version: '0.52.0',
    date: '2026-09-25',
    summary: 'Liste görünümünde görev ekleme satırı sessizleşti.',
    features: [
      {
        title: 'Sakin görev ekleme satırı',
        description: 'Liste görünümünde her grubun sonundaki "Görev ekle" düğmesi kalktı. Yerine, hep orada duran bir yazı alanı var: başlığı yaz, Enter ile görev oluşur. Boştayken satır kenarlıksız ve saydam; kişi, tarih, öncelik ve etiket düğmeleri yalnız üzerine gelince, odaklanınca ya da bir şey yazınca beliriyor. Alan diğer görevlerin başlığıyla aynı hizada başlıyor ve satırın başında grubun durum halkası duruyor. Grup başlığındaki + düğmesi de aynı satıra odaklanıyor.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.51.2',
    date: '2026-09-25',
    summary: 'Tag kutusu artık açıklama editörünün altında kalmıyor.',
    features: [],
    fixes: [
      {
        title: 'Tag seçme kutusu editörün altında kalıyordu',
        description: 'Görev penceresinde "+ Tag" ile açılan kutunun alt kısmı, altındaki açıklama editörünün araç çubuğunun arkasında kalıyor, "Yeni tag oluştur" satırı yarısından kesiliyordu. İkisi aynı katmandaydı ve editör sonra çizildiği için öne geçiyordu; kutu artık editörün üstünde.',
      },
    ],
  },
  {
    version: '0.51.1',
    date: '2026-09-25',
    summary: 'Hızlı yapılan ayar değişiklikleri geri alınmıyor.',
    features: [],
    fixes: [
      {
        title: 'Hızlı değişiklikte ayar eski haline dönüyordu',
        description: 'Bir ayarı değiştirip hemen ardından başka bir şey yaptığında, önceki isteğin geç dönen cevabı ekrandaki yeni değeri siliyor ve ayar kendiliğinden eski haline dönmüş gibi görünüyordu; aynısı ağaçtaki açma/kapama durumları için de oluyordu. Artık yalnız en son gönderilen kaydın cevabı ekrana yansıyor, geç gelen eski cevaplar yok sayılıyor. Ağaçta arka arkaya açılan iki dal da birbirini geri almıyor.',
      },
    ],
  },
  {
    version: '0.51.0',
    date: '2026-09-25',
    summary: 'Görevler başka bir takımın listesine de taşınabiliyor.',
    features: [
      {
        title: 'Takımlar arası taşıma',
        description: 'İki takımda da yöneticiysen "Listeye taşı" penceresinde diğer takımının listeleri de çıkıyor; başlık altında hangi takıma ait olduğu yazıyor. Görev alt görevleriyle birlikte gidiyor, durumu hedefteki aynı adlı sütuna (yoksa ilk sütuna) oturuyor, etiketler ada göre eşleniyor. Hedef takımın üyesi olmayan atamalar kaldırılıyor — göremeyeceği bir görevin üstünde adı kalmasın diye; kaç atamanın düştüğü etkinlik kaydına yazılıyor. Kendi takımın içinde taşıma eskisi gibi, yazma yetkisi yeterli.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.50.2',
    date: '2026-09-25',
    summary: 'Tam ekran görev açıkken üst çubuktan yapılan seçimler öne geliyor.',
    features: [],
    fixes: [
      {
        title: 'Üst çubuktan seçilen liste, görevin altında açılıyordu',
        description: 'Bir görev tam ekran açıkken aramadan bir liste (ya da takım) seçtiğinde liste görev penceresinin altında açılıyor, pencereyi kapatana kadar görünmüyordu. Artık üst çubuktan yapılan gezinme görev penceresini kapatıyor: seçtiğin liste, ana sayfa, gelen kutusu, pano/liste görünümü ve filtre doğrudan öne geliyor. Sayfa seçmek zaten pencereyi kapatıyordu.',
      },
      {
        title: 'Profil menüsü görev panelinin altında kalıyordu',
        description: 'Tam ekran görev açıkken profil menüsü açılıyor ama görev panelinin arkasında kalıyordu. Menü artık üst çubuktan açılan diğer katmanlarla (komut paleti) aynı seviyede, her şeyin üstünde.',
      },
    ],
  },
  {
    version: '0.50.1',
    date: '2026-09-24',
    summary: 'Tam ekran görev görünümünde üst çubuk yerinde kalıyor.',
    features: [],
    fixes: [
      {
        title: 'Tam ekran görev, üst çubuğun üstünü örtüyordu',
        description: 'Görev tam ekran açıldığında uygulamanın üst çubuğu (marka, arama, profil) tamamen kapanıyordu; yüklü pencerede o satır aynı zamanda işletim sisteminin başlık şeridi olduğu için görev başlığı pencere düğmeleriyle üst üste biniyordu. Tam ekran görünüm artık üst çubuğun altından başlıyor: arama ve profil her zaman elinin altında, pencere de çubuktan sürüklenebiliyor. Telefonda görünüm eskisi gibi tam kaplıyor.',
      },
    ],
  },
  {
    version: '0.50.0',
    date: '2026-09-24',
    summary: 'Yorumlar sonradan düzenlenebiliyor.',
    features: [
      {
        title: 'Yorumu düzenleme',
        description: 'Kendi yorumunun sağ üstünde, Sil’in yanında artık Düzenle var. Yorum olduğu yerde açılıyor, aynı yazı kutusu ve araçlarla düzeltiyorsun; Kaydet ile kapanıyor, Ctrl+Enter da kaydediyor. Düzenlenen yorumun saatinin yanında "düzenlendi" yazıyor. Düzenlemeyle eklediğin @bahsetme, anılan kişiye bildirim olarak gidiyor; düzenleme gelen kutusunda ikinci bir satır açmıyor. Metinden çıkardığın görseller, yorumu silerken olduğu gibi dosyalardan da düşüyor.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.49.10',
    date: '2026-09-24',
    summary: 'Favorilerdeki liste simgeleri kendi renginde.',
    features: [],
    fixes: [
      {
        title: 'Favorilerde liste rengi görünmüyordu',
        description: 'Favorilere eklenen listelerin simgesi doğru geliyor ama rengi gelmiyordu; simge gri duruyordu. Renk artık listeyle birlikte okunuyor ve ağaçtaki ile aynı görünüyor. Aynı satırları kullanan "son açılanlar" listesi de düzeldi.',
      },
    ],
  },
  {
    version: '0.49.9',
    date: '2026-09-24',
    summary: 'Atama kutusu doğru yerde açılıyor, kişi ekleme düğmesi hover ile çıkıyor.',
    features: [],
    fixes: [
      {
        title: 'Atama kutusu satırdan uzakta açılıyordu',
        description: 'Listenin alt sıralarında atama kutusu yukarı açılırken, kutunun üst kenarı izin verilen en büyük yükseklikten hesaplanıyordu; kutu kısa olunca hücrenin yarım ekran yukarısında duruyordu. Artık alt kenarından bağlanıyor, yani her zaman tıkladığın hücrenin hemen üstünde açılıyor.',
      },
      {
        title: 'Kişi ekleme düğmesi listede hover ile çıkmıyordu',
        description: 'Atananlar sütunundaki "+" düğmesi yeni liste görünümünde satırın üzerine gelince görünmüyor, ancak tıklandığında beliriyordu. Artık pano kartında olduğu gibi satırın üzerine gelince çıkıyor; dokunmatik ekranda her zaman görünür.',
      },
    ],
  },
  {
    version: '0.49.8',
    date: '2026-09-24',
    summary: 'Yönetim ekranındaki boş başlık çubuğu kalktı.',
    features: [],
    fixes: [
      {
        title: 'Yer iminden açılan yönetim ekranında sekmeler kapalı geliyordu',
        description: 'Doğrudan /admin adresiyle (yer imi ya da sayfa yenileme) girildiğinde soldaki panel yönetim sekmeleri yerine Takımlar ağacını açıyordu; kaydedilmiş panel tercihi sonradan gelip yönetimi eziyordu. Artık yönetim adresiyle açıldığında panel yönetimde kalıyor.',
      },
      {
        title: 'Yönetim ekranında gereksiz başlık çubuğu',
        description: 'Yönetim açıkken içeriğin üstünde yalnız "Yönetim" yazan bir çubuk duruyordu; hangi sekmede olduğun zaten soldaki panelde görünüyor. Çubuk masaüstünde kalktı, içerik yukarı çıktı. Telefonda menüyü açan düğme için ince çubuk kalmaya devam ediyor.',
      },
    ],
  },
  {
    version: '0.49.7',
    date: '2026-09-24',
    summary: 'Yüklü pencerede başlık şeridi uygulamanın rengini alıyor.',
    features: [],
    fixes: [
      {
        title: 'Yüklü pencere: başlık şeridi ve arama sonuçları',
        description: 'Pencere düğmelerinin arkasındaki şerit beyaz kalıyor, Fira\'nın üst çubuğu ise gri olduğu için yan yana iki ayrı başlık çubuğu gibi duruyordu. Şerit artık üst çubuğun rengini alıyor (koyu temada da) ve renk doğrudan temanın kendi değerinden okunuyor. Ayrıca yüklü pencerede arama sonucuna çift tıklayınca sonuç açılmıyor, pencere büyüyüp küçülüyordu: çubuktan açılan katmanlar artık pencere sürükleme alanı sayılmıyor.',
      },
      {
        title: 'Dar pencerede liste adı iki harfe iniyordu',
        description: 'Başlıktaki liste adı, görünüm sekmeleri yer isteyince iki harfe kadar eziliyordu. Ada taban genişlik verildi; daralma önce sekmelerden karşılanıyor.',
      },
    ],
  },
  {
    version: '0.49.6',
    date: '2026-09-24',
    summary: 'Sütun ekleme menüsü ekranın dışına taşmıyor.',
    features: [],
    fixes: [
      {
        title: 'Sütun ekleme menüsü kenarda kesiliyordu',
        description: 'Liste başlık satırının sonundaki "+" düğmesi pencerenin sağ kenarına yakınken açılan menü dışarı taşıyor, sütun adları kesik görünüyordu. Menü artık sığmadığı durumda sola doğru açılıyor.',
      },
    ],
  },
  {
    version: '0.49.5',
    date: '2026-09-24',
    summary: 'Yüklü penceredeki başlık çubuğu artık sıkışık değil.',
    features: [],
    fixes: [
      {
        title: 'Yüklü pencerede üst çubuk sıkışıyordu',
        description: 'Uygulama olarak açıldığında üst çubuk işletim sisteminin başlık şeridine (Windows\'ta 33 piksel) sıkıştırılıyor, arama kutusu ile profil düğmesi eziliyordu. Çubuk artık kendi yüksekliğinde (48 piksel) duruyor, sürükleme yalnız üstteki şeritten yapılıyor; pencere düğmelerinin yanında da biraz daha boşluk var. Şeridi daha uzun olan sistemlerde çubuk ona uyar. Görev penceresi açıkken de başlık şeridi kararmıyor: pencere oradan sürüklenmeye devam ediyor.',
      },
    ],
  },
  {
    version: '0.49.4',
    date: '2026-09-24',
    summary: 'Yönetim ekranı ile görev penceresi birbirini açıp duruyordu.',
    features: [],
    fixes: [
      {
        title: 'Yönetim ↔ görev penceresi döngüsü',
        description: 'Yönetim ekranı açıkken gelen kutusundan bir görev açıp kapatınca yönetim geri geliyor, yönetimi kapatınca aynı görev yeniden açılıyor ve bu böyle sürüp gidiyordu. Sebep: yönetimden çıkarken dönülecek ekran olarak en son adres saklanıyordu, görev penceresinin adresi de ekran sayılıyordu. Görev penceresi artık "bırakılan ekran" olarak sayılmıyor; yönetimi kapatınca altındaki ekrana (liste, pano, ana sayfa) dönülüyor.',
      },
    ],
  },
  {
    version: '0.49.3',
    date: '2026-09-24',
    summary: 'Liste görünümünde satır vurgusu artık satır boyunca kesintisiz.',
    features: [],
    fixes: [
      {
        title: 'Liste: seçili satırın çerçevesi ad sütununda kayboluyordu',
        description: 'Klavyeyle seçilen satırın çerçevesi yalnız satırın solunda ve sağ uçtaki sütunlarda görünüyor, ad sütunu boyunca kesiliyordu (sıkı görünümde daha belirgin). Ad sütunu yatay kaydırmada yerinde kaldığı için satırın üstüne biniyordu; çerçeve artık hücrelerin içine çiziliyor ve satır boyunca aynı kalınlıkta görünüyor. Satır yüksekliği değişmedi. Sürükle-bırakta görünen ekleme çizgisi de aynı sebeple ad sütununda kayboluyordu, o da düzeldi.',
      },
    ],
  },
  {
    version: '0.49.2',
    date: '2026-09-24',
    summary: 'Yönetim ekranındayken canlı bağlantı sürekli kopuyordu.',
    features: [],
    fixes: [
      {
        title: 'Canlı bağlantı kopması (yönetim ekranı)',
        description: 'Yönetim ekranı açıkken "canlı bağlantı koptu" uyarısı saniyede bir yanıp sönüyor, liste ve pano kendini boş yere tazeliyordu. Sebep: yönetim ekranı uygulamanın içine taşınınca (v0.44.0) hem kabuk hem de yönetim ekranı ayrı birer canlı bağlantı kuruyordu; ikisi aynı kanalları paylaştığı için biri diğerinin bağlantısını kapatıyordu. Artık tek bir bağlantı var; ikinci bir abonelik denemesi sessizce bekliyor.',
      },
    ],
  },
  {
    version: '0.49.1',
    date: '2026-09-24',
    summary: 'Hızlı görev ekleme kutusu kayıttan sonra ilk hâline dönüyor.',
    features: [],
    fixes: [
      {
        title: 'Görev eklendikten sonra atama listesi ve seçimler kalıyordu',
        description: 'Pano sütununun başındaki hızlı ekleme kutusu, görev oluşturulduktan sonra açık kalmaya devam ediyor (arka arkaya görev eklemek için bilerek böyle) ama artık ilk hâline dönüyor: ad ve tarih temizleniyor, seçili kişiler bırakılıyor ve açık duran atama listesi kapanıyor. Eskiden liste açık kalıyor ve bir sonraki görev önceki atananları sessizce devralıyordu. Yeni listedeki satır da aynı şekilde kendi başlangıç değerlerine dönüyor (gruba göre eklerken grubun değeri korunur).',
      },
    ],
  },
  {
    version: '0.49.0',
    date: '2026-09-23',
    summary: 'Sütun başlığında yalnız sütunun adı var; gerisi adın açtığı menüde.',
    features: [
      {
        title: 'Sütun başlığı tek düğme',
        description: 'Başlıktaki üç nokta menüsü ve sıralama oku kalktı. Artık sütunun adına tıklıyorsun ve tek bir menü açılıyor: artan/azalan sırala, sıralamayı kaldır, filtrele, başa/sona taşı, içeriğe sığdır, gizle. Başlıkta yalnız sütunun adı duruyor; seçili filtre varsa yanında sayısı, sütun sıralamayı belirliyorsa küçük bir ok çıkıyor (ikisi de kontrol değil, durum göstergesi). Sağ tık da aynı menüyü açıyor, genişlik tutamacı ve sürükleyerek sıralama aynen duruyor.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.48.0',
    date: '2026-09-23',
    summary: 'Ana sayfa paneli: katlanan bölümler, sürükleyerek sıralama, altta Düzenle.',
    features: [
      {
        title: 'Ana sayfadaki her bölüm katlanıyor',
        description: 'Görevlerim, Favoriler, Son açılanlar ve Takımlar başlıklarının hepsinde artık ok var; tıklayınca kapanıyor ve kapalı kaldığı hesabında saklanıyor. Eskiden yalnız Favoriler katlanabiliyordu.',
        major: true,
      },
      {
        title: 'Bölümler sürüklenerek sıralanıyor',
        description: 'Bölüm başlığının sağındaki tutamaktan sürükleyip sırayı değiştirebiliyorsun; Düzenle ekranındaki liste de sürüklenebilir oldu (ok düğmeleri duruyor). Ana sayfaya sabitlediğin takımlar da artık kendi sıralarını taşıyor — eskiden eklenme sırasına bakılmadan kenar çubuğunun genel sırasıyla diziliyor ve sürükleme hiçbir şey yapmıyordu.',
      },
      { title: 'Düzenle düğmesi panelin en altına indi' },
    ],
    fixes: [],
  },
  {
    version: '0.47.0',
    date: '2026-09-23',
    summary: 'Yüklü Fira penceresinde başlık çubuğunu uygulama çiziyor.',
    features: [
      {
        title: 'Uygulama olarak yükleyince kendi başlık çubuğu',
        description: 'Fira’yı uygulama olarak yüklediğinde (Yükle düğmesi) artık ayrı bir işletim sistemi başlık çubuğu durmuyor: üst çubuk doğrudan o satıra oturuyor, pencere düğmeleri (küçült/büyüt/kapat) onun sağında kalıyor — Teams’in yüklü sürümündeki gibi. Çubuğun boş yerinden tutup pencereyi sürükleyebiliyorsun; düğmeler ve arama kutusu eskisi gibi çalışıyor. Desteklemeyen tarayıcıda hiçbir şey değişmiyor.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.46.0',
    date: '2026-09-23',
    summary: 'Renkli kod, satır numarası ve editörün içine yerleşen biçim çubuğu.',
    features: [
      {
        title: 'Kod blokları artık renkli',
        description: 'Seçtiğin dile göre sözdizimi renklendirmesi geldi (22 dil). Renklendirici gecikmeli yükleniyor: kod bloğu görmeyen bir ekran o paketi hiç indirmiyor, yani pano açılışı ağırlaşmıyor.',
        major: true,
      },
      {
        title: 'Kod bloklarında satır numarası — isteğe bağlı',
        description: 'Ayarlar → Temalar altındaki anahtarla açılıyor; açıklama, yorum ve sayfalardaki bütün kod bloklarında birden geçerli. Numaralar ayrı bir sütunda duruyor, kopyalarken metne karışmıyor.',
      },
      {
        title: 'Görselleri boyutlandırabiliyorsun',
        description: 'Metindeki bir görsele tıklayınca üstünde ölçü çubuğu (Küçük · Orta · Büyük · Tam genişlik), sağ alt köşesinde de sürükleme tutamacı çıkıyor. “Küçük” aynı zamanda küçük resim (thumbnail) boyu: akışı bozacak bir detay artık metnin içinde yer kaplamıyor. Verdiğin boy markdown’ın başlık alanında saklanıyor (![…](… "w=360")), yani kaydedince ve dışarı kopyalayınca korunuyor.',
      },
      {
        title: 'Markdown tablolarında sütun hizalaması',
        description: 'Tablo satırındaki yeni hizalama düğmeleriyle sütunu sola, ortaya ya da sağa hizalıyorsun; GFM’in :---: ayracına yazıldığı için dışarıdan gelen hizalama da korunuyor (eskiden kaydedince siliniyordu).',
      },
      {
        title: 'Biçim çubuğu editörün içinde',
        description: 'Çubuk artık alanın üstünde yüzen ayrı bir katman değil, kutunun kendi üst satırı; uzun metinde kaydırınca kendi kutusunun üstüne yapışıyor. Eski düzen üç ayrı konumlama yolu (üstte yüz, yer yoksa alta geç, uzun metinde ekrana sabitlen) taşıyordu ve kapanırken altındaki metnin bir pikselini gösteriyordu; o artifakt da bununla birlikte gitti.',
      },
    ],
    fixes: [],
  },
  {
    version: '0.45.0',
    date: '2026-09-22',
    summary: 'Kod blokları, tablolar ve yapıştırılan checklistler elden geçti.',
    features: [
      {
        title: 'Kod bloğunun kendi çubuğu var',
        description: 'Kod bloğunun üstünde dil seçimi (24 dil), satır sayısı ve tek tıkla kopyalama düğmesi duruyor. Satırlar artık kaydırılmıyor: uzun satır alta taşmak yerine blok kendi içinde yatay kayıyor. Uzun blok da sayfayı yutmuyor — yazarken 32 satırdan sonra kendi içinde kayıyor, okurken 20 satırdan sonrası katlanıyor ve “Devamını göster” ile açılıyor. Seçilen dil markdown çitine de yazılıyor (```sql), yani dışarı kopyaladığında korunuyor.',
        major: true,
      },
      {
        title: 'Tablo sütunları içeriğe göre',
        description: 'Tablolar artık sütun sayısına bölünmüyor; her sütun içeriğine göre yer kaplıyor. Dar tablo satırı doldurur, geniş tablo kendi kutusunda yatay kayar. Okurken başlık satırı yukarıda sabit kalıyor ve satırlar bir aralı zebra deseniyle ayrılıyor. Elle genişlik verdiğin tablolar aynen kalır.',
      },
    ],
    fixes: [
      {
        title: 'Yapıştırılan checklist artık tanınıyor',
        description: '“- [ ] madde” biçiminde yapıştırılan bir liste düz metin olarak kalıyordu: biçimlendirme teklifi en az iki markdown işareti arıyordu, saf checklist ise yalnız bir işarete giriyordu. Artık onay kutusu tek başına yetiyor; yapıştırınca “Markdown gibi görünüyor · Biçimlendir” teklifi çıkıyor ve kabul edince gerçek onay kutuları oluyor.',
      },
    ],
  },
  {
    version: '0.44.1',
    date: '2026-09-22',
    summary: 'Yönetim ekranı artık gerçekten “yerine” açılıyor.',
    features: [],
    fixes: [
      {
        title: 'Yönetimi kapatınca bırakılan ekrana dönülüyor',
        description: 'Bir liste açıkken yönetime geçip geri dönmek çalışmıyordu: panel kapanıyor ama ekran yönetimde kalıyordu. Artık yönetim açılınca listedeki seçim de bırakılıyor (vurgu kalkıyor, odak ana alana geçiyor) ve kapatınca — şeritteki düğmeye tekrar basınca, paneli kapatınca ya da Ana sayfa/Takımlar’a geçince — bırakılan ekran geri geliyor. Yönetim panelindeyken ağaçtan bir liste seçmek de doğrudan o listenin panosunu açıyor.',
      },
    ],
  },
  {
    version: '0.44.0',
    date: '2026-09-22',
    summary: 'Yönetim paneli uygulamanın içine taşındı.',
    features: [
      {
        title: 'Yönetim artık ayrı bir sayfa değil',
        description: 'Yöneticiler için sol şeritte “Yönetim” düğmesi var; basınca sekmeler diğer ekranlardaki gibi sol panele, içerik de sağdaki büyük görünüme açılıyor. Düğmenin üzerinde gelen kutusundaki gibi bir rozet duruyor: bekleyen sistem uyarısı sayısı. Şeritteki yerini sürükleyerek değiştirebilirsin, adres de sekme başına ayrı (…/admin/users gibi), yani yer imi olarak saklanabiliyor.',
        major: true,
      },
      {
        title: 'Kullanıcı silme',
        description: 'Kullanıcılar sekmesinde artık “Sil” var. Silmeden önce kişinin ardında ne bıraktığı gösteriliyor (kaç görev, yorum, liste, sayfa, takım açmış); içeriği varsa önce devredilecek kişiyi seçmek gerekiyor, yoksa silme çalışmıyor — kayıtlar birbirine bağlı olduğu için doğrudan silme o içeriği de götürürdü. Devirde takım sahipliği de yeni kişiye geçiyor. Kişisel satırları (üyelik, atama, favori, tercih, bildirim) siliniyor ve işlem denetim kaydına yazılıyor.',
      },
      {
        title: 'Kullanım ısı haritası',
        description: 'Yeni “Kullanım” sekmesi hangi özelliğin ne kadar kullanıldığını gün gün gösteriyor; hiç kullanılmamış olanlar ayrıca listeleniyor. Ölçü, her özelliğin kendi kaydına bakar (görev açma, yorum, etiket, sayfa sürümü, tekrarlayan görev, davet…), yani yazma izidir; yalnız okunan şeyler (pano açmak, arama yapmak) sayılmaz.',
      },
      { title: 'Metriklerde “Bugün” düğmesi; günler artık senin saat dilimine göre bölünüyor (sunucu UTC olduğu için gün 03:00’te değişiyordu)' },
    ],
    fixes: [],
  },
  {
    version: '0.43.0',
    date: '2026-09-22',
    summary: 'Davet kabul edilince haberin oluyor.',
    features: [
      {
        title: 'Üye takıma katılınca bildirim',
        description: 'Davet ettiğin kişi daveti kabul edip takıma girdiğinde gelen kutuna “{kişi} {takım} takımına katıldı” satırı düşüyor. Satır hem daveti gönderene hem takımın sahibine ve yöneticilerine gidiyor, katılan kişinin kendisine gitmiyor. Davet reddedilirse kimseye bildirim çıkmıyor; kabul edilen davetin davet edilendeki satırı eskisi gibi kutudan düşüyor.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.42.2',
    date: '2026-09-22',
    summary: 'Sahipsiz görev artık göze çarpıyor.',
    features: [
      {
        title: 'Atanmamış görevlerde kesik çizgili boş avatar',
        description: 'Kimseye atanmamış görevin atanan yerinde artık kesik çizgili boş bir avatar duruyor — panoda da listede de. Daha önce yalnız başlık tonu bir kademe düşüyordu; o fark tek başına göze çarpmıyordu, çünkü atanan alanı bomboş kalıyor, boşluk da bir şey söylemiyordu. Şimdi sahipsiz iş kendi işaretini taşıyor. İşaretin üzerine tıklayınca atama kutusu açılıyor; başlık tonu da eskisi gibi bir kademe soluk kalmaya devam ediyor.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.42.1',
    date: '2026-09-22',
    summary: 'Gelen kutusu birleştirmesi geri geldi.',
    features: [],
    fixes: [
      {
        title: 'Aynı göreve ait art arda bildirimler yine tek satırda toplanıyor',
        description: 'Bir görevde 3 dakika içinde olan değişiklikler (atama, yorum, durum…) tek bildirim satırında birleşiyor; satırda “+N” rozeti çıkıyor, bildirimi açınca o penceredeki bütün değişiklikler tek tek listeleniyor. Bu davranış tekrarlayan görevler sürümünde sessizce kaybolmuştu: bildirim dağıtım fonksiyonu yalnız yeni “hatırlatma” olayını eklemek için yeniden yazılırken eski bir sürümden kopyalanmış, birleştirme de o sırada düşmüştü. Geri kondu ve bir daha sessizce kaybolmasın diye 14 kontrollük gerileme testi eklendi.',
      },
    ],
  },
  {
    version: '0.42.0',
    date: '2026-09-22',
    summary: 'Liste başlığı: net sınırlar, anlaşılır sürükleme, daraltmaya saygı.',
    features: [
      {
        title: 'Sütun başlıkları elden geçti',
        description: 'Dört şikâyet de giderildi: (1) sütunu sürüklerken nereye düşeceğini gösteren kalın bir çizgi çıkıyor ve bırakma o çizgiye göre yapılıyor; (2) sıralama oku ile ⋯ düğmesi artık başlık metninin üzerine binmiyor, kendi yerleri ayrılmış durumda; (3) başlıklar arasında ince ayraç çizgisi var, üzerine gelince hücre hafifçe aydınlanıyor, yani başlığın nerede başlayıp bittiği belli; (4) ad sütununu elle daraltabiliyorsun — eskiden boşluğu doldurmak için daraltma isteğini geri alıyordu.',
        major: true,
      },
      { title: 'Genişlik tutamacı biraz kalınlaştı ve sürüklerken belirginleşiyor; çift tık yine içeriğe sığdırıyor' },
      { title: 'Ad sütununun ⋯ menüsüne “Kalan alanı doldur” eklendi: elle daralttıktan sonra eski davranışa tek tıkla dönülüyor' },
    ],
    fixes: [],
  },
  {
    version: '0.41.8',
    date: '2026-09-22',
    summary: 'Kopyalarken panoya markdown işaretleri gitmiyor.',
    features: [],
    fixes: [
      { title: 'Açıklama, yorum ve sayfa metninden kopyaladığın yazı panoya markdown olarak gidiyordu: kalın bir metni kopyalayıp dışarıya yapıştırınca yıldızlar da geliyordu (kullanıcı adı, şifre gibi şeylerde can sıkıcıydı). Artık panoya biçimli hâli (zengin metin) ve sade düz metin gidiyor; Fira içinde kopyala-yapıştır biçimi korumaya devam ediyor' },
    ],
  },
  {
    version: '0.41.7',
    date: '2026-09-22',
    summary: 'Sol panelde listeler de katlanabiliyor.',
    features: [
      { title: 'Sayfası olan bir listenin solunda artık ok var: tıklayınca altındaki sayfalar gizleniyor, tekrar tıklayınca geliyor. Klasörlerde olduğu gibi tercih hatırlanıyor (takım ağacıyla birlikte, hesabında)' },
    ],
    fixes: [],
  },
  {
    version: '0.41.6',
    date: '2026-09-22',
    summary: 'Markdown yapıştırınca tek tıkla biçimlendirme teklifi.',
    features: [
      {
        title: 'Yapıştırdığın metin markdown ise biçimlendirmeyi teklif ediyor',
        description: 'Açıklama, yorum ya da sayfa metnine markdown yapıştırdığında (başlık, liste, tablo, kod çiti gibi en az iki işaret varsa) imlecin altında "Markdown gibi görünüyor · Biçimlendir" çıkıyor. Tıklarsan yapıştırdığın metin biçimli hâline dönüşüyor, dokunmazsan düz metin olarak kalıyor ve birkaç saniye sonra teklif kayboluyor. Her yapıştırmayı kendiliğinden dönüştürmüyoruz: kod parçası ya da içinde # geçen düz metin bozulmasın.',
        major: true,
      },
      { title: 'Hatırlatma: "/markdown" komutu da duruyor — metni bir kutuya yapıştırıp biçimli olarak eklemek istersen' },
    ],
    fixes: [],
  },
  {
    version: '0.41.5',
    date: '2026-09-22',
    summary: 'Kimseye atanmamış görevler bir ton soluk görünüyor.',
    features: [
      { title: 'Henüz kimseye atanmamış görevlerin başlığı hem panoda hem listede bir ton soluk: sahipsiz işler bir bakışta ayırt ediliyor. Durum, öncelik ve tarih renkleri değişmiyor, okunaklılık korunuyor' },
    ],
    fixes: [],
  },
  {
    version: '0.41.4',
    date: '2026-09-21',
    summary: 'Gönderilen yorumun taslağı geri gelmiyor.',
    features: [],
    fixes: [
      { title: 'Yorumu gönderdikten sonra görevi yeniden açtığında (ör. bildirimden) taslak metin kutuda yeniden beliriyordu: taslak sunucuda silinmiyor, yalnız yazılmamış sayılıyordu. Artık gönderince gerçekten siliniyor; küçültüp geri dönmek de aynı şekilde çalışıyor' },
    ],
  },
  {
    version: '0.41.3',
    date: '2026-09-21',
    summary: 'Sayfa açıkken üstteki gereksiz "Sayfa" satırı kalktı.',
    features: [
      { title: 'Bir sayfa açıkken liste başlığı satırı gizleniyor: sayfanın kendi konumu ve başlığı zaten üstünde, boş bir "Sayfa" etiketi yer kaplıyordu. Telefonda menü düğmesi yerinde kalıyor' },
    ],
    fixes: [],
  },
  {
    version: '0.41.2',
    date: '2026-09-21',
    summary: 'Biçim çubuğu uzun metinlerde ekranda kalıyor.',
    features: [
      {
        title: 'Biçim çubuğu artık metni takip ediyor',
        description: 'Üç dört sayfalık bir açıklamanın ortasını düzenlerken çubuk metnin en üstünde ya da en altında kalıyor, ekranda görünmüyordu. Artık alanın üstü ekrandan çıkınca çubuk görünen alanın üst kenarına demirliyor ve sen metin içinde gezerken orada kalıyor; alanın sonuna gelince kendiliğinden bırakıyor. Tablo satırı da çubukla birlikte geliyor.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.41.1',
    date: '2026-09-21',
    summary: 'Görevler arasında gezinme: tek Esc kapatır, geri oku nereden geldiğini bilir.',
    features: [
      {
        title: 'Görev penceresinde gezinme düzeldi',
        description: 'Görevden alt göreve, oradan üst göreve geçtiğinde pencereler üst üste yığılıyordu: kapatmak için art arda dört kez Esc gerekebiliyordu. Artık pencere tek bir yüzey: içindeki geçişler (üst görev, alt görev, bağlı görev, kopya) geçmişe yeni kayıt bırakmıyor, Esc ya da ✕ tek seferde kapatıyor ve geldiğin yere (pano, liste, gelen kutusu) dönüyor.',
        major: true,
      },
      { title: 'Üst çubukta geri oku: pencere içinde başka bir göreve geçtiysen bir öncekine döner, üzerine gelince hangi görev olduğunu söyler' },
      { title: 'Bildirimden doğrudan açılan alt görevde geri oku çıkmaz; üst göreve geçersen ok alt göreve dönmeni sağlar, kapatma yine tek adımdır' },
    ],
    fixes: [],
  },
  {
    version: '0.41.0',
    date: '2026-09-21',
    summary: 'Görevi simge durumuna küçült; yarım kalan yorum kaybolmuyor.',
    features: [
      {
        title: 'Küçült ve sağ alttaki çubuk',
        description: 'Görev penceresinin sağ üstündeki yeni "küçült" düğmesi pencereyi kapatır ve görevi sağ alttaki yarı saydam çubuğa bırakır. Satıra tıklayınca görev kaldığın yerden açılır, ✕ çubuktan çıkarır. Çubuk sunucuda tutulur: sekmeyi değiştirsen, sayfayı yenilesen ya da başka bilgisayardan girsen de küçülttüklerin orada durur.',
        major: true,
      },
      {
        title: 'Yorum taslakları saklanıyor',
        description: 'Yarım yazdığın bir yorum artık kaybolmuyor: pencereyi küçültsen, kapatsan ya da sekmeyi değiştirsen bile metin sende kalır ve görevi açtığında kutuya geri konur. Taslağı olan görev, küçültülenler çubuğunda sarı noktayla işaretlenir. Yorumu gönderince taslak silinir.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.40.2',
    date: '2026-09-21',
    summary: 'Gelen kutusu anında açılıyor, liste kaydırdıkça büyüyor.',
    features: [
      {
        title: 'Gelen kutusu hızlandı',
        description: 'Kutu açılırken tüm bildirimleri (150 satır, her satırın bütün ayrıntısıyla) tek seferde çekiyordu. Artık 50\'şer yükleniyor ve listenin sonuna geldikçe kendiliğinden büyüyor; "Daha fazla yükle" düğmesi de var. Satırın ayrıntısı (neyin ne olduğu) yalnız o bildirimi açtığında çekiliyor.',
        major: true,
      },
      { title: 'Liste gelene kadar iskelet satırlar görünüyor; çekmece boş beklemiyor' },
      { title: 'Okunmamış, liste ve görev süzgeçleri sunucuda uygulanıyor: süzülmüş listede ilk sayfa doğrudan doğru satırlarla geliyor' },
      { title: 'Gelen kutusu düğmesinin üzerine gelince ilk sayfa önden yükleniyor' },
    ],
    fixes: [],
  },
  {
    version: '0.40.1',
    date: '2026-09-21',
    summary: 'Tekrarlayan görevler ve hatırlatmalar.',
    features: [
      {
        title: 'Tekrarlayan görevler',
        description: 'Bir görevi açıp özelliklerdeki "Tekrar" satırından "Tekrar ekle" dersen o görev bir serinin şablonu olur: her cuma 12:00, iki haftada bir pazartesi, her ayın 15i gibi. Zamanı gelince yeni görev kendiliğinden doğar — başlık, açıklama, öncelik, atananlar, etiketler ve alt görevler şablondan kopyalanır, görev listenin ilk sütununda açılır. Her tekrar ayrı bir görevdir; böylece hangi hafta yapıldı, hangi hafta gecikildi görünür. Önceki tekrar hâlâ açıkken yenisi gelirse liste yığılmaz: o tekrar "kaçırıldı" olarak kayda geçer ve görevin özelliklerinde sayısı görünür.',
        major: true,
      },
      {
        title: 'Hatırlatma',
        description: 'Tekrar kurarken "Hatırlatma" seçersen (15 dk, 1 sa, 2 sa ya da 1 gün önce) son tarihten önce gelen kutusuna, tarayıcıya ve Telegram bağlıysa telefona bildirim düşer. Bildirim tercihlerinde kendi satırı var, kanalları ayrı ayrı kapatılabilir.',
        major: true,
      },
      { title: 'Tetik seçilebilir: "Takvime göre" (varsayılan) zamanı gelince üretir, "Tamamlanınca" ise sıradakini sen bitirdiğinde açar' },
      { title: 'Liste ayarlarında "Tekrarlayan görevler" bölümü: listedeki bütün seriler, sıradaki tekrar zamanı, durdur ve başlat' },
      { title: 'Saatli son tarih: tekrarlar "cuma 12:00" gibi saat taşıyabiliyor; hatırlatma bu saate göre hesaplanıyor' },
      { title: 'Planlanan tekrarlar listenin sonunda "hayalet" satır olarak görünüyor (henüz görev değiller); istersen "Şimdi oluştur" ile bugünden göreve çevirebilirsin' },
    ],
    fixes: [
      { title: 'Yeni açılan listelerde durum kategorileri boş kalıyordu: "Tamamlandı" tamamlandı sayılmıyor, kutlama çıkmıyor, "kapatılanları göster" süzgeci ve durum araması yanlış çalışıyordu. Varsayılan durumlar artık doğru kategorilerle açılıyor, eski listeler de düzeltildi' },
    ],
  },
  {
    version: '0.39.1',
    date: '2026-09-20',
    summary: 'Arama belirgin biçimde hızlandı; beklerken "sonuç yok" demiyor.',
    features: [
      {
        title: 'Arama hızlandı',
        description: 'Sayfalarda arama her tuşta bütün sayfa içeriklerini yeniden işliyordu (821 sayfa, en büyüğü 355 KB). Katlanmış metin artık satırda hazır duruyor ve son etkinlik tarihi yalnız listeye giren sonuçlar için hesaplanıyor: QA ölçümünde arama 1,38 saniyeden 0,28 saniyeye, iki kelimelik arama 2,5 saniyeden 0,5 saniyeye indi. Sonuçlar ve sıralama aynı.',
        major: true,
      },
    ],
    fixes: [
      { title: 'Arama sürerken kutu "sonuç yok" diyordu; artık dönen çarkla "Aranıyor…" yazıyor ve bir önceki sonuçlar altta kalıyor' },
    ],
  },
  {
    version: '0.39.0',
    date: '2026-09-20',
    summary: 'Liste başlığı tek satır: konum, görünümler, filtre.',
    features: [
      {
        title: 'Yeni liste başlığı',
        description: 'Listenin üstündeki çubuk tek satıra indi. Solda konum: takımın simgesi ve adı / listenin kendi simgesi ve adı — görev penceresindeki breadcrumb’ın aynısı. Takıma tıklayınca kenar çubuğunda o takım açılır, listenin adına tıklayınca liste ayarları. Ortada görünümler (Pano, Liste ve kaydettiğin görünümler), en sağda Filtre. "Kanban" artık "Pano".',
        major: true,
      },
      {
        title: 'Durumlar listenin ayarlarında',
        description: 'Sütunları (durumları) düzenleme, başlıktaki ayrı düğme yerine listenin kendi penceresinde: kenar çubuğunda listeye sağ tıkla → "Listeyi düzenle" ya da başlıktaki liste adına tıkla. Ad, klasör, simge, renk ve durumlar tek yerde. Listeyi düzenleme yetkisi olmayan üyeler aynı yerden yalnız durumları görür ve düzenler.',
        major: true,
      },
      { title: 'Arama başlıktan kalktı: "/" tuşu üstteki arama kutusunu açık listeyle sınırlı açar (liste:"Ad"), oradan yazmaya devam edebilirsin' },
      { title: 'Yeni Ticket düğmesi kaldırıldı; yeni görev için "n" tuşu, üstteki arama kutusu ("yeni görev") ya da sütunun/grubun "Görev ekle" satırı' },
      { title: 'Kaydettiğin görünümler artık başlık satırında, filtrelerle birlikte kaydediliyor' },
    ],
    fixes: [
      { title: 'Liste penceresi klavyeyle doğru çalışıyor: odak pencerenin içinde kalıyor, Esc önce yazdığın alandan çıkıyor, arka plan seçicisi açıkken pencereyi kapatmıyor' },
    ],
  },
  {
    version: '0.38.0',
    date: '2026-09-18',
    summary: 'Komut paletinde akıllı arama ve filtreler.',
    features: [
      {
        title: 'Komut paletinde yazım hatasına dayanıklı arama',
        description: 'Arama artık Türkçe karakter ve büyük/küçük harf farkına bakmaz (sıralama = SIRALAMA = siralama) ve küçük yazım hatalarını tolere eder: 5 harf ve üstü kelimelerde %80 benzerlik yeter ("tamanlamdi" → "Tamamlandı"). Kelimeler görev başlığında esnek, açıklamada birebir aranır; sonuçlar benzerliğe ve son etkinliğe göre sıralanır, görevin durumu yanında görünür.',
        major: true,
      },
      {
        title: 'Arama filtreleri',
        description: '"tam ifade" (birebir), -kelime (hariç tut) ve filtreler: atanan:ben, oluşturan:ad, durum:açık / tamamlandı / gecikmiş / sütun adı, öncelik:yüksek, etiket:, liste:"Web sitesi", takım:, yorum:metin, var:dosya,yorum, tür:sayfa, bitiş:gecikmiş, son:3sa, sonra:2026, önce:2025, tarih:18-09-2026, oluşturma:09-2026. Her filtrenin İngilizce adı da çalışır (assignee:me, last:3h…). Kutuya ? yazınca filtreler örnekleriyle listelenir; bir kelime filtre adına benziyorsa öneri çıkar. Tanınan filtreler kutunun altında etiket olarak görünür, anlaşılmayanlar kırmızı çizili.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.37.1',
    date: '2026-09-18',
    summary: 'Alt görev sırası sabit; sıradaki adım tamamlandıysa yalnız ✓.',
    features: [
      { title: 'Görev penceresinde sıradaki durum zaten "Tamamlandı" ise › (bir sonraki adım) düğmesi gizlenir, yalnız ✓ (tamamlandı olarak işaretle) görünür — ikisi aynı işi yapıyordu' },
    ],
    fixes: [
      { title: 'Alt görevi tamamlayınca (ya da durumunu değiştirince) alt görev listesindeki sırası değişiyordu: "durum değişince sütunun en üstüne" kuralı alt görevlere de uygulanıyordu. Artık alt görev yerinde kalır; kural yalnız üst düzey görevlerde geçerli' },
    ],
  },
  {
    version: '0.37.0',
    date: '2026-09-18',
    summary: 'Yeni üst çubuk ve komut paleti.',
    features: [
      {
        title: 'Üst çubuk ve komut paleti',
        description: 'En üstte uygulamanın tamamına ait yeni bir çubuk var: solda Fira (Ana sayfa), ortada komut paleti, sağda profil ve ayarlar. Açık listeye ait her şey (Kanban/Liste, Filtre, arama, Durumlar, Yeni Ticket) bir satır aşağıda, listenin kendi başlığında. Paleti tıklayarak ya da Ctrl+K ile aç: boşken son açtıkların, yazınca bütün takımlarındaki görevler (ad ya da #kimlik), listeler, sayfalar ve takımlar, ayrıca komutlar gelir. > ile başlarsan (ya da Ctrl+Shift+P) yalnız komutlar: yeni görev, gelen kutusu, görevlerim, görünüm değiştir, ayarlar, tema, yenilikler… ↑/↓ ile gez, Enter ile aç, Esc ile kapat. Telefonda üst çubuktaki arama simgesi paleti tam ekran açar.',
        major: true,
      },
    ],
    fixes: [
      { title: 'Tema paletten ya da Ayarlar\'dan değişince profil menüsündeki tema göstergesi eski kalıyordu ve sistem teması değişince eski seçim geri gelebiliyordu' },
    ],
  },
  {
    version: '0.36.6',
    date: '2026-09-18',
    summary: 'Yöneticilere sunucu diski uyarısı.',
    features: [
      { title: 'Sunucu diski %85\'i geçince yöneticiler her ekranda uyarı çubuğu görür (Yönetim ekranına bağlantıyla) ve Telegram\'dan mesaj alır; %95 üstünde saatte bir hatırlatılır, disk düşünce "normale döndü" mesajı gelir' },
    ],
    fixes: [
      { title: '18 Eylül\'deki kesintinin nedeni sunucu diskinin dolmasıydı; log birikimi, yedek saklama ve deploy kalıntıları kalıcı olarak sınırlandı' },
    ],
  },
  {
    version: '0.36.5',
    date: '2026-09-18',
    summary: 'Yeni listede alt görev eklenince üst görev açılır.',
    features: [],
    fixes: [
      { title: 'Satırdaki + ile alt görev eklerken üst görev katlanmışsa (ya da henüz alt görevi yokken "Daralt" modundaysa) eklenen alt görev görünmüyordu; üst görev artık ekleme sırasında açılır' },
    ],
  },
  {
    version: '0.36.4',
    date: '2026-09-18',
    summary: 'Bağlı görevler: yön değiştirme ve sunucuda arama.',
    features: [
      { title: 'Engelliyor / Bekliyor bağının yönü tek tıkla değiştirilir (⇅ düğmesi, iki taraftan da): engelleyen ile engellenen yer değiştirir' },
    ],
    fixes: [
      { title: '"Görev bağla" araması takımın yalnız en yeni 300 görevine bakıp ilk 40 eşleşmeyi gösteriyordu; eski görevler çıkmıyordu. Arama artık sunucuda (ad + #ID), ilk 50 sonuç ve daraltma uyarısı' },
    ],
  },
  {
    version: '0.36.3',
    date: '2026-09-18',
    summary: 'Tamamlanan görevin adı artık üstü çizili gösterilmiyor.',
    features: [],
    fixes: [
      { title: 'Yeni listede ve görev penceresindeki alt görev satırlarında tamamlanan görevin adı üstü çizili çıkıyordu; artık yalnız soluk renkte (durum ikonu/chip zaten gösteriyor)' },
    ],
  },
  {
    version: '0.36.2',
    date: '2026-09-18',
    summary: 'Yeni liste (beta): hakem incelemesinden çıkan düzeltmeler.',
    features: [
      { title: 'Başlık sütunu akışkan: diğer sütunlardan artan yeri alır (ClickUp gibi); yatay kaydırma yalnız sütunlar sığmayınca' },
      { title: 'Her satırda sabit iki yuva (katlama oku + durum ikonu): aynı seviyedeki başlıklar hizalı, alt görevlerin ikonları üstün altında' },
      { title: 'Duruma göre gruplanınca durum sütunu kendiliğinden gizlenir (grup başlığı ve satır başı ikonu zaten gösteriyor)' },
      { title: 'Açıklama/dosya/yorum/engel göstergeleri emoji yerine tek tip çizgi simge; satır işlemleri (düzenle, paylaş, alt görev) hücrenin sağında toplanır' },
      { title: 'Grup başlığında ve toplu işlem menüsünde öncelik bayrakla; üst görev adı başlığın önünde tek satırda' },
      { title: 'Sütun başlıkları cümle düzeni; görünüm sekmesinde etkin sekme yumuşak tonda; toplu çubukta sayı rozeti, Sil kırmızı' },
    ],
    fixes: [
      { title: 'Yatay kaydırmada üzerine gelinen/seçili satırın sabit başlık hücresi saydamlaşıp altındaki sütunları gösteriyordu; artık opak ve kaydırınca sağ kenarda gölge' },
      { title: 'Klavyeyle satırlar arasında gezerken odaklanan satır yapışkan başlığın altında kalabiliyordu' },
      { title: '"Görev ekle" satırı hesaplanandan 4 px yüksekti (pencereleme kayması); hafifletildi' },
    ],
  },
  {
    version: '0.36.1',
    date: '2026-09-18',
    summary: 'Yeni liste (beta): daha kompakt, ClickUp\'a yakın görünüm.',
    features: [
      { title: 'Satırlar 40 px (sıkı görünümde 32 px), sütunlar daha dar, başlık sütununa daha çok yer; durum ikonu satırın başında (tıklayınca durum seçici), alt görevlerde girintiyle hizalı; ↳ işareti yalnız girintisiz "ayrı görev" modunda' },
      { title: 'Öncelik hücresi yalnız bayrak (orta öncelik gri, önceliksiz boş bayrak); tıklayınca küçük seçici. Durum chip\'i ikonsuz ve küçük' },
    ],
    fixes: [
      { title: 'Başlık sütununun sabit hücresi beyaz kalıyordu; başlık satırıyla aynı gri' },
    ],
  },
  {
    version: '0.36.0',
    date: '2026-09-17',
    summary: 'Yeni liste (beta): büyük listelerde akıcılık.',
    features: [
      { title: 'Uzun listelerde yalnız görünür satırlar çizilir (80 satırdan sonra pencereleme); kaydırma çubuğu ve klavye gezintisi aynı kalır' },
      { title: 'Görevlerim gibi çok listeli görünümler yalnız görünen sütunların verisini çeker (etiket, ek termin, yorum/ek, engel bilgisi gerekmedikçe sorguya girmez)' },
    ],
    fixes: [],
  },
  {
    version: '0.35.0',
    date: '2026-09-17',
    summary: 'Yeni liste (beta): satırları sürükle-bırak ve klavye ile taşı.',
    features: [
      { title: 'Satırı başka bir gruba bırakınca gruplanan alan değişir (durum, öncelik, atanan, etiket, termin, liste); durum grubunda ve sıralama kapalıyken satırlar arası bırakma manuel sırayı da belirler (pano ile aynı sıra)' },
      { title: 'Satırı başka bir satırın üstüne sağa doğru bırakınca alt görevi olur; alt görevi bir ana görevin yanına bırakınca ebeveyninden ayrılır. Bırakma yeri satırda çizgi/girinti ile gösterilir' },
      { title: 'Klavye: ↑/↓ satırlar arasında, Alt+↑/↓ satırı taşır, Ctrl+↑/↓ önceki / sonraki gruba geçirir; dokunmatikte uzun basınca sürükleme' },
    ],
    fixes: [],
  },
  {
    version: '0.34.0',
    date: '2026-09-17',
    summary: 'Yeni liste (beta): Görünüm ayarları menüsü.',
    features: [
      { title: 'Araç çubuğunda "Görünüm" (dişli): kapalı görevleri göster, kapalı alt görevleri göster, boş grupları göster, metni sar, sıkı görünüm (32 px satır), görev özelliklerini göster (açıklama/ek/yorum/engel), etiketleri adın yanında göster, ebeveyn adını göster, Ben modu, görünümü varsayılana sıfırla' },
      { title: 'Ben modu filtreleri değiştirmeden yalnız sana atananları gösterir; araç çubuğunda rozet ile kapatılır. Hepsi görünümle kaydedilir' },
    ],
    fixes: [],
  },
  {
    version: '0.33.0',
    date: '2026-09-17',
    summary: 'Yeni liste (beta): kayıtlı görünümler.',
    features: [
      {
        title: 'Kayıtlı görünümler',
        description: 'Listenin üstünde görünüm sekmeleri: Kanban · Liste · kayıtlı görünümler · +. Gruplama, sıralama, sütunlar, alt görev modu ve filtreler (Kanban için filtreler) bir görünüm olarak kaydedilir; kişisel kalır ya da takımla paylaşılır. Değişiklik yapınca sekmede nokta ve Kaydet / Geri al; "Benim için otomatik kaydet" anahtarı. Sekme menüsü: yeniden adlandır, paylaş, koru (yalnız sahibi ve yöneticiler değiştirir), takım varsayılanı, benim varsayılanım, bağlantıyı kopyala (?v=…), sil. Görevlerim\'de altı dilim yerleşik, kendi görünümlerin yanına eklenir.',
        major: true,
      },
      { title: 'Liste araç çubuğunda CSV indirme: görünen satırlar ve sütunlar' },
    ],
    fixes: [],
  },
  {
    version: '0.32.0',
    date: '2026-09-17',
    summary: 'Yeni liste (beta): çoklu seçim ve toplu işlem çubuğu.',
    features: [
      { title: 'Satırın solundaki kutucukla seçim; Shift ile aralık, Ctrl/Cmd ile ekle-çıkar, grup başlığındaki kutucukla grubun tamamı (kısmi seçimde −), Space ile odaklı satır, Ctrl+A ile görünenlerin tümü, Esc temizler' },
      { title: 'Alttaki çubuk: Durum, Atananlar (ekle/çıkar), Bitiş, Öncelik, Etiketler (ekle/çıkar), Listeye taşı, Kopyala, Alt göreve çevir (ilk seçilenin altına), Görev bağla, Arşivle, Sil (onayla)' },
      { title: '"Bildirim gönder" kapalıyken toplu değişiklik kimseye bildirim düşürmez (tercih hatırlanır); en fazla 500 görev' },
    ],
    fixes: [],
  },
  {
    version: '0.31.0',
    date: '2026-09-17',
    summary: 'Yeni liste (beta): tek satırlık hızlı görev ve alt görev ekleme.',
    features: [
      { title: 'Her grubun sonunda "+ Görev ekle": ad + atanan, tarih (Bugün / Yarın / hafta sonu / gelecek hafta / takvim), öncelik ve etiket düğmeleri; Enter kaydeder ve yeni satır açar, Esc kapatır, boşken dışarı tıklayınca kapanır' },
      { title: 'Gruplu görünümde görev grubun değerini alır; tek değere süzülmüş filtreler (durum, öncelik, kişi, etiket, termin) de yeni göreve uygulanır' },
      { title: 'Ana görev satırındaki + aynı satırla alt görev ekler (kişi, tarih, öncelik, etiketle); Görevlerim\'de satır önce liste seçtirir' },
    ],
    fixes: [],
  },
  {
    version: '0.30.0',
    date: '2026-09-17',
    summary: 'Yeni liste (beta): satır içi düzenleme.',
    features: [
      { title: 'Listede görevi açmadan değiştir: durum (seçici; engelleyen açık görev varsa bir kez sorar, tamamlanınca kutlama), öncelik, bitiş tarihi (Bugün / Yarın / Bu hafta sonu / Gelecek hafta / 2 hafta + takvim + kaldır), etiketler, atananlar' },
      { title: 'Görev adı: satırdaki kalem, çift tık ya da F2 ile yerinde düzenle; Enter kaydeder, Esc vazgeçer' },
      { title: 'Klavye: satır odaklıyken ← → hücreler arasında gezer, Enter hücrenin kontrolünü açar, Esc satıra döner. Yazma izni yoksa hücreler salt okunur' },
    ],
    fixes: [],
  },
  {
    version: '0.29.0',
    date: '2026-09-17',
    summary: 'Yeni liste (beta): sütunlar özelleştirilebilir.',
    features: [
      { title: 'Sütun başlıkları sürüklenerek sıralanır; başlık menüsünden (⋯ ya da sağ tık) sırala, başa/sona taşı, içeriğe sığdır, gizle' },
      { title: 'Araç çubuğundaki "Sütunlar" ve tablonun sağındaki + ile sütun ekle/çıkar: Etiketler, Liste, Güncellenme, Alt görevler, Yorum/ek, ID ve yeni "Ek terminler" (en yakın ek termin + adet)' },
      { title: 'Sütun genişliği kenarından sürüklenir, çift tık içeriğe sığdırır; Ad sütunu solda sabit. Sütun seti, sırası ve genişlikleri liste başına hatırlanır' },
      { title: 'Dar ekranda yalnız Ad, Durum ve Atananlar; gerisi yatay kaydırmada' },
    ],
    fixes: [],
  },
  {
    version: '0.28.0',
    date: '2026-09-17',
    summary: 'Yeni liste (beta): tümünü daralt / genişlet.',
    features: [
      { title: 'Liste araç çubuğunda "Daralt / Genişlet": tüm grupları ya da tüm alt görevleri tek seferde; grup okuna Shift ile tıklamak da aynısını yapar' },
      { title: 'Daraltılan gruplar ve katlanan ana görevler liste başına hatırlanır; açılan satırlar yumuşak görünür (hareket azaltma tercihine uyar)' },
    ],
    fixes: [],
  },
  {
    version: '0.27.0',
    date: '2026-09-17',
    summary: 'Yeni liste (beta): alt görevler ana görevin altında.',
    features: [
      { title: 'Liste araç çubuğunda "Alt görevler": Daralt (yalnız ana görevler, okla yerinde açılır — varsayılan), Genişlet (hepsi ebeveyninin altında açık), Ayrı görev (kendi satırında; filtre ve gruplamaya girer)' },
      { title: 'Alt görev ebeveyninin grubunda kalır; ebeveyni listede olmayan alt görev en üstte ebeveyn adıyla gösterilir; 3 seviye girinti' },
      { title: 'Tamamlanmış alt görevler kapalı görevler gizliyken saklanır, ebeveynde "+N ✓" ipucu; ana görev satırında + ile yerinde alt görev ekleme' },
    ],
    fixes: [],
  },
  {
    version: '0.26.0',
    date: '2026-09-17',
    summary: 'Yeni liste (beta): gruplama seçici, grup başlığından görev ekleme.',
    features: [
      { title: 'Liste araç çubuğunda "Grupla": gruplama yok, durum, atanan, öncelik, etiket, termin (Görevlerim’de liste). Grup başlığında renkli chip, sayaç ve daraltma; "yok" grubu (atanmamış, etiketsiz, tarihsiz) en sonda' },
      { title: 'Birden çok atananı/etiketi olan görev her eşleşen grupta görünür; istersen "birleşik grup" seçeneğiyle her küme tek grup olur' },
      { title: 'Durum gruplamasında boş durumlar da gösterilebilir; her grubun başlığındaki + ile eklenen görev o grubun değerini alır (durum, öncelik, kişi, etiket, tarih)' },
      { title: 'Liste görünümü artık varsayılan olarak duruma göre gruplu; seçimin liste başına hatırlanır' },
    ],
    fixes: [],
  },
  {
    version: '0.25.0',
    date: '2026-09-17',
    summary: 'Yeni liste görünümü (beta): tek liste motoru, gruplama ve sıralama altyapısı.',
    features: [
      {
        title: 'Yeni liste görünümü (beta)',
        description: 'Profil → Görünüm\'den açılır. Liste görünümü ve Görevlerim aynı yeni bileşenle çizilir: sütun başlığından sıralama, adreste paylaşılabilen gruplama/sıralama (?group=&sort=), alt görevler ebeveyninin altında açılıp kapanabilir, Görevlerim\'de "Liste" sütunu. Kapalıyken her şey eskisi gibi. Gruplama seçici, sütun ekleme, satır içi düzenleme ve toplu işlem sıradaki sürümlerde.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.24.2',
    date: '2026-09-17',
    summary: 'Görevlerim açıkken liste seçince pano açılıyor.',
    features: [],
    fixes: [
      { title: 'Ana alanda Görevlerim ya da Son açılanlar açıkken Takımlar ağacından (ya da favorilerden) bir listeye tıklayınca liste açılmıyordu; artık pano görünümüne dönüp o liste açılıyor' },
    ],
  },
  {
    version: '0.24.1',
    date: '2026-09-17',
    summary: 'Uzun sayfa başlığı artık kesilmiyor, alt satıra sarıyor.',
    features: [],
    fixes: [
      { title: 'Sayfa görünümünde uzun başlık düzenleme alanının sağından taşıp kesiliyordu; başlık alanı artık okuma görünümündeki gibi satır satır sarıyor ve metinle birlikte büyüyor (Enter yine alandan çıkar)' },
    ],
  },
  {
    version: '0.24.0',
    date: '2026-09-17',
    summary: 'Sol menü stili: gri şerit ve panel, gezinme modeli, Görevlerim ana alanda.',
    features: [
      {
        title: 'Ana sayfa artık gezinir, listelemez',
        description: 'Ana sayfa paneli Takımlar gibi çalışır: "Görevlerim" altında görünümler (Zamanı geçmiş, Bugün, Bu hafta, Geçen hafta, Tarihsiz, Tümü — sayılarıyla; geciken kırmızı) ve "Son açılanlar" birer satırdır, tıklayınca içerik ana alanda açılır (üstte aynı sekmeler). Favoriler kısa liste olarak panelde kalır. Bölüm başlıkları artık büyük harf değil, satırlar aynı hizada.',
        major: true,
      },
    ],
    fixes: [
      { title: 'Renkler: şerit en gri, panel bir kademe açık, içerik en açık (ClickUp katmanlaması); koyu temada içerik alanı bir ton aydınlatıldı, kartlar içerikten ayrışıyor. Takım adları da büyük harf değil' },
    ],
  },
  {
    version: '0.23.1',
    date: '2026-09-17',
    summary: 'Fotoğraf yakınlaştırmasında kalan kırpışma giderildi.',
    features: [],
    fixes: [
      { title: 'Önizlemede yakınlaştırırken resim bir an sıçrayıp yerine oturuyordu: boyut animasyonu ile kaydırma düzeltmesi farklı karelerde çalışıyordu. Artık resmin yeni boyutu ve kaydırma konumu aynı karede uygulanıyor; imlecin altındaki nokta hiç oynamıyor' },
    ],
  },
  {
    version: '0.23.0',
    date: '2026-09-17',
    summary: 'Sol menünün son hâli: gelen kutusu üstte ve her şeyin üzerine, özelleştirilebilir Ana sayfa.',
    features: [
      {
        title: 'Sol menü: son düzen',
        description: 'Şeritte sıra Gelen kutusu → Ana sayfa → Takımlar; Favoriler şeritten kalktı (Ana sayfanın içinde). Gelen kutusu en üstte ayrı bir düğme: kendi açık/kapalı durumu var, açık panelin durumunu değiştirmez ve panelin ve içeriğin ÜSTÜNE açılır — bir işin ortasında bildirime bakıp aynı yere devam edersin. Ana sayfa artık özelleştirilebilir: sağ üstteki "Düzenle" ile Görevlerim, Favoriler, Son açılanlar ve Takımlar bölümlerini aç/kapat ve sırala; takım başlığının ⋯ menüsündeki "Ana sayfaya ekle" ile bir takımın ağacını Ana sayfada gösterirsin. Şeritteki Ana sayfa / Takımlar sırası sürükleyerek değiştirilebilir; hepsi hesabında saklanır.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.22.5',
    date: '2026-09-17',
    summary: 'Fotoğraf yakınlaştırması kaydırmayı tetiklemiyor; touchpad ve dokunmatik sıkıştırma.',
    features: [],
    fixes: [
      { title: 'Önizlemede tekerlekle yakınlaştırırken kutu aynı anda kayıyor ve görüntü kırpışıyordu; kaydırma artık tamamen engelleniyor. Laptop touchpad iki parmak sıkıştırma (pinch) ve telefonda iki parmakla sıkıştırma da yakınlaştırıyor; tek parmak ve fareyle sürükleme kaydırıyor' },
    ],
  },
  {
    version: '0.22.4',
    date: '2026-09-17',
    summary: 'Durum satırında "bir sonraki adım" ve "tamamlandı" düğmeleri.',
    features: [
      { title: 'Görev penceresinde durum seçicinin sağına iki kare düğme geldi: › bir sonraki adıma geçirir (panodaki soldan sağa sütun sırası; son sütunda pasif), ✓ görevi doğrudan listenin tamamlandı durumuna alır (üzerine gelince yeşil; engelleyen görev uyarısı ve kutlama aynen). Yalnız yazma yetkisi olanlarda görünür' },
    ],
    fixes: [],
  },
  {
    version: '0.22.3',
    date: '2026-09-16',
    summary: 'Fotoğrafta pürüzsüz yakınlaştırma; açılır pencere titremesi giderildi.',
    features: [
      { title: 'Fotoğraf önizlemesinde yakınlaştırma artık kademesiz: fare tekerleği imlecin bulunduğu noktayı sabit tutarak yumuşakça yakınlaştırır/uzaklaştırır, büyümüş resim sürüklenerek kaydırılır, çift tık yakınlaştırır/sığdırır, +/- düğmeleri ve tuşları yüzde 25 adımlarla akıcı büyür' },
    ],
    fixes: [
      { title: 'Görev görünümü "açılır pencere" seçiliyken, sayfa yeni yüklendiğinde pencereden hemen önce tam boyutlu görev görünümü bir an açılıp kapanıyordu; artık tercih gelene kadar hiçbir çerçeve çizilmiyor' },
    ],
  },
  {
    version: '0.22.2',
    date: '2026-09-16',
    summary: 'Şeritte "Ana sayfa": gelen kutusu, görevlerim, favoriler, takımlar tek panelde.',
    features: [
      { title: 'Şeridin başına "Ana sayfa" eklendi: paneli gelen kutusu ve takımlar kısayolları, bütün listelerdeki sana atanmış açık görevler (bitiş tarihine göre, geciken kırmızı), favoriler ve son açılanlar tek yerde toplar' },
    ],
    fixes: [],
  },
  {
    version: '0.22.1',
    date: '2026-09-16',
    summary: 'Sol şerit sabit ve adlı; Takımlar tek panelde.',
    features: [],
    fixes: [
      { title: 'Sol şerit artık genişlemiyor: simgelerin altında adları var (Gelen kutusu, Favoriler, Takımlar; altta Yükle ve sürüm). "Takımlar"a basınca bütün takımların ağacı (klasörler, listeler, sayfalar) şeridin yanında tek panelde açılır ve açık kalır; "Favoriler" kendi panelini açar; aynı düğme ya da ✕ kapatır. Yeni özellikler bundan sonra bu şeride eklenecek' },
    ],
  },
  {
    version: '0.22.0',
    date: '2026-09-16',
    summary: 'Görevi kopyalama ve başka listeye taşıma.',
    features: [
      {
        title: 'Kopyala ve Listeye taşı',
        description: 'Kartın sağ tık menüsünde ve görev penceresinin altında iki yeni işlem var. "Kopyala" görevin bir kopyasını (alt görevleri, atananları, etiketleri, ekleri ve son tarihleriyle; yorumlar ve bağlantılar hariç) aynı listenin aynı sütununun en üstüne "(kopya)" ekiyle koyar. "Listeye taşı…" görevi alt görevleriyle birlikte takımın başka bir listesine götürür; durum hedefteki aynı adlı sütun (yoksa ilk sütun) olur, etiketler ada göre eşlenir. Taşıma etkinlik geçmişine "X listesinden Y listesine taşıdı" olarak yazılır.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.21.6',
    date: '2026-09-16',
    summary: 'Sol şerit tıklayınca açılıyor, açılınca üstüne biniyor.',
    features: [],
    fixes: [
      { title: 'Sol şerit artık fareyle üstüne gelince değil, Fira işaretine tıklayınca genişliyor; genişleyince panelin ve içeriğin üstüne biniyor (hiçbir şeyi itmiyor). Dışına tıklamak, Esc, üstteki ‹ ya da bir takım/favori seçmek daraltıyor. Raptiye (sabitleme) kaldırıldı' },
    ],
  },
  {
    version: '0.21.5',
    date: '2026-09-16',
    summary: 'Başka sütuna bırakılan kart gösterilen yere iniyor.',
    features: [],
    fixes: [
      { title: 'Kartı başka bir sütuna sürüklerken sütuna girdiğin noktadan sonra aşağı/yukarı kaydırırsan, kartlar önizlemede yer açıyor ama bırakınca kart sütuna ilk girdiği sıraya iniyordu (bir-iki satır yukarıda/aşağıda). Artık bırakılan yer önizlemeyle aynı' },
    ],
  },
  {
    version: '0.21.4',
    date: '2026-09-16',
    summary: 'Sol menüde ince ayarlar.',
    features: [],
    fixes: [
      { title: 'Sol şerit fare üstünden geçerken hemen açılmıyor (kısa bir bekleme var); bir takıma tıklayınca genişlemiş şerit kendiliğinden daralıyor; Esc daraltıyor; sistemde "hareketi azalt" açıksa genişleme animasyonsuz; takım simgelerinde harf kontrastı artırıldı' },
    ],
  },
  {
    version: '0.21.3',
    date: '2026-09-16',
    summary: 'İşlemli yorumlar renkli bir kutuda.',
    features: [],
    fixes: [
      { title: 'Yorumla birlikte ata/kapat/bloke et yapılan yorumlar artık yalnız küçük bir etiketle değil, yorum kutusunun kendisiyle belli oluyor: kutu o işlemin rengini alıyor (yeşil kapatma, turuncu bloke, mavi atama), üstünde simgeli bir şerit ne yapıldığını söylüyor, altında yorum metni duruyor' },
    ],
  },
  {
    version: '0.21.2',
    date: '2026-09-16',
    summary: 'Sertifikası kurulu olmayan bilgisayarda görseller görünmüyordu.',
    features: [],
    fixes: [
      { title: 'Sertifikası kurulu olmayan (uyarıyı geçerek giren) ya da Fira\'yı başka adresten açan bir bilgisayarda açıklama/yorum görselleri, ekler, kapaklar ve profil fotoğrafları görünmüyordu (ERR_CERT_AUTHORITY_INVALID). Dosya adresleri artık sayfanın açıldığı adres üzerinden gösteriliyor. Sertifika dosyası da uygulamadan indirilebiliyor: /fira-ca.crt' },
    ],
  },
  {
    version: '0.21.1',
    date: '2026-09-16',
    summary: 'Sol menü VS Code düzeninde: hep duran şerit, yana açılan adlar, takım başına yanında açılan panel.',
    features: [
      {
        title: 'Yeni sol menü',
        description: 'Solda hep duran ince bir şerit: gelen kutusu (okunmamış rozetiyle), favoriler ve katıldığın takımların simgeleri. Üstüne gelince şerit yana doğru genişler ve simgelerin adları yanlarında belirir (simgeler yerinden oynamaz); raptiye ile hep geniş kalabilir. Bir takıma tıklayınca o takımın klasörleri, listeleri ve sayfaları şeridin yanında ikinci bir panelde açılır ve açık kalır; başka takıma tıklayınca panelin içeriği değişir, aynı simgeye tekrar tıklamak ya da ✕ paneli kapatır. Favoriler de aynı panelde. Panelin genişliği sürüklenebilir; açık panel ve sabitleme hesabında hatırlanır; telefonda aynı düzen çekmece olarak çalışır.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.20.2',
    date: '2026-09-16',
    summary: 'Yeni sürüm kendiliğinden geliyor; Yenile artık gerçekten yeniliyor.',
    features: [],
    fixes: [
      { title: 'Her küçük sürümde "Yeni sürüm hazır" çubuğu çıkıyordu. Artık bekleyen sürüm sen sekmeden ayrılınca ya da 3 dakika boşta kalınca kendiliğinden uygulanır — yazmakta olduğun bir yorum, açıklama ya da sayfa varsa ya da imleç bir alandaysa beklenir. Sekme kullanımdayken çubuk yine görünür, ✕ yalnız gizler' },
      { title: '"Yenile" bazen eski sürümde kalıyordu (çubuk göründükten sonra daha yeni bir paket geldiğinde ya da tarayıcı yeni çalışanı devreye almadığında). Artık yeni çalışanın sayfayı devralması beklenir; olmazsa bütün önbellek temizlenip sayfa sunucudan yeniden yüklenir — sonuç her zaman güncel sürümdür' },
    ],
  },
  {
    version: '0.20.1',
    date: '2026-09-16',
    summary: 'Yorumla birlikte ata, kapat ya da bloke et.',
    features: [
      {
        title: 'Yorumla birlikte işlem',
        description: 'Yorum yazarken altındaki "Bu yorumla birlikte:" satırından bir kişi seçebilir (Ata…), görevi kapatabilir (Kapat) ya da bloke edebilirsin (Bloke et). Gönder düğmesi "Gönder ve kapat" gibi ne yapacağını söyler; önce yorum gider, sonra değişiklik yapılır, aktivite de o sırayla yazılır. Yorumun yanında "kapattı · Tamamlandı", "Ali kişisini atadı" gibi bir rozet kalır. Kapat, listedeki tamamlandı kategorili durumu; Bloke et, bloke kategorili durumu kullanır — listede yoksa düğme sönük durur ve nedenini söyler.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.20.0',
    date: '2026-09-16',
    summary: 'Yorumda ve açıklamada @ ile kişi anma.',
    features: [
      {
        title: '@ ile bahsetme',
        description: 'Yorum ya da açıklama yazarken @ yazıp takım arkadaşının adını seçebilirsin; metinde renkli bir etiket olarak durur. Anılan kişiye "senden bahsetti" bildirimi gider — göreve atanmış olmasa, hatta görevi sessize almış olsa bile. Bildirim kutusu, anlık uyarı ve Telegram üçü de bunu bilir; Ayarlar → Bildirimler bölümünde "Benden bahsedildiğinde" satırından açılıp kapatılır (varsayılan açık).',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.19.4',
    date: '2026-09-16',
    summary: 'Kendi kendine çakışma uyarısı kalktı.',
    features: [],
    fixes: [
      { title: 'Metni hızlı değiştirirken "eşzamanlı düzenleme çakışması" uyarısı çıkabiliyordu: bir önceki kayıt sunucudan dönmeden ikinci kayıt gidiyor ve kendi yazdığınla çakışıyordu. Kayıtlar artık sırayla gider; son yazan sen isen (başka sekme dâhil) uyarı yerine sessizce üstüne yazılır — sayfalarda diğer kopya sürüm geçmişine düşer. Uyarı yalnız gerçekten başka biri yazdıysa çıkar' },
    ],
  },
  {
    version: '0.19.3',
    date: '2026-09-15',
    summary: 'Tam ekranda geniş görünüm seçeneği.',
    features: [
      { title: 'Tam ekranda "Geniş görünüm": metin okunaklı okuma sütununda kalmak yerine pencerenin tamamını kullanır — geniş tablolar için. Düğme tam ekran çubuğunda (okuma) ve araç çubuğunda (yazma); seçim hesabında hatırlanır' },
    ],
    fixes: [],
  },
  {
    version: '0.19.2',
    date: '2026-09-15',
    summary: 'Kenar çubuğunda açık/kapalı durumu hatırlanıyor.',
    features: [],
    fixes: [
      { title: 'Bir takımı, klasörü ya da sayfa dalını kapatınca sayfa yenilendiğinde tekrar açık geliyordu; açık/kapalı durumu artık hesabında saklanıyor ve her cihazda aynı açılıyor ("Tümünü aç / Tümünü kapat" dâhil)' },
    ],
  },
  {
    version: '0.19.1',
    date: '2026-09-15',
    summary: 'Paylaşma bağlantısında görev başlığı.',
    features: [],
    fixes: [
      { title: 'Paylaş düğmesinin kopyaladığı bağlantının metninde artık kısa kimliğin yanında görevin başlığı da var: Teams’e yapıştırınca "#81EE7B Paylaşma, link olarak" görünüyor, düz metinde "[#81EE7B Paylaşma, link olarak](adres)"' },
    ],
  },
  {
    version: '0.19.0',
    date: '2026-09-15',
    summary: 'Favoriler ve son açılanlar kenar çubuğunda.',
    features: [
      {
        title: 'Favoriler',
        description: 'Bir görevi, sayfayı ya da listeyi satır menüsünden "Favorilere ekle" ile (görev penceresinde başlığın yanındaki yıldızla, kartta sağ tık menüsünden) kenar çubuğunun tepesindeki Favoriler bölümüne sabitleyebilirsin. Favoriler sana özel; başka cihazda da aynı.',
        major: true,
      },
      {
        title: 'Son açılanlar',
        description: 'Favorilerin altında en son açtığın görevler, sayfalar ve listeler (en yeni üstte, en çok 8). Bir şeyi tekrar bulmak için aramaya gerek kalmıyor; istemediğini satır menüsünden listeden kaldırabilirsin.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.18.3',
    date: '2026-09-15',
    summary: 'Tabloya kendi genişliğini verebilirsin.',
    features: [
      {
        title: 'Geniş tablo',
        description: 'Tablo araç çubuğunda "Genişlik" kutusu var: tabloya px, rem ya da yüzde olarak kendi genişliğini verebilirsin (ör. 1200px). Alan dar kalırsa tablo kendi içinde yana kayar; içinde bulunduğu yorum, açıklama ya da sayfa genişlemez, metin akışı bozulmaz. "Sığdır" ile eski hâline döner. Genişlik metinle birlikte saklanır, tekrar açtığında da öyle görünür.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.18.2',
    date: '2026-09-15',
    summary: 'Yorum kutusu yazarken tam görünüyor.',
    features: [],
    fixes: [
      { title: 'Uzun bir yorum yazarken biçim çubuğu yazdığın ilk satırların üstüne oturuyor ve metin alanı bir buçuk satır görünüyordu; yorum kutusunda çubuk artık kutuyla birlikte kayıyor, kutu ekranın yarısına kadar büyüyüp sonra kendi içinde kayıyor ve "Gönder" düğmesi hep görünür kalıyor' },
      { title: 'Gönderilmiş yorumlar da açıklama gibi tam ekran açılabiliyor: uzun bir yorumun üstüne gelince sağ üstte ⤢ düğmesi çıkıyor' },
      { title: 'Biçim çubuğu üstte yer yoksa alana alta geçiyor: tam görev görünümünde yorum kutusu panelin en üstünde durduğu için çubuk kırpılıyordu' },
      { title: 'Panoda "tamamlananları gizle" açıkken tamamlanan kart konfeti bitmeden aniden kayboluyordu; kart artık animasyon bitene kadar duruyor, sonra yumuşakça soluyor' },
    ],
  },
  {
    version: '0.18.0',
    date: '2026-09-15',
    summary: 'Tamamlanan kartta konfeti.',
    features: [
      {
        title: 'Yeni bitirme kutlaması: kartın içinde konfeti',
        description: 'Bir görev tamamlandığında kartın üzerine kocaman bir onay işareti çizilip başlığın üstüne taşıyordu. Artık kartın içinde konfeti patlıyor: taşacakmış gibi duruyor ama kartın kenarında kesiliyor. Profil menüsü › Temalar › Bitirme kutlaması altında iki konfetiden birini seçip örnek kartta deneyebilirsin. Durum yuvarlağı olan yerlerde (görev penceresi, liste satırı) yuvarlağın üstüne çizilen tik animasyonu aynen duruyor.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.17.2',
    date: '2026-09-15',
    summary: 'Kenar çubuğunda liste sıralama düzeldi.',
    features: [],
    fixes: [
      { title: 'Kenar çubuğunda bir listeyi başka bir listenin yanına sürüklemek çoğu zaman hiçbir şey yapmıyordu: satırlar sürükleme sırasında kayıyor, imlecin altındaki hedef kaçıyordu. Liste satırları artık yerinde duruyor, üst yarısına bırakınca üstüne, alt yarısına bırakınca altına geçiyor ve nereye düşeceği ince bir çizgiyle görünüyor' },
      { title: 'Takımları sürükleyip sıralamak da çalışmıyordu (takım tutuluyor ama bırakılınca sıra değişmiyordu); takım başlıkları artık aynı yöntemle bırakılıyor, üst/alt yarısına göre yerleşiyor ve hedef çizgiyle gösteriliyor' },
    ],
  },
  {
    version: '0.17.1',
    date: '2026-09-15',
    summary: 'Liste görünümünde sütun başlığından filtreleme.',
    features: [
      { title: 'Liste görünümünde Durum, Öncelik, Atananlar ve Bitiş tarihi başlıklarına tıklayınca üstteki Filtre menüsündeki seçim listesinin aynısı sütunun yanında açılıyor; seçim aynı filtreye yazıyor, başlıkta kaç seçim olduğu görünüyor ve "Bu sütunun filtresini temizle" ile yalnız o sütunun seçimi kalkıyor' },
    ],
    fixes: [],
  },
  {
    version: '0.17.0',
    date: '2026-09-15',
    summary: 'Uygulama içinden çoklu takım daveti.',
    features: [
      {
        title: 'Fira kullanıcılarını uygulamadan davet et',
        description: 'Takım ayarları › Üyeler bölümünde artık Fira hesabı olan kişileri arayıp çoklu seçimle davet edebilirsin. Davet, kişinin Fira gelen kutusuna düşer; oradan tek tıkla kabul eder ya da reddeder — bağlantı kopyalayıp başka bir kanaldan yollamak gerekmez. Daveti henüz kabul etmeyenler üye listesinde "davet edildi" olarak görünür, davet iptal edilince kutudaki satır da kalkar.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.16.1',
    date: '2026-09-15',
    summary: 'Excel/CSV/Planner aktarımı da arka planda çalışıyor.',
    features: [
      {
        title: 'Tablodan içe aktarma artık arka plan işi',
        description: 'OneNote aktarımındaki düzen Excel, CSV ve Microsoft Planner aktarımına da geldi: aktarım Takım ayarları penceresine bağlı değil, pencereyi kapatsan da sürüyor. Sağ altta ilerleme çubuğu, geçen süre ve satır satır günlük var; "Durdur" ile yarıda bırakabilirsin — o ana kadar oluşan görevler kalır. Bittiğinde kaç görev ve kaç kişi kaydı oluştuğu, hata veren satır varsa sayısı yazıyor.',
        major: true,
      },
    ],
    fixes: [
      { title: 'Takım ayarları penceresi klavyeye kapalıydı: artık diyalog olarak tanınıyor, Tab pencerenin içinde dönüyor ve kapanınca odak geldiği yere dönüyor' },
    ],
  },
  {
    version: '0.16.0',
    date: '2026-09-15',
    summary: 'Görevi tek tıkla paylaşılabilir bağlantı olarak kopyala.',
    features: [
      {
        title: 'Paylaş: bağlantıyı kopyala',
        description: 'Kartın üzerine gelince başlığın yanında bir zincir düğmesi çıkıyor; tıklayınca görevin adresi panoya kopyalanıyor. Teams, Outlook gibi zengin metin kutularına yapıştırınca tıklanabilir "#ABC123" bağlantısı, düz metin kutularına yapıştırınca "[#ABC123](adres)" olarak iniyor. Aynı işlem liste görünümünde satır başlığının yanında, kartın sağ tık menüsünde ve görev penceresinde başlığın sağında.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.15.6',
    date: '2026-09-15',
    summary: 'Profil fotoğrafları yetim dosya sayılıp silinmiyor.',
    features: [],
    fixes: [
      { title: 'Yönetim › Yetim dosyalar taraması profil fotoğraflarını yetim sanıyordu: fotoğraf adresi önbellek kırmak için "?t=…" ile bittiği hâlde tarama bu eki yola dâhil ediyor, eşleşme tutmuyordu. Temizlik sırasında silinen profil fotoğrafı sunucu yedeğinden geri yüklendi' },
      { title: 'Dosyası bulunamayan profil fotoğrafı artık kırık görsel simgesi yerine baş harflere düşüyor (görev kartı, liste, gelen kutusu, profil ayarları)' },
    ],
  },
  {
    version: '0.15.5',
    date: '2026-09-15',
    summary: 'Madde ve görev kutusu karışık listeler kaydedince bozulmuyor.',
    features: [],
    fixes: [
      { title: 'Aynı listede hem düz madde hem görev kutusu varsa (elle yazılan ya da içe aktarılan metinlerde) açılıp kaydedilince listenin başına boş bir kutu, araya "[ ]" yazılı bir madde ekleniyordu; kutulu ve kutusuz maddeler artık kendi listelerine ayrılıyor, numaralı listede numaralar korunuyor' },
    ],
  },
  {
    version: '0.15.4',
    date: '2026-09-15',
    summary: 'Sunucu yedekleri tek tek, boyutlarıyla listeleniyor.',
    features: [],
    fixes: [
      { title: 'Yönetim › Yedek & Storage sunucu yedeklerinde yalnız tarih görünüyordu; artık her yedek dosyası tür (veritabanı / dosyalar), boyut, tarih ve yaşıyla listeleniyor, üstte saklama süresi ve toplamlar, varsa son hata yazıyor' },
    ],
  },
  {
    version: '0.15.3',
    date: '2026-09-15',
    summary: 'Yüklenen listelerde dönen gösterge.',
    features: [],
    fixes: [
      { title: 'Uzun süren listeler (yetim dosyalar, günlükler, kullanıcılar, sayfa sürümleri, çöp kutusu, üyeler) yüklenirken boş görünüyordu; artık dönen bir gösterge ve "Yükleniyor…" yazıyor' },
    ],
  },
  {
    version: '0.15.2',
    date: '2026-09-15',
    summary: 'Yetim dosya listesi yeniden çalışıyor.',
    features: [],
    fixes: [
      { title: 'Yönetim › Yedek & Storage’daki yetim dosya listesi hata veriyordu (sunucu 8 saniyede zaman aşımına düşürüyordu); sorgu yeniden yazıldı, 4-5 saniyede sonuç dönüyor' },
      { title: 'Liste artık toplam sayıyı ve toplam boyutu da gösteriyor; çok sayıda dosya varsa ilk 1000 listeleniyor ve "Temizle" bunları parça parça siliyor (tek devasa istek yerine)' },
    ],
  },
  {
    version: '0.15.1',
    date: '2026-09-14',
    summary: 'Yönetim panelinde sayfalar.',
    features: [
      { title: 'Yönetim panelinde yeni "Sayfalar" sekmesi: takımlara göre sayfa, aktarılan sayfa, sürüm ve çöp kutusu sayıları; süresi dolmak üzere olan sayfalar' },
      { title: 'Genel Bakış ekranında iki yeni kart: sayfalar (aktarılan / sürüm / çöpte) ve bekleyen AI istekleri' },
    ],
    fixes: [],
  },
  {
    version: '0.15.0',
    date: '2026-09-14',
    summary: 'Kenar çubuğunda her şey sürüklenebiliyor.',
    features: [
      { major: true, title: 'Sayfalar ve klasörler de sürüklenebiliyor', description: 'Artık kenar çubuğundaki her şey sürüklenir: takımlar sıralanır, klasörler hem sıralanır hem başka bir klasörün içine taşınır, sayfalar sıralanır ve klasöre, listeye ya da başka bir sayfanın altına (alt sayfa olarak) taşınır. Kural her yerde aynı: satırın ortasına bırakırsan içine girer, üst ya da alt kenarına bırakırsan o satırın yanına yerleşir — sürüklerken çerçeve ya da çizgi nereye düşeceğini gösterir. Bir klasörü kendi içine, bir sayfayı kendi alt sayfasının altına bırakmak engellenir; takımlar arası taşıma şimdilik yok.' },
    ],
    fixes: [],
  },
  {
    version: '0.14.0',
    date: '2026-09-14',
    summary: 'Klasörü içindekilerle silme ve tek hamlede aç/kapat.',
    features: [
      { major: true, title: 'Klasörü içindekilerle sil', description: 'Klasör menüsünde (⋯ ya da sağ tık) yeni bir seçenek: "Klasörü içindekilerle sil…". Eskiden klasörü silmek içindekileri bir üst seviyeye taşıyordu, önce elle boşaltmak gerekiyordu. Onay penceresi neyin gideceğini sayılarla yazar: alt klasörler ve listeler (görevleriyle birlikte) kalıcı olarak silinir, klasördeki sayfalar çöp kutusuna gider ve 60 gün içinde geri alınabilir. Eski "içindekiler kalır" seçeneği duruyor.' },
      { title: 'Klasör ve takım menüsünde "Tümünü aç" / "Tümünü kapat": alt klasörler ve sayfalar tek hamlede açılıp kapanıyor' },
    ],
    fixes: [],
  },
  {
    version: '0.13.2',
    date: '2026-09-14',
    summary: 'Aktarım günlüğü uzun aktarımlarda da sonu takip ediyor.',
    features: [],
    fixes: [
      { title: 'OneNote aktarım günlüğü, satır sayısı üst sınıra ulaştıktan sonra yeni satırlar eklendikçe kendiliğinden aşağı kaymayı bırakıyordu; artık yukarı kaydırıp tekrar en alta indiğinde de takip etmeye devam ediyor' },
    ],
  },
  {
    version: '0.13.1',
    date: '2026-09-11',
    summary: 'Aktarım sırasında açılan sayfa boşalmıyor.',
    features: [],
    fixes: [
      { title: "0.13.0'da, OneNote aktarımı sürerken o takımdan bir sayfa açılınca sayfa boş hâliyle kaydedilebiliyordu; düzeltildi (yalnız sayfada yazı yazılmışsa kilitlenmeden önce kaydedilir)" },
      { title: 'Durdurulan aktarımın kutusunda "Bitti:" yerine yalnız sayılar yazıyor' },
    ],
  },
  {
    version: '0.13.0',
    date: '2026-09-11',
    summary: 'OneNote aktarımı arka planda sürüyor; ilerlemesi ve günlüğü sağ altta.',
    features: [
      { major: true, title: 'Arka planda OneNote aktarımı', description: "Aktarım artık pencereye bağlı değil: pencereyi kapatmak, Esc ya da dışarı tıklamak onu durdurmaz. Sağ alttaki kutu uygulamanın her yerinde ilerlemeyi, sürmekte olan bölümü ve geçen süreyi gösterir; 'Günlüğü göster' her adımı süresiyle listeler (okunan sayfalar, yüklenen dosyalar, yazılan sayfalar ve sürümler). Durdurmak ayrı ve onaylı bir düğme; bitince 'Raporu aç' raporu getirir." },
      { title: 'Aktarım sürerken o takımın sayfaları ve klasörleri düzenlemeye kapalı; kenar çubuğunda takımın yanında "Aktarılıyor" yazar, sayfada bir uyarı çıkar' },
      { title: 'OneNote dönüştürücüsü ayrı bir iş parçacığında (Web Worker) çalışıyor: aktarım sürerken uygulamanın geri kalanı donmuyor' },
      { title: 'Aktarım penceresinde "Aktarımı başlat" düğmesi, bölüm listesi ne kadar uzun olursa olsun pencerenin altında sabit duruyor' },
    ],
    fixes: [],
  },
  {
    version: '0.12.14',
    date: '2026-09-11',
    summary: 'Görselden sonra gelen başlık ve paragraflar kayıtta bozulmuyor.',
    features: [],
    fixes: [
      { title: 'Açıklama, yorum ya da sayfada bir görselin hemen ardından gelen başlık, paragraf veya liste kaydederken görselin satırına yapışıyor, bir sonraki açılışta başlık düz yazıya dönüşüyordu' },
    ],
  },
  {
    version: '0.12.13',
    date: '2026-09-11',
    summary: "OneNote'tan kod parçaları kod bloğu olarak geliyor.",
    features: [],
    fixes: [
      { title: "OneNote'a yapıştırılmış kod (Courier New, Consolas gibi eş aralıklı yazı tipinde satırlar) düz paragraf olarak geliyor, girintisi kayboluyordu; artık girintisiyle kod bloğu, cümle içindeki eş aralıklı sözcükler satır içi kod oluyor" },
    ],
  },
  {
    version: '0.12.12',
    date: '2026-09-11',
    summary: "Metindeki dosyaya tıklayınca önizleme açılıyor; metinden silinen dosya Dosyalar'dan da gidiyor.",
    features: [
      { title: "Açıklama, yorum ya da sayfadaki bir görsele veya dosya bağlantısına tıklayınca Dosyalar'daki önizleme açılıyor (yakınlaştırma, indirme, PDF/video/metin, ←/→ ile metindeki diğer dosyalar)" },
      { title: "Açıklamadan çıkarılan, silinen yorumdaki ya da yorum taslağından çıkarılıp gönderilen dosya Dosyalar'dan da siliniyor; aynı dosya görevin başka bir metninde ya da kapakta geçiyorsa kalıyor" },
    ],
    fixes: [
      { title: 'Düzenlenebilir açıklamada görselin üstünde büyüteç imleci çıkıyor ama tıklayınca hiçbir şey olmuyordu' },
    ],
  },
  {
    version: '0.12.11',
    date: '2026-09-11',
    summary: 'Tablo düğmeleri biçim çubuğunda.',
    features: [],
    fixes: [
      { title: 'Tablo düğmeleri (satır/sütun ekle-sil, başlık satırı, tabloyu sil) editörün altındaydı ve uzun metnin başındaki bir tabloda görünmüyordu; artık imleç tablodayken biçim çubuğunun ikinci satırında' },
    ],
  },
  {
    version: '0.12.10',
    date: '2026-09-11',
    summary: 'Uzun metinlerde biçim çubuğu ekranda kalıyor.',
    features: [],
    fixes: [
      { title: 'Uzun bir açıklama ya da sayfada aşağı indikçe biçim çubuğu ekranın dışında kalıyordu; artık metin alanı görünür olduğu sürece ekranın üstünde sabit duruyor' },
    ],
  },
  {
    version: '0.12.9',
    date: '2026-09-11',
    summary: 'OneNote bölümleri klasör olarak geliyor.',
    features: [
      { title: 'OneNote içe aktarma defterin yapısını birebir kuruyor: bölüm grupları ve bölümler iç içe klasör, OneNote sayfaları o klasörlerde sayfa, alt sayfalar alt sayfa. Daha önce bölümler birer sayfaydı; defteri yeniden aktarınca sayfalar bölümün klasörüne taşınır, boş bölüm sayfası kalkar (Fira’da içine bir şey yazdıysanız klasörde sayfa olarak kalır)' },
    ],
    fixes: [],
  },
  {
    version: '0.12.8',
    date: '2026-09-11',
    summary: 'PDF, video ve metin dosyaları için önizleme.',
    features: [
      { title: 'Dosyalar bölümünde küçük resimler: PDF’in ilk sayfası, videonun bir karesi (oynat işaretiyle), metin dosyalarının (txt, csv, json, md, sql…) ilk satırları; Word, Excel, PowerPoint, arşiv ve ses dosyaları türüne göre renkli simgeyle. Önizleme penceresinde video oynuyor, PDF sayfa sayfa (ilk 50 sayfa), metin dosyası metin olarak görünüyor' },
    ],
    fixes: [],
  },
  {
    version: '0.12.7',
    date: '2026-09-11',
    summary: 'Bildirime tıklayınca gelen kutusunda o bildirim açılıyor.',
    features: [
      { title: 'Ekrandaki bildirim kutucuğuna ya da tarayıcı bildirimine tıklayınca artık görev değil, gelen kutusu açılıyor ve o bildirim seçili geliyor (ne değiştiği yanında); oradan “Görevi aç” ile göreve geçilir. Telefonda gelen kutusu sayfası aynı bildirimle açılır' },
    ],
    fixes: [],
  },
  {
    version: '0.12.6',
    date: '2026-09-11',
    summary: 'Dosyalar yapıştırıldığı yerde yükleniyor; belgeler bağlantı olarak eklenebiliyor.',
    features: [
      {
        title: 'Yükleme yapıştırılan yerde, belgeler bağlantı olarak',
        description:
          'Yüklenen dosya artık imlecin olduğu yerde küçük bir yükleme çipiyle (ilerleme halkası ve yüzde) görünür ve bitince görsele, videoya ya da bağlantıya dönüşür — yalnızca yapıştırdığınız editörde (yoruma yapıştırınca açıklamanın altında gösterge çıkmaz). Dosyalar bölümünde de genel çubuk yerine dosyanın kendi kutucuğu ilerleme halkasıyla görünür. PDF gibi görsel olmayan bir dosya yapıştırıldığında, sürüklendiğinde ya da yeni “Dosya ekle” düğmesiyle seçildiğinde küçük bir pencere sorar: bağlantı metnini değiştirip imlecin yerine “Bağlantı olarak ekle” ya da görevde “Yalnızca yükle”. Sayfalarda da görsel, video ve belge ekleniyor.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.12.5',
    date: '2026-09-11',
    summary: 'Klasörlerin içinde klasör.',
    features: [
      { title: 'Klasörlerin içine alt klasör açılabiliyor (klasör menüsünde “Alt klasör ekle”), istendiği kadar iç içe. Klasör silinince içindeki listeler, sayfalar ve alt klasörler bir üst seviyeye taşınır; liste penceresinde klasörler yollarıyla (“Müşteriler / BA”) seçilir, sayfanın başındaki yol da tüm klasörleri gösterir' },
    ],
    fixes: [],
  },
  {
    version: '0.12.4',
    date: '2026-09-11',
    summary: 'Shift+Enter yeniden çalışıyor; kenar çubuğu menüleri zenginleşti.',
    features: [
      { title: 'Kenar çubuğu menülerine yeni işlemler: sayfa için “Çöp kutusuna taşı” (alt sayfalarıyla, 60 gün geri alınabilir), liste için “Aç”, takım için “Üyeler”, “Çöp kutusu”, “OneNote’tan içe aktar” ve sahibe “Takımı sil…”' },
    ],
    fixes: [
      { title: 'Yorumda, açıklamada ve sayfada Shift+Enter ile açılan satır sonu 0.12.1’den beri “\n” yazısı olarak kaydediliyordu; artık yine satır sonu' },
    ],
  },
  {
    version: '0.12.3',
    date: '2026-09-11',
    summary: 'Videolar açıklamada oynuyor; yüklemeler ilerlemesini gösteriyor.',
    features: [
      {
        title: 'Açıklamaya video, yükleme çubuğu',
        description:
          'Açıklamaya (ya da yoruma) yapıştırılan veya sürüklenen video, görseller gibi metnin içinde yer kaplıyor ve oradan oynatılabiliyor. Dosya yüklerken artık ilerleme çubuğu var: dosya adı, yüklenen / toplam MB ve yüzde hem editörün altında hem Dosyalar bölümünde görünüyor. Dosya başına 25 MB sınırını aşan dosya yüklenmeye başlamadan açık bir mesajla reddediliyor.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.12.2',
    date: '2026-09-11',
    summary: 'Takım başlıklarında bozuk görünen imleç düzeltildi.',
    features: [],
    fixes: [
      { title: 'Kenar çubuğunda takım başlığının üzerinde (ve pano sütun başlıklarında, sürükleme tutamaçlarında) fare imleci bazı Windows ayarlarında siyah bir leke gibi bozuk görünüyordu. Chrome’un kendi çizdiği “tutma eli” imleci yerine artık Windows’un imleçleri kullanılıyor; sürükleme aynı şekilde çalışıyor' },
    ],
  },
  {
    version: '0.12.1',
    date: '2026-09-11',
    summary: 'Tablo hücrelerinde satır sonu; sürümler yan yana karşılaştırılıyor.',
    features: [
      {
        title: 'Sürüm geçmişinde yan yana karşılaştırma',
        description:
          'Bir sürümü seçince solda o sürüm, sağda sayfanın şu anki hâli satır satır yan yana görünür. Değişen satırlarda yalnızca değişen kelimeler işaretlenir (bir cümlede tek kelime değiştiyse yalnız o kelime); yalnızca boşlukları farklı satırlar aynı sayılır, uzun değişmeyen bölümler katlanır.',
        major: true,
      },
    ],
    fixes: [
      { title: 'Tablo hücresinde Shift+Enter ile açılan satır sonu “[hardBreak]” diye kaydediliyordu; artık satır sonu olarak kalıyor' },
      { title: 'OneNote içe aktarmada tablo hücrelerindeki satır sonları ve yazmak için bırakılmış boş satırlar korunuyor (ör. “Aksiyonlar” ve altındaki açıklama ayrı satırlarda)' },
    ],
  },
  {
    version: '0.12.0',
    date: '2026-09-11',
    summary: 'Gelen kutusu bulunduğun ekranı bırakmadan açılıyor.',
    features: [
      {
        title: 'Gelen kutusu çekmecesi',
        description:
          'Kenar çubuğundaki “Gelen kutusu” artık ayrı bir sayfaya gitmiyor: bildirimler, açık olan pano, liste ya da sayfanın üzerine yandan açılan bir çekmecede listeleniyor. Bir bildirime tıklayınca ne değiştiği yanında ikinci bir çekmecede açılıyor. Esc önce ayrıntıyı, sonra listeyi kapatır; karartılmış alana tıklamak ikisini birden kapatır. “Görevi aç” görevi çekmecenin üzerinde açar, kapatınca gelen kutusuna geri dönersin. Telefonda gelen kutusu yine tam ekran.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.11.3',
    date: '2026-09-11',
    summary: 'OneNote sayfaları biçimleriyle geliyor.',
    features: [],
    fixes: [
      {
        title: 'OneNote içe aktarmada biçim ve sıra kayıpları',
        description:
          'OneNote kalın ve italik yazının çoğunu paragrafın kendisine işliyor; bunlar düz metin olarak geliyordu (ör. tablodaki kalın başlıklar, italik notlar). Artık korunuyor. Ayrıca: sayfada yan yana duran kutular (solda tablo, sağda not) OneNote’taki yerleşime göre soldan sağa, yukarıdan aşağıya sıralanıyor; 💡 gibi etiketli satırlar madde işaretine dönüşmüyor; kalın bir ifadenin sonundaki satır sonu “**Aksiyonlar **” gibi bozuk görünüm üretmiyor; aynı cümlede renk değiştiren italik parçalar kalın görünmüyor. Düzeltmeyi almak için defteri yeniden aktarın — Fira’da düzenlediğiniz sayfalar yine korunur.',
        major: true,
      },
    ],
  },
  {
    version: '0.11.2',
    date: '2026-09-11',
    summary: 'Kenar çubuğunda alt sayfalı sayfaya tek tık yeter.',
    features: [
      { title: 'Kenar çubuğunda alt sayfaları olan bir sayfaya tıklayınca sayfa açılır ve alt sayfaları da açılır ya da kapanır; ayrıca oka basmak gerekmez' },
    ],
    fixes: [],
  },
  {
    version: '0.11.1',
    date: '2026-09-11',
    summary: 'Sayfalar daha sade.',
    features: [
      { title: 'Sayfa metni artık bir kutunun içinde değil: başlığın altında doğrudan sayfanın üzerinde duruyor. Yazmaya başlayınca biçim araç çubuğu yine üstünde beliriyor' },
    ],
    fixes: [],
  },
  {
    version: '0.11.0',
    date: '2026-09-11',
    summary: 'Sade kenar çubuğu: her işlem satırın kendi menüsünde.',
    features: [
      {
        title: 'Takım, klasör, liste ve sayfa menüleri',
        description:
          'Her satırın yanındaki ⋯ düğmesi (ya da satıra sağ tık) o satırla ilgili tüm işlemleri açar: liste, klasör ve sayfa ekleme, düzenleme, silme, takım ayarları. Her takımın altındaki “Liste ekle” ve “Sayfa ekle” satırları kalktı; boş bir takımda ise hâlâ görünür. Takım oluşturma ve koda göre katılma “Takımlar” başlığındaki menüye, Yönetim profil menüsüne taşındı — kenar çubuğunun altında yalnız sürüm bilgisi kaldı.',
        major: true,
      },
    ],
    fixes: [],
  },
  {
    version: '0.10.3',
    date: '2026-09-11',
    summary: 'OneNote aktarımı üç kat daha az veri taşıyor.',
    features: [],
    fixes: [
      {
        title: 'OneNote aktarımı çok yavaş ilerliyordu',
        description:
          'Sürüm geçmişiyle birlikte aynı ekler ve görseller defalarca gönderiliyordu: sayfanın her eski hâli ekli dosyaları yeni bir adla yeniden çıkarıyor, her eski hâl görsellerini baştan yüklüyordu. 625 MB’lık bir defter 1,5 GB olarak görünüyordu. Artık her dosya bir kez çıkarılıyor ve bir kez gönderiliyor, önceki aktarımda gelen dosyalar hiç gönderilmiyor. Aynı defter ~520 MB. Yarım kalan aktarımı baştan başlatmanız yeterli; gelenler tekrar gönderilmez.',
        major: true,
      },
    ],
  },
  {
    version: '0.10.2',
    date: '2026-09-11',
    summary: 'Takım ayarları sekmeleri kaydırma çubuğu olmadan sığıyor.',
    features: [],
    fixes: [
      { title: 'Takım ayarları penceresinin sekme satırında dikey ve yatay kaydırma çubuğu çıkıyordu; sekmeler artık pencereye sığıyor, dar ekranda satır çubuksuz kaydırılıyor' },
    ],
  },
  {
    version: '0.10.1',
    date: '2026-09-11',
    summary: 'OneNote yeniden aktarımı sayfaları doğru yere taşıyor.',
    features: [],
    fixes: [
      { title: 'OneNote’ta sonradan başka bir sayfanın altına taşınan ya da sırası değişen sayfalar, yeniden aktarımda Fira’da da yerine taşınıyor — Fira’da içeriği düzenlenmiş sayfalar dahil (içerik korunur, yalnız yeri değişir). İlk aktarımda alt sayfa olması gerekirken en üst düzeyde kalan sayfalar için defteri bir kez daha aktarmanız yeterli' },
    ],
  },
  {
    version: '0.10.0',
    date: '2026-09-11',
    summary: 'Sayfalarda sürüm geçmişi, çakışma koruması ve çöp kutusu; OneNote geçmişiyle birlikte geliyor.',
    features: [
      {
        title: 'Sayfa sürüm geçmişi',
        description:
          'Her sayfanın üstündeki “Sürüm geçmişi” düğmesi, sayfanın önceki hâllerini kimin ne zaman kaydettiğiyle listeler; bir sürümün neyi değiştirdiğini ya da tamamını görebilir, tek tıkla geri yükleyebilirsiniz. Geri yüklemek de bir sürümdür: o anki hâl kaybolmaz. Aynı kişinin 10 dakika içindeki ardışık kayıtları tek sürüm sayılır.',
        major: true,
      },
      {
        title: 'Aynı sayfayı iki kişi aynı anda düzenlerse',
        description:
          'Siz yazarken başka biri sayfayı kaydettiyse Fira artık onun değişikliğinin üzerine yazmaz: sayfanın üstünde bir uyarı çıkar, “Benimkini kaydet” ya da “Onunkini al” dersiniz. Hangisini seçerseniz seçin, diğer metin sürüm geçmişinde kalır.',
        major: true,
      },
      {
        title: 'Çöp kutusu',
        description:
          'Silinen sayfa artık hemen yok olmaz, alt sayfalarıyla birlikte çöp kutusuna gider ve 60 gün orada durur. Sayfanın içinden ya da Takım ayarları › Çöp kutusu sekmesinden geri alınabilir; kalıcı silmek ayrıca onay ister.',
        major: true,
      },
      {
        title: 'OneNote sürüm geçmişi de aktarılıyor',
        description:
          'OneNote dosyasında saklanan önceki sayfa hâlleri, yazarı ve tarihiyle Fira sayfasının sürüm geçmişine geliyor (görselleriyle). Fira’da düzenlediğiniz bir sayfa, yeniden aktarımda artık ezilmiyor: sayfa sizin hâlinizde kalıyor, OneNote’taki yeni hâli geçmişe ekleniyor ve raporda listeleniyor. Geçmişi almak için defteri yeniden aktarmanız yeterli.',
        major: true,
      },
    ],
    fixes: [
      { title: 'Güncellenen bir sayfanın eski görselleri artık silinmiyor; sürüm geçmişi o görselleri göstermeye devam ediyor (hiçbir yerde kullanılmayan dosyaları Yönetim › Yetim dosyalar toplar)' },
    ],
  },
  {
    version: '0.9.5',
    date: '2026-09-11',
    summary: 'OneNote içe aktarma sayfaların güncel hâlini getiriyor.',
    features: [],
    fixes: [
      {
        title: 'OneNote’tan sayfaların eski bir sürümü aktarılıyordu',
        description:
          'Dönüştürücü, bir sayfanın OneNote dosyasındaki en eski revizyonunu okuyordu: sonradan eklenen metin ve görseller, işaretlenen onay kutuları ve sonradan yazılan başlıklar gelmiyordu (“Untitled Page”). Artık OneNote’un gösterdiği güncel revizyon okunuyor. Aynı defterde görsel sayısı 684’ten 2.492’ye, metin 545 bin karakterden 1,6 milyona çıktı; BA bölümünün okunamayan 53 sayfası da geldi. Defteri yeniden aktarmanız yeterli: sayfalar yerinde güncellenir, kopya oluşmaz.',
        major: true,
      },
      { title: 'İçe aktarılan görsellerin dosya adı artık içeriğinden türetiliyor; yeniden aktarmada bir sayfa başka bir görselin eski dosyasını gösteremez, kullanılmayan eski dosyalar silinir' },
    ],
  },
  {
    version: '0.9.4',
    date: '2026-09-10',
    summary: 'Kenar çubuğunun genişliği size kalmış.',
    features: [
      { title: 'Kenar çubuğu ile ana alan arasındaki çizgiyi sürükleyerek kenar çubuğunu istediğiniz kadar daraltıp genişletebilirsiniz; genişlik hesabınızda saklanır, her cihazda aynı açılır. Çift tık varsayılana döndürür; çizgiye odaklanıp ok tuşlarıyla da ayarlanır' },
    ],
    fixes: [],
  },
  {
    version: '0.9.3',
    date: '2026-09-10',
    summary: 'OneNote içe aktarma, aynı şablondan türeyen bölümlerde de çalışıyor.',
    features: [],
    fixes: [
      { title: 'OneNote içe aktarmada aynı şablondan kopyalanmış sayfaları olan bölümler “duplicate key … pages_source_ref_uq” hatasıyla atlanıyordu; sayfa kimliği artık bölüme göre ayrılıyor. Önceki aktarımda gelen sayfalar tanınıyor, yeniden aktarınca kopya oluşmuyor, eksikler tamamlanıyor' },
      { title: 'OneNote’un sürüm geçmişi biçiminde kaydettiği sayfalar okunamıyor; içe aktarma ekranı artık bunları bölüm bölüm sayıyor ve nasıl alınabileceklerini söylüyor (ham hata metni yerine)' },
    ],
  },
  {
    version: '0.9.2',
    date: '2026-09-10',
    summary: 'OneNote defterleri görselleriyle birlikte Fira’ya aktarılabiliyor.',
    features: [
      {
        title: 'OneNote’tan içe aktarma',
        description:
          'Takım ayarları › OneNote: defter klasörünü seçin; bölüm grupları klasör, bölümler sayfa, OneNote sayfaları ve alt sayfaları da alt sayfa olarak gelir. Metin, tablolar, görseller, ekler ve oluşturma/güncelleme tarihleri korunur. OneNote’un görsellerde okuduğu yazı da taşınır, yani eski ekran görüntüleri içlerindeki metinle aranabilir. Dönüştürme bilgisayarınızda yapılır; aynı defteri yeniden aktarınca kopya oluşmaz, yalnızca değişen sayfalar güncellenir.',
        major: true,
      },
      { title: 'Takım ağacında “Sayfa ekle” artık yazılı bir düğme olarak da görünüyor; yalnızca üzerine gelince çıkan simgeye bağlı değil' },
    ],
    fixes: [
      { title: 'Sayfalara yapıştırılan görseller Yönetim › Yetim dosyalar listesinde yanlışlıkla “kullanılmıyor” görünüyordu; artık sayfa içerikleri de hesaba katılıyor' },
    ],
  },
  {
    version: '0.9.1',
    date: '2026-09-10',
    summary: 'Yeni takım yeniden açılabiliyor.',
    features: [],
    fixes: [
      { title: 'Yeni takım oluştururken “new row violates row-level security policy for table teams” hatası çıkıyordu; takım açan kişiyi sahip yapan adım bir yetki değişikliğinden sonra engelleniyordu. Artık takım açılıyor ve açan kişi sahibi oluyor' },
    ],
  },
  {
    version: '0.9.0',
    date: '2026-09-10',
    summary: 'Takımlarda artık görev dışında bir şey daha var: Sayfa.',
    features: [
      {
        title: 'Sayfa: görev olmayan notlar için yer',
        description:
          'Takımın içinde artık yalnız liste ve klasör değil, sayfa da açabilirsiniz. Sayfa, görev özellikleri olmayan bir belge: durumu, atananı, tarihi yok; yalnızca başlık ve görev açıklamasındaki editörün aynısıyla yazılan içerik (Markdown, "/" komutları, tablo, Ctrl+V ile görsel). Takım kökünde, bir klasörde, bir listede, bir görevin altında ya da başka bir sayfanın altında durabilir; kenar çubuğunda listelerle birlikte görünür. Yazdıkça kendini kaydeder. OneNote’taki wiki kısmımızı Fira’ya taşımanın ilk adımı.',
        major: true,
      },
      { title: 'Görev ekranında “Sayfalar” bölümü: göreve bağlı notlar, nasıl yapılır belgeleri ve toplantı notları görevin yanında duruyor' },
      { title: 'Kenar çubuğunda takım, klasör, liste ve sayfa satırının üzerine gelince “sayfa ekle” düğmesi çıkıyor; üye rolündekiler de sayfa açabiliyor' },
    ],
    fixes: [],
  },
  {
    version: '0.8.4',
    date: '2026-09-09',
    summary: 'Açıklama içinde arama yeniden çalışıyor.',
    features: [],
    fixes: [
      { title: 'Panoda arama yaparken görev açıklamalarının içi yeniden taranıyor — bir önceki sürümdeki hız iyileştirmesi bunu sessizce devre dışı bırakmıştı. Artık açıklama ve yorumlar birlikte sunucu tarafında aranıyor, sayfa da hafif kalmaya devam ediyor' },
    ],
  },
  {
    version: '0.8.3',
    date: '2026-09-09',
    summary: 'İlk açılış belirgin biçimde hafifledi.',
    features: [],
    fixes: [
      {
        title: 'Pano çok daha hızlı açılıyor',
        description:
          'Uygulama açılırken listeyi seçmeden önce bir kez bütün takımlardaki görevleri indiriyordu — ekranda hiç görünmeyen 1,5 MB. Bu kalktı. Ayrıca kartın gösterdiği şeyler ile sorgunun getirdikleri hizalandı: kart açıklamanın kendisini değil dolu olup olmadığını gösterdiği için artık metni indirmiyoruz, oluşturan/güncelleyen bilgisi de yalnızca görev penceresinde çekiliyor. Liste sorgusu 454 kB’den 244 kB’ye indi.',
        major: true,
      },
      { title: 'Yedekleme ve yönetim ekranları ayrı yükleniyor: ilk indirilen paket 2,5 MB’den 1,9 MB’ye düştü' },
      { title: 'Liste logoları ve kart kapakları görüntülendikleri boyutta geliyor — 448 kB’lık bir logo artık 7 kB' },
    ],
  },
  {
    version: '0.8.2',
    date: '2026-09-09',
    summary: 'Kart sürüklerken yaşanan donma giderildi.',
    features: [],
    fixes: [
      {
        title: 'Kanban’da kart sürükleyince pano kilitlenmiyor',
        description:
          'Bir kartı sütunun ortasına bıraktığınızda altındaki bütün kartların sırası yeniden yazılıyor ve uygulama bunların her birini ayrı bir değişiklik sanıp panoyu baştan çekiyordu. Yoğun bir sütunda bu dakikada onlarca tam sorgu demekti; istekler birbirini bekleyince pano yarım dakika donmuş gibi görünüyor, sürüklediğiniz kart yerinde kalmış gibi duruyordu. Artık arka arkaya gelen değişiklikler tek bir tazelemede toplanıyor.',
        major: true,
      },
    ],
  },
  {
    version: '0.8.1',
    date: '2026-09-09',
    summary: 'Tarihleri kendi istediğiniz gibi yazdırabiliyorsunuz.',
    features: [
      {
        title: 'Tarih ve saat biçimi size kalmış',
        description:
          'Ayarlar → Dil ve tarih altında üç gösterim var: Kısa (“20 dk”, “dün”), Kompakt (yıl yok, bugünse yalnızca saat) ve Tam (her zaman tam tarih ve saat). Ayı adıyla mı sayıyla mı, günü ayın önünde mi arkasında mı göreceğinizi de seçiyorsunuz. Seçtiğiniz an, ekranın altındaki önizlemede beş gerçek örnek üzerinde ne değiştiğini görüyorsunuz. Tercih hesabınıza kayıtlı, tüm cihazlarınızda geçerli.',
        major: true,
      },
      { title: 'Gelen kutusundaki satır işlemleri (okundu/okunmadı, bildirimi kapat) sağ tık menüsüne taşındı; satırın sonundaki düğmeden de açılıyor' },
    ],
    fixes: [
      { title: 'Görev penceresi, kartlar, listeler, gelen kutusu ve yedekleme ekranı artık tek bir tarih biçimlendiricisinden geçiyor — bir yerde sabit kalan biçim kalmadı' },
    ],
  },
  {
    version: '0.8.0',
    date: '2026-09-09',
    summary: 'Fira artık Türkçe, İngilizce ve Almanca konuşuyor.',
    features: [
      {
        title: 'Üç dilli arayüz',
        description:
          'Ayarlar → Dil altından Türkçe, English ya da Deutsch seçebilirsiniz. Seçim bu tarayıcıda saklanır ve giriş yapmadan açtığınız ekranlarda da geçerlidir. Tarih ve saat biçimleri de dile uyar. Görev adları, açıklamalar, yorumlar ve ekibinizin tanımladığı durum/etiket/liste adları içeriktir — yazıldıkları dilde kalır.',
        major: true,
      },
      { title: 'Profil menüsünde seçili dilin kısayolu var; ilk açılışta tarayıcınızın dili tahmin ediliyor' },
    ],
    fixes: [
      { title: 'Zaman yazıları kısaldı: “20 dakika önce” yerine “20 dk”, “3 saat önce” yerine “3 sa”. Tam zaman yine üzerine gelince görünüyor' },
      { title: 'Gelen kutusunda satırların arasına ayraç çizgisi geldi' },
      { title: 'Kanban kartındaki alt görev belirteci artık yalnızca simge — “Alt görev” yazısı kartta yer kaplamıyor' },
      { title: 'Kart sağ tık menüsü yetkiyi etiket metnine bakarak belirliyordu; dil değişince silme/arşivleme yanlış kişiye görünebilirdi' },
      { title: 'Klavye kısayolu atarken Almanca harfler (ä, ö, ü, ß) artık harf sayılıyor' },
    ],
  },
  {
    version: '0.7.35',
    date: '2026-09-09',
    summary: 'Gelen kutusu okunur hâle geldi: renkli durumlar, avatarlar, liste/görev filtresi ve takibi bırakma.',
    features: [
      {
        title: 'Gelen kutusu satırları yeniden tasarlandı',
        description:
          'Zaman damgası sağ üstte, kişinin adının yanında avatarı, durum değişiklikleri kendi renginde bir rozet olarak. Satırın altında görevin listesi (ikonu ve rengiyle) ve kısa görev numarası duruyor; birine tıklayınca kutu yalnızca o listeye ya da o göreve daralıyor, en altta “Filtreleri temizle” ile geri çıkıyorsunuz.',
        major: true,
      },
      {
        title: 'Bir görevin takibini bırakma',
        description:
          'Satırdaki zil düğmesi o görevin bildirimlerini kapatıyor — kutu, tarayıcı bildirimi ve Telegram, üçü birden. Göreve atanmış kalmaya devam ediyorsunuz; sadece haber gelmiyor. Bıraktığınız görevler Ayarlar → Bildirimler altında listeleniyor ve oradan tek tıkla geri açılıyor.',
        major: true,
      },
      { title: 'Okunmuş bir bildirimi yeniden okunmadı olarak işaretleyebiliyorsunuz' },
    ],
    fixes: [],
  },
  {
    version: '0.7.34',
    date: '2026-09-09',
    summary: 'Kanban kartları artık kapak görseli ve alt görev belirteci gösteriyor.',
    features: [
      {
        title: 'Karta kapak görseli',
        description:
          'Göreve eklenmiş bir görselin menüsünden “Kapak yap” dediğinizde o görsel kanban kartının başlığı olarak görünür. İsteğe bağlıdır: siz seçmediğiniz sürece kartlar eskisi gibi kalır. Kapak yapılan dosyayı silerseniz kapak da kendiliğinden kalkar.',
        major: true,
      },
      { title: 'Kanban kartında alt görevler artık “Alt görev” rozetiyle işaretleniyor — kartın bir üst göreve bağlı olduğu ilk bakışta belli oluyor' },
    ],
    fixes: [
      { title: 'Dosya bölümündeki görsel önizlemeleri artık kırpılmıyor, tamamı görünüyor' },
    ],
  },
  {
    version: '0.7.33',
    date: '2026-09-09',
    features: [],
    summary: 'Gizlenenleri tek tıkla geri getirme.',
    fixes: [
      { title: 'Planlanan/kapatılanlar gizliyken sütunda çıkan uyarı artık tıklanabilir bir “göster” düğmesi — filtre menüsüne gitmeye gerek yok' },
      { title: 'Aramada sonuç çıkmazsa “Filtreleri temizle ve tekrar ara” düğmesi planlananları ve kapatılanları da görünür yapıyor; bu seçenekler kapalıyken düğme artık görünüyor' },
    ],
  },
  {
    version: '0.7.32',
    date: '2026-09-09',
    features: [],
    summary: 'Tanıtım turunda odak alanı belirginleşti.',
    fixes: [
      { title: 'Tanıtım turunda odaklanılan alan, özellikle karanlık modda, arka plandan yeterince ayrılmıyordu; artık odak dışındaki alan hafifçe bulanıklaştırılıyor ve odak çerçevesinin çevresine yumuşak bir halka ekleniyor' },
    ],
  },
  {
    version: '0.7.31',
    date: '2026-09-08',
    summary: 'Tarihler insanlaştı, sütun sayaçları filtreyi ele veriyor, atama filtresi sıralandı.',
    features: [
      {
        major: true,
        title: 'Tarihler artık “1 dakika önce” diyor',
        description:
          'Etkinlik & yorumlar, gelen kutusu ve görev bilgileri artık “8 Eyl 2026 · 22:14” yerine “1 dakika önce”, “3 saat önce”, “dün” gibi okunuyor. Bir haftadan eskiler tekrar tarihe dönüyor. Üzerine gelince tam zaman damgası ipucu olarak çıkıyor.',
      },
    ],
    fixes: [
      { title: 'Oluşturan ve son değişiklik bilgisi özellik alanlarından çıktı; başlığın altında sade bir satır olarak duruyor' },
      { title: 'Sütun sayacı filtre varken “3/120” gösteriyor — kaç görevin filtre yüzünden gizlendiği artık belli' },
      { title: 'Filtrelerde atama listesi: en üstte sen, altında “Atanmayan”, sonra diğerleri alfabetik' },
    ],
  },
  {
    version: '0.7.29',
    date: '2026-09-08',
    features: [],
    summary: 'Kaydedilmiş görünüm ve filtreler artık her açılışta doğru uygulanıyor.',
    fixes: [
      { title: 'Gelen kutusundan (ya da logoya basarak) panoya dönerken kaydedilmiş görünüm (Pano/Liste) ve filtreler uygulanmıyordu; ekran artık nereden açılırsa açılsın en son uygulanan filtreyle açılıyor' },
    ],
  },
  {
    version: '0.7.28',
    date: '2026-09-08',
    features: [],
    summary: 'Görev detayı özellik düzeni yeniden sıralandı.',
    fixes: [
      { title: 'Öncelik artık Durum’un hemen altında; Etiketler ikisinin altında (sol sütun). Bitiş Tarihi ve Atananlar sağ sütunda alt alta, Bitiş Tarihi üstte' },
      { title: 'İki sütun birbirinden bağımsız akıyor: bir alan iki satıra uzadığında karşı sütunda boşluk oluşmuyor' },
    ],
  },
  {
    version: '0.7.27',
    date: '2026-09-08',
    features: [],
    summary: 'Boş sütun, filtre yüzünden mi boş olduğunu söylüyor.',
    fixes: [
      { title: '“Planlananları göster” kapalıyken Planlanıyor sütunu artık “Görev yok” değil “Planlananlar gizli · Filtre › Planlananları göster” diyor (kapatılanlardaki gibi)' },
      { title: 'Kapatılanlar sütunu da artık yalnızca filtre gerçekten gizliyorken “Kapatılanlar gizli” diyor; filtre açıkken ve sütun boşken doğru şekilde “Görev yok” yazıyor' },
    ],
  },
  {
    version: '0.7.26',
    date: '2026-09-08',
    summary: 'Filtreler: “Planlananları göster” seçeneği ve gelen kutusu dönüşünde sıfırlanma düzeltmesi.',
    features: [
      { title: 'Filtrelere “Planlananları göster” seçeneği eklendi — kapatınca “Planlanıyor” (backlog) görevleri panodan gizleniyor; tercih listeye özel kaydediliyor' },
    ],
    fixes: [
      { title: 'Gelen kutusuna gidip panoya döndüğünde filtreler sıfırlanıyordu; artık aynı liste yeniden seçildiğinde kayıtlı filtreler korunuyor' },
    ],
  },
  {
    version: '0.7.25',
    date: '2026-09-08',
    features: [],
    summary: 'Görev detayı özellik alanları düzenlendi.',
    fixes: [
      { title: 'Öncelik artık tüm seçenekleri sıralamak yerine kompakt bir açılır menü' },
      { title: 'Oluşturan, Tamamlandı ve Son Değişiklik bilgileri yan yana değil alt alta, tam genişlikte' },
      { title: '“+ Ekstra deadline ekle” düğmesi yalnızca bir bitiş tarihi girildikten sonra görünüyor' },
      { title: 'Bir özellik alanı iki satıra uzadığında yanındaki alan da gereksiz yere uzamıyor (her hücre kendi boyunda)' },
    ],
  },
  {
    version: '0.7.24',
    date: '2026-09-08',
    features: [],
    summary: 'Editör çubuğu yalnız yazarken kayarak beliriyor; gruplanan yorumlar hizalandı.',
    fixes: [
      { title: 'Açıklama/yorum editör çubuğu artık yalnız yazarken görünüyor: alana girince yukarı kayarak beliriyor, çıkınca aşağı kayarak kayboluyor. Alanın üzerinde yüzdüğü için altındaki içerik kaymıyor' },
      { title: 'Gruplanan etkinlik bloğunda yorumlar da diğer satırlarla aynı düzende: mesaj ikonu + “yorum ekledi” + sağa hizalı zaman, altında yorum metni' },
    ],
  },
  {
    version: '0.7.23',
    date: '2026-09-08',
    features: [],
    summary: 'Alt görev derinlik sınırında açıklayıcı davranış + kural hatalarının net mesajı.',
    fixes: [
      { title: 'En alt seviyedeki (3.) bir göreve alt görev eklemeye çalışınca genel “bir şeyler ters gitti” hatası çıkıyordu; artık o seviyede ekleme kutusu yerine “en fazla 3 seviye” açıklaması gösteriliyor' },
      { title: 'Veritabanı kural hataları (alt görev derinliği, aynı liste, döngü vb.) artık genel mesaj yerine kendi açık Türkçe açıklamasıyla gösteriliyor' },
    ],
  },
  {
    version: '0.7.22',
    date: '2026-09-08',
    features: [],
    summary: 'Editör araç çubuğu artık odakta açılıp kapanmıyor — kayma sorunu giderildi.',
    fixes: [
      { title: 'Açıklama ve yorum editörlerine tıklayınca çubuk açılıp içeriği bir satır aşağı itiyordu (odak/odak-kaybında pencere kayması); araç çubuğu artık her zaman duruyor (odaksızken hafif soluk), kayma yok' },
    ],
  },
  {
    version: '0.7.21',
    date: '2026-09-08',
    features: [],
    summary: 'Gelen kutusunda gruplanan yorumlar tam metniyle görünüyor.',
    fixes: [
      { title: 'Birleştirilmiş bir bildirimi açtığında içindeki yorumlar artık kısaltılmış önizleme değil, tam metniyle (biçimlendirme ve görsellerle) görünüyor' },
    ],
  },
  {
    version: '0.7.20',
    date: '2026-09-08',
    features: [],
    summary: 'Etkinlik akışında ince ayarlar ve “Claude’a yaptır” görevi todo’ya alıyor.',
    fixes: [
      { title: 'Yorum kutusundaki “Gönder” düğmesi artık boşken görünmüyor; yalnız yazmaya başlayınca beliriyor' },
      { title: 'Yorumlar da etkinliklerle birlikte gruplanıyor: aynı kişinin ≤5 dk içindeki ardışık yorum ve etkinlikleri tek blokta toplanır, farklı kişi ya da 5 dk’dan uzun ara grubu böler' },
      { title: '“Claude’a yaptır” düğmesi görevi yapay zekâya devrederken durumu da “Yapılacak” sütununa taşıyor' },
    ],
  },
  {
    version: '0.7.19',
    date: '2026-09-08',
    summary: 'Gelen kutusu: aynı görevin kısa arayla gelen güncellemeleri tek bildirimde toplanıyor.',
    features: [],
    fixes: [
      { title: 'Aynı görevle ilgili kısa arayla (≤3 dk) gelen güncellemeler artık ayrı ayrı bildirim üretmiyor; tek bir bildirimde toplanıyor — satırda kaç güncelleme olduğu rozetle, bildirimi açınca hepsi tek tek listeleniyor' },
    ],
  },
  {
    version: '0.7.18',
    date: '2026-09-08',
    summary: 'Etkinlik akışı: en yeni en üstte + ardışık değişiklikler gruplanıyor.',
    features: [],
    fixes: [
      { title: 'Etkinlik & Yorumlar artık en yeni en üstte sıralanıyor; yorum kutusu da akışın üstüne taşındı' },
      { title: 'Aynı kişinin kısa arayla (birkaç dakika) yaptığı ardışık değişiklikler tek bir grup altında toplanıp özetleniyor — uzun tekrar eden satır yığını yerine' },
    ],
  },
  {
    version: '0.7.17',
    date: '2026-09-08',
    summary: 'Dosya küçük resimleri: tam görüntü, daha küçük, satıra 4 tane.',
    features: [],
    fixes: [
      { title: 'Dosyalar ızgarasındaki küçük resimler artık görüntünün bir kısmını kırpmıyor, tamamını gösteriyor (letterbox); küçüldüler ve en geniş halinde bir satıra 4 tanesi sığıyor' },
    ],
  },
  {
    version: '0.7.16',
    date: '2026-09-08',
    summary: 'Üst görevden ayırma artık onay istiyor.',
    features: [],
    fixes: [
      { title: 'Breadcrumb’taki üst görev bağlantısını silen “✕” düğmesi artık yanlışlıkla basmaya karşı yerinde onay istiyor (“Ayrılsın mı? Ayır / Vazgeç”)' },
    ],
  },
  {
    version: '0.7.15',
    date: '2026-09-08',
    summary: 'Görevi tek tıkla yapay zekâya devretme: “Claude’a yaptır”.',
    features: [
      {
        title: 'Görev ekranında “Claude’a yaptır” düğmesi: görevi yapay zekâ hesabına (Ali İlker Claude) devreder ve durumu canlı gösterir (kuyrukta / çalışıyor / tamamlandı). Yalnız düğmeye basınca tetiklenir — sıradan atama tetiklemez.',
      },
    ],
    fixes: [],
  },
  {
    version: '0.7.14',
    date: '2026-09-08',
    summary: 'Tek adımda görev oluşturma ve açılır pencerede alta yerleşen etkinlik & yorumlar.',
    features: [
      { title: '“Yeni Ticket” tek adım: ara form yok — doğrudan görevin kendi ekranı açılıyor, imleç başlığa düşüyor. Boş bırakıp kapatırsan görev arkada kalmıyor, kendiliğinden siliniyor.' },
    ],
    fixes: [
      { title: 'Açılır pencere görünümünde “Etkinlik & Yorumlar” artık sağda ayrı bir çekmece değil; alt görevler, bağlı görevler ve dosyaların altında yer alıyor (tam ekran görünümde sağ panel korunuyor)' },
    ],
  },
  {
    version: '0.7.13',
    date: '2026-09-08',
    summary: 'Görev penceresi görünüm tercihi (tam ekran / açılır pencere) ve paylaşılan fragment altyapısı.',
    features: [
      {
        major: true,
        title: 'Görev görünümü: tam ekran ya da açılır pencere',
        description:
          'Ayarlar → Görünüm’den görevlerin tam ekran mı yoksa açılır (popup) pencere olarak mı açılacağını seçebiliyorsun; tercih kaydediliyor. İki görünüm de aynı yapı taşlarını (özellikler, açıklama, alt görevler, bağlı görevler, dosyalar, etkinlik & yorumlar) paylaşıyor — yani ileride eklenecek her yeni alan iki görünümde de tek seferde görünür.',
      },
    ],
    fixes: [],
  },
  {
    version: '0.7.12',
    date: '2026-09-07',
    summary: 'Görev ekranı ince ayar: tıklanabilir breadcrumb, yan yana etiketler, belirgin panel-aç çubuğu.',
    features: [],
    fixes: [
      { title: 'Ana içerik biraz daha geniş (okuma alanı ~%25 arttı)' },
      { title: 'Breadcrumb\'taki takım ve liste artık tıklanabilir ve yan menüdeki gibi (takım rozeti + liste simgesi) görünüyor; görev başlığı üst satırda gereksiz yere tekrarlanmıyor' },
      { title: 'Görev özelliklerinde etiketler (Durum, Öncelik, Atananlar…) artık alanların üstünde değil yanında duruyor' },
      { title: 'Etkinlik & yorumlar paneli kapalıyken sağ kenarda belirgin bir açma çubuğu geldi; panel genişliği ve açık/kapalı tercihi görevden göreve hatırlanıyor' },
    ],
  },
  {
    version: '0.7.11',
    date: '2026-09-07',
    summary: 'Görev ekranı ince ayar: daraltılmış içerik, ayarlanabilir/gizlenebilir yorum paneli, breadcrumb.',
    features: [],
    fixes: [
      { title: 'Görev açılınca soldaki takımlar menüsü tamamen gizleniyor; görev tüm ekranı kaplıyor' },
      { title: 'Ana içerik artık okunaklı bir genişlikte ortalanıyor (aşırı geniş durmuyor)' },
      { title: 'Sağdaki "Etkinlik & Yorumlar" paneli: kenarından tutup sürükleyerek genişliği ayarlanabiliyor ve tamamen gizlenebiliyor (üstteki "Etkinlik" düğmesiyle geri açılıyor); tercih hatırlanıyor' },
      { title: 'Üst satırda (Sil/kapat hizasında) breadcrumb: takım / liste / (üst görev) / görev; üst görev varsa tıklayınca üst göreve gidiliyor' },
    ],
  },
  {
    version: '0.7.10',
    date: '2026-09-07',
    summary: 'Görev ekranı yeniden tasarlandı: tam sayfa, üstte özellikler, sağda etkinlik & yorumlar.',
    features: [
      {
        major: true,
        title: 'Yeni görev ekranı',
        description:
          'Görev artık ortadaki alanı tam kaplayan bir sayfa olarak açılıyor (soldaki menü yerinde kalıyor). Başlığın hemen altında tüm özellikler bir arada (durum, öncelik, atananlar, etiketler, tarihler, oluşturan/son değişiklik); altında açıklama, alt görevler, bağlı görevler ve dosyalar. Sağdaki panel tamamen etkinlik ve yorumlara ayrıldı — aktivite kayıtları ve yorumlar tek bir akışta, en altta yorum kutusuyla. Açıklama ve yorum düzenleyicilerinin araç çubukları yalnızca yazmaya başlayınca beliriyor; dosya yokken sade bir "Dosya ekle" satırı, varken butonlar imleç panele gelince çıkıyor. İç içe kaydırmalar kaldırıldı.',
      },
    ],
    fixes: [],
  },
  {
    version: '0.7.9',
    date: '2026-09-07',
    summary: 'Yeni görev: doğrudan tam görev sayfası açılıyor, boş görev bırakmıyor.',
    features: [],
    fixes: [
      { title: '"Yeni Ticket" artık başlık soran küçük bir ara pencere yerine doğrudan tam görev sayfasını açıyor (açıklama, durum, öncelik, atananlar, bitiş tarihi ile). Başlık ("Yeni görev" bir placeholder) zorunlu ve görev yalnızca "Oluştur" dediğinde kaydediliyor — pencereyi kapatınca ya da başlığı boşaltınca geride hiçbir kayıt kalmıyor. Başlığı gerçekten "Yeni Görev" yazmak istersen de kabul ediliyor' },
    ],
  },
  {
    version: '0.7.8',
    date: '2026-09-07',
    summary: 'Görev penceresi yeniden düzenlendi: her şey tek görünümde, sekme yok.',
    features: [
      {
        major: true,
        title: 'Görev penceresi: tek görünüm',
        description:
          'Görev penceresindeki sekmeler kaldırıldı — alt görevler, bağlı görevler, dosyalar, yorumlar ve aktiviteye artık tıklamadan, hepsi tek görünümde ulaşıyorsun. Açıklama, alt görevler ve yorumlar geniş ana sütunda; görev özellikleri (durum, öncelik, atananlar, etiketler, tarihler), bağlı görevler, dosyalar ve aktivite ise sağdaki panelde. Uzun listeler kendi içinde kayıyor, böylece pencere tek uzun bir yığın olmuyor; her şey ortada ama derli toplu.',
      },
    ],
    fixes: [],
  },
  {
    version: '0.7.7',
    date: '2026-09-07',
    summary: 'Bildirimler artık bir sayfa: sol menünün üstünde rozetli "Gelen kutusu" ve her bildirimde ne değiştiğini gösteren görünüm.',
    features: [
      {
        major: true,
        title: 'Gelen kutusu sayfası',
        description:
          'Aktivite bildirimleri artık küçük bir açılır pencere değil, tam bir sayfa — kritik değişiklikleri kaçırmamak için. Sol menünün en üstünde, okunmamış sayısını gösteren rozetli "Gelen kutusu" düğmesi var. Açılınca solda bildirim listesi (güne göre gruplu; arama, Tümü/Okunmamış süzgeci, "Tümünü/Görünenleri okundu say"), bir bildirime tıklayınca sağda "ne değişti" görünümü geliyor: durum değişikliklerinde eski → yeni açıkça, yorum/alt görev/dosya eklemelerinde eklenen içerik. "Görevi aç" ile ilgili göreve geçilir.',
      },
    ],
    fixes: [],
  },
  {
    version: '0.7.6',
    date: '2026-09-07',
    summary: 'Uygulama turu: ilk girişte arayüzü tanıtan ve yeni özellikleri gösteren rehber.',
    features: [
      {
        major: true,
        title: 'Uygulama turu',
        description:
          'İlk girişte kısa bir tanıtım turu açılıyor: sol menü, "Yeni Ticket", Kanban/Liste görünümü, bildirimler ve profil menüsü sırayla, üzerlerinde bir spot ışığıyla anlatılıyor. Turun sonunda bu sürümün yenilikleri de gösteriliyor — yeni bir özellik ekledikçe tura kendiliğinden ekleniyor (kaynağı sürüm notları). İleri/Geri/Atla düğmeleri ve ok tuşlarıyla gezilir, Esc ile kapanır. Turu dilediğin an profil menüsündeki "Tanıtım turu" ile tekrar açabilirsin.',
      },
    ],
    fixes: [],
  },
  {
    version: '0.7.5',
    date: '2026-09-07',
    summary: 'Görev penceresi sadeleşti: alt görevler, bağlı görevler, dosyalar, yorumlar ve aktivite artık sekmelerde.',
    features: [
      {
        major: true,
        title: 'Daha sade görev penceresi',
        description:
          'Görev detayı büyüdükçe pencere upuzun bir listeye dönüşmüştü — açıklama, alt görevler, bağlı görevler, dosyalar, yorumlar ve aktivite hepsi alt alta. Artık açıklama üstte kalıyor; alt görevler, bağlı görevler, dosyalar, yorumlar ve aktivite ise sekmelere ayrıldı, her sekmede kaç öğe olduğunu gösteren bir sayaçla. Aynı anda tek bölüm görünüyor, aradığını daha kolay buluyorsun. Etiketler de yan panele, diğer özelliklerin yanına taşındı.',
      },
    ],
    fixes: [],
  },
  {
    version: '0.7.4',
    date: '2026-09-07',
    summary: '"Yeni Ticket" artık boş görev bırakmıyor.',
    features: [],
    fixes: [
      { title: '"Yeni Ticket" düğmesi (ve "n" kısayolu) artık anında boş bir "Yeni Görev" oluşturmuyor; önce başlığı sorduğu küçük bir pencere açılıyor, görev yalnızca başlık yazıp onayladığında oluşturuluyor — vazgeçince geride boş görev kalmıyor' },
    ],
  },
  {
    version: '0.7.3',
    date: '2026-09-03',
    summary: 'Hata yönetimi: beklenmedik hatalar, başarısız işlemler, eşzamanlı düzenleme çakışması ve bağlantı kopması artık kullanıcıya belli oluyor.',
    features: [
      {
        major: true,
        title: 'Görülebilir hata yönetimi',
        description:
          'Bir işlem başarısız olduğunda (görev güncelleme, atama, oluşturma…) artık sessizce geri alınmıyor; ne olduğunu anlatan kısa bir uyarı çıkıyor — çok fazla istek, bağlantı yok, oturum süresi doldu, yetki yok gibi durumlar Türkçe ve ayrı ayrı. Beklenmedik bir ekran hatası bütün uygulamayı çökertmiyor; kurtarma ekranı ve "Yenile" geliyor. Çevrimdışı kalınca ya da canlı bağlantı bir süre koptuğunda üstte ince bir uyarı bandı beliriyor, bağlantı gelince kayboluyor.',
      },
      {
        major: true,
        title: 'Eşzamanlı düzenleme çakışması',
        description:
          'Aynı görevin açıklamasını ya da başlığını sen düzenlerken başka biri değiştirirse, artık yazdığın sessizce kaybolmuyor. Kaydederken çakışma algılanıyor, taslağın korunuyor ve "Benim yazdığımı uygula" / "Onların sürümünü al" seçenekleri sunuluyor. Görev penceresi açıkken başkası görevi güncellerse üstte "… bu görevi güncelledi · Görünümü yenile" bilgisi çıkıyor.',
      },
    ],
    fixes: [],
  },
  {
    version: '0.7.2',
    date: '2026-09-02',
    summary: 'Kararlılık: istek fırtınası ve 429 yığılması giderildi.',
    features: [],
    fixes: [
      { title: 'Uygulama, sekmeye her geri dönüşte bütün verileri yeniden çekmiyordu artık; canlı bağlantı sağlamken zaten güncel olduğu için yalnızca bağlantı gerçekten koptuysa tam yenileme yapıyor — ofiste paylaşılan tek IP arkasında oluşan istek fırtınası ve "429 / geçici kararsızlık" bunun sonucuydu' },
      { title: 'Oran sınırına (429) takılan istekler artık tekrar denenmiyor (tekrar deneme fırtınayı büyütüyordu); sunucudaki sınırlar tek kullanıcıya değil bütün ofise (tek NAT IP) göre yükseltildi' },
    ],
  },
  {
    version: '0.7.1',
    date: '2026-09-01',
    summary: 'Bildirim kutusu görev başına tek satır; "Bağlı görevler" bölümü her görevde görünür.',
    features: [
      { title: 'Bildirim kutusu: aynı görevin bildirimleri tek satırda, eylemler alt alta ("+N daha" ile açılır); satıra tıklamak o görevin tümünü okundu sayar ve görevi açar; "Okundu say" açmadan işaretler' },
      { title: 'Bildirim kutusu: süzgeç (arama / Okunmamış / liste) açıkken düğme "Görünenleri okundu say (N)" olur ve yalnız görünenleri işaretler' },
      { title: 'Görev penceresinde "Bağlı görevler" bölümü ve yazılı "Görev bağla" düğmesi bağ olmasa da görünür (alt görev satırındaki adsız zincir simgesi kaldırıldı)' },
    ],
    fixes: [
      { title: 'Bildirim kutusu bir satıra tıklayınca kaybolmuyor: görev penceresi üstte açılır, Esc ile kapanınca liste yerinde durur' },
    ],
  },
  {
    version: '0.7.0',
    date: '2026-09-01',
    summary: 'Bildirim kutusu geldi: kaçırdığın bildirimler üst çubuktaki zilde birikir. Erişilebilirlik ikinci tur; durum yönetimi penceresi düzeltmeleri.',
    features: [
      {
        major: true,
        title: 'Bildirim kutusu',
        description:
          'Üst çubukta zil ve okunmamış sayısı. Sana atanan, yorum yapılan, durumu değişen, alt görev ya da dosya eklenen görevlerin bildirimleri — sekmen kapalıyken olanlar dahil — burada günlere göre gruplu listelenir. Arama kutusu görev adı, yorum metni, kişi ve liste adında arar; bir satırın üzerine gelince "Bu görev" / "Bu liste" ile yalnız o görevin ya da listenin bildirimlerine daralt. "Okunmamış" süzgeci, "Tümünü okundu say", tıklayınca görev açılır ve okundu sayılır. Son 90 gün saklanır; toast ve Telegram bildirimleri aynen devam eder, kutu hepsinin kaydıdır. Klavye: ↑↓ satırlar arasında, Enter açar, Esc kapatır.',
      },
      { title: 'Erişilebilirlik ikinci tur: atama listesinde ↑↓, öncelik seçici ok tuşlarıyla (radyo grubu), kenar çubuğu ağacında ↑↓ ve açık/kapalı-seçili durumları ekran okuyucuya bildiriliyor; Kanban sütunları adlı bölgeler; toast alanı kalıcı canlı bölge; görsel önizleme ve durum yönetimi penceresi diyalog sözleşmesinde' },
      { title: 'Kontrast: soluk metinler (tarih, ipucu, yer tutucu) açık ve koyu temada WCAG AA (4.5:1) eşiğine çekildi' },
    ],
    fixes: [
      { title: 'Durum yönetimi penceresi dışarı tıklayınca ve Esc ile kapanıyor; panonun sonundaki "Durum ekle" sütunu kaldırıldı (durumlar yalnız Durumlar penceresinden yönetilir)' },
    ],
  },
  {
    version: '0.6.9',
    date: '2026-09-01',
    summary: 'Klavyeyle gezinme düzeni; liste görünümü kaydırılıyor; hızlı ekleme ve kutlama sesi düzeltmeleri.',
    features: [
      {
        major: true,
        title: 'Klavyeyle gezinme (WCAG)',
        description:
          'Sayfadaki ilk Tab "Ana içeriğe geç" bağlantısını getirir; üst çubuk ve kenar çubuğu atlanabilir. Panodaki kartlar ve listedeki satırlar Tab ile gezilir, Enter görevi açar (kartta Boşluk tutup ok tuşlarıyla taşıma yine çalışır). Görev penceresi, Ayarlar, Yeni görev ve Yenilikler pencereleri açılınca odak içeri girer, Tab pencerenin içinde döner, kapanınca odak açan karta/satıra geri gelir. Odaklı öğe her yerde görünür bir halkayla belli olur; ekran okuyucular pencereleri adıyla duyurur.',
      },
    ],
    fixes: [
      { title: 'Liste görünümü: satırlar görünüm alanının altında kırpılıyor, kaydırılamıyordu — artık liste kendi içinde kayar, başlık satırı üstte sabit kalır' },
      { title: 'Sütundaki "Görev ekle" düğmesi hızlı ekleme alanını açamıyordu (açan tık formu aynı anda kapatıyordu)' },
      { title: 'Bitirme kutlaması: ses artık baştan sona duyuluyor — notalar biraz ileriye planlanıyor, tik animasyonu tepe notasının kulağa ulaştığı ana denk getiriliyor' },
    ],
  },
  {
    version: '0.6.8',
    date: '2026-09-01',
    summary: 'Açıklama ve yorumlar tam ekran açılabiliyor.',
    features: [
      {
        major: true,
        title: 'Tam ekran açıklama ve yorumlar',
        description:
          'Uzun bir açıklama ya da kalabalık bir yorum dizisi görev penceresine sığmıyorsa tam ekrana al: açıklama düzenleyicisinin araç çubuğundaki ⤢ düğmesi düzenleyiciyi ekranın tamamına yayar (yazdıkların, geri alma geçmişi ve yüklenen görseller korunur; metin ortada okunaklı genişlikte). "Yorumlar" başlığındaki ⤢ ile yorumların tamamı ve yazma alanı ekranı kaplar. Yazı alanındayken ilk Esc alandan çıkar, sonraki Esc tam ekranı kapatır, bir sonraki görev penceresini; üst çubuktaki ⤡ da kapatır.',
      },
    ],
    fixes: [],
  },
  {
    version: '0.6.7',
    date: '2026-09-01',
    summary: 'Görevler arasında bağlantı türleri (engelliyor / bekliyor / ilişkili / kopya); engellenen görevde uyarı; sütun başlıklarında durum simgeleri; ardışık bildirimler tek mesajda.',
    features: [
      {
        major: true,
        title: 'Bağlantı türleri',
        description:
          'Bir görevi başka bir göreve bağlarken artık türünü seçiyorsun: Engelliyor (bu bitmeden diğeri tamamlanamaz), Bekliyor (bilgi amaçlı yumuşak bağ), İlişkili (yönsüz) ve Kopya. Görev penceresindeki "Bağlı görevler" bölümü iki yönlü: Engelleyenler / Engelliyor / Bekleyenler / Bekliyor / İlişkili / Kopya başlıkları altında listeler; türü satırdaki seçiciden sonradan değiştirebilirsin, değişiklik aktivite günlüğüne düşer. Panodaki kartta açık bir engelleyeni olan görev ⛔ rozetiyle görünür; böyle bir görevi tamamlamaya kalkınca pencere önce engelleyenleri gösterir, "Yine de tamamla" ile geçebilirsin.',
      },
      { title: 'Kanban sütun başlıklarında renkli yuvarlak yerine durumun kendi simgesi (Yapılacak / Devam Ediyor / İncelemede / Tamamlandı / Bloke aynı simge diliyle)' },
      { title: 'Bildirimler birleşiyor: aynı kişi aynı görevde art arda birkaç şey yaptığında (atama + yorum + durum) uygulamada tek bir bildirim, Telegram’da tek bir mesaj geliyor; mesaj neler olduğunu madde madde sayıyor' },
      { title: 'Üst göreve bağla / görev bağla penceresi genişledi, uzun başlıklar iki satıra sığıyor; bağlantı türü aynı pencereden seçiliyor' },
    ],
    fixes: [
      { title: 'Sütunun altındaki "Görev ekle" alanı artık ilk tıkı yutmuyor: alan açıkken başka bir yere tıklamak hem alanı kapatıyor hem de tıklanan şeyi çalıştırıyor' },
      { title: 'Filtre menüsünde alt menü açıkken Backspace ya da ← alt menüyü kapatıp ölçüte geri dönüyor' },
      { title: 'Bitirme kutlaması görev penceresinde ekranda görünen durum yuvarlağında oynuyor (dar ekranlarda gizli kalan kopya seçilmiyor); tik sesi animasyonla aynı anda' },
    ],
  },
  {
    version: '0.6.6',
    date: '2026-09-01',
    summary: 'Yönetim ekranına ağ trafiği ve istek günlüğü geldi.',
    features: [
      {
        major: true,
        title: 'Yönetim → Ağ & İstekler',
        description:
          'Fira trafiği şu an (son dakika), son 1 saat, bugün ve bu ay; istek sayısı, ortalama ve p95 süre; sunucu ağ kartının anlık hızı ve toplamı (paylaşımlı sunucu, bağlam için). Dakika bazında üç grafik (istek, trafik, 429/5xx), son 1 saatin en çok istenen yolları. Sınıra takılan (429) ve hatalı (5xx) istekler zaman/IP/yol/süre ile 7 gün geriye; son 300 gelen istek durum, yol veya IP ile filtrelenerek incelenebiliyor. Genel Bakış’ta yeni “Ağ (Fira)” kartı; son 1 saatte 429 ya da 5xx varsa ve günlük trafik eşiği aşılırsa uyarı.',
      },
    ],
    fixes: [],
  },
  {
    version: '0.6.5',
    date: '2026-09-01',
    summary: 'Takım listesinin kaybolup geri gelmesi giderildi; giriş sınırı yalnızca gerçekten giriş denemelerine uygulanıyor.',
    features: [],
    fixes: [
      { title: 'Takım listesi arada kaybolup geri geliyordu: uygulama her işlemde kimliği sunucudan yeniden doğruluyordu ve bugün eklenen istek sınırına takılıyordu. Artık kimlik yerel oturumdan okunuyor (bir tık = bir istek daha az), sunucudaki sınır da yalnızca şifreyle giriş, kayıt ve şifre sıfırlama uçlarında' },
    ],
  },
  {
    version: '0.6.4',
    date: '2026-09-01',
    summary: 'Daha akıcı bir görev penceresi: anında güncellenen atamalar, tek tıkla atama kaldırma, üst göreve bağlama, klavyeyle filtre; arkada oran sınırlama ve RLS denetimi.',
    features: [
      { title: 'Atanan kişinin yanındaki × ile atama tek tıkla kaldırılıyor; atama ekleme/kaldırma, durum/öncelik değişimi, alt görev ve hızlı görev ekleme artık beklemeden ekrana yansıyor (sunucu reddederse geri alınıyor)' },
      { title: 'Görev başlığının solundaki bağlantı düğmesiyle görev bir üst göreve bağlanabiliyor — alt görevi üstten bağlamanın tersi' },
      { title: 'Filtre menüsü klavyeyle kullanılabiliyor: F açar ve ilk ölçüte odaklanır, ↑↓ gezer, → ölçütü açar, ← geri döner, Enter işaretler' },
      { title: '“Diğer listelerde ara” satırında aktif filtre varsa “Filtreleri temizle ve tekrar ara” düğmesi' },
      { title: 'Yorum gönderince liste yeni yoruma kaydırılıyor (başkasının yorumu gelince kaydırmıyor)' },
    ],
    fixes: [
      { title: 'Bitirme animasyonu görev penceresindeki durum yuvarlağının tam üstüne oturuyor ve pencere açıkken arkadaki kartta oynamıyor' },
      { title: 'Güvenlik: profil listesi artık yalnızca takımdaşlarını gösteriyor (başka takımların e-postaları görünmüyor); takım koduyla katılmada deneme sınırı (15 dakikada 5); davetlerin süresi var (14 gün); anon anahtarıyla çağrılabilen RPC kalmadı; giriş ve API uçlarında istek sınırı' },
    ],
  },
  {
    version: '0.6.3',
    date: '2026-09-01',
    summary: 'Klavye kısayolları geldi; kutlama artık durum yuvarlağında ve tam anında; sütunun üstüne bırakılan kart üste geliyor.',
    features: [
      {
        major: true,
        title: 'Klavye kısayolları',
        description:
          'Panoda tek tuşla: / aramaya odaklanır, f filtre menüsünü açar, n yeni görev, v Kanban ↔ Liste, b ve l doğrudan görünüm seçer; virgül ayarları, ? kısayol tablosunu açar. Yazı alanındayken hiçbiri devreye girmez. Tüm liste Ayarlar → Kısayollar sekmesinde: her kısayol oradan değiştirilebilir, çakışma uyarısı verilir, "Varsayılanlar" ile geri dönülür; sabit tuşlar (Esc, Ctrl+Enter…) da orada belgelenmiştir. Tercihler hesabına bağlıdır, başka tarayıcıda da geçerlidir.',
      },
    ],
    fixes: [
      { title: 'Bitirme kutlaması: ses tam tamamlanma anında çalıyor (ses motoru ilk tıklamada ısınıyor); konfeti yerine tamamlanan görevin durum yuvarlağında “tik” animasyonu — görev penceresinde, kartta ve listede aynı anda' },
      { title: 'Kanban: bir kartı başka sütunun üstüne (başlık/“Görev ekle” hizasına) bırakınca kart artık en üste geliyor; eskiden sütunun boş alanı “sona ekle” sayılıyordu. Bir kartın üzerine bırakırken üst/alt yarı da hesaba katılıyor' },
    ],
  },
  {
    version: '0.6.2',
    date: '2026-09-01',
    summary: 'Görev bitince küçük bir kutlama; giriş ve kayıt ekranları aynı çatı altında; silinen dosyalar artık depoda kalmıyor.',
    features: [
      {
        major: true,
        title: 'Bitirme kutlaması',
        description:
          'Bir görevi tamamladığında kısa bir ses ve küçük bir konfeti: görev penceresindeki durum çekmecesinden, panoda tamamlandı sütununa sürükleyerek ya da alt görev listesinden — nereden bitirdiysen kutlama oradan çıkıyor, görevin panodaki kartı ve listedeki satırı da hafifçe titriyor. Cihazın "hareketi azalt" ayarına saygı duyuyor; Ayarlar → Temalar altından tamamen kapatılabiliyor.',
      },
      { title: 'Giriş, kayıt ve şifre değiştirme ekranları aynı marka paneli ve aynı bileşenlerle yenilendi; koyu temada da tutarlı' },
    ],
    fixes: [
      { title: 'Ek silinince, liste logosu ya da arkaplanı değiştirilince eski dosya depodan da siliniyordu; artık siliniyor. Yönetim panelindeki yetim dosya taraması liste arkaplanlarını canlı dosya sayıyor (önceden onları da silecekti)' },
      { title: 'Henüz yapılandırılmamış Google ile giriş düğmesi giriş ekranından kaldırıldı (sunucuda etkinleşince tek bayrakla geri gelir)' },
    ],
  },
  {
    version: '0.6.1',
    date: '2026-09-01',
    summary: 'Arama diğer listelere uzanıyor; durum ve etiket renkleri takım paletinden; içe aktarmada bildirim seli yok.',
    features: [
      {
        major: true,
        title: 'Aranan bu listede yoksa: “Diğer listelerde ara”',
        description:
          'Arama açık listede sonuç vermeyince panonun üstünde bir satır çıkıyor ve tek düğmeyle aynı arama erişebildiğin bütün listelerde yapılıyor. Sonuçlar takım › liste başlıkları altında, durum etiketiyle listeleniyor; birine tıklayınca pano o listeye geçip görevi açıyor.',
      },
      { title: 'Durum ve etiket renkleri artık takım paletinden seçiliyor (listeler ve klasörlerle aynı renkler); eski bir renk paletten değilse “eski renk” olarak görünmeye devam ediyor, sessizce değişmiyor' },
      { title: 'Yoruma yapıştırılan görsel artık görevin “Dosyalar” bölümüne de ekleniyor — açıklamadaki davranışla aynı' },
    ],
    fixes: [
      { title: 'Kısa kimlikle arama başında # varken de çalışıyor (#118F5C); tam kimlik de yapıştırılabiliyor' },
      { title: 'İçe aktarma sırasında kişilere onlarca bildirim gitmiyor: aktarımın yazdığı olaylar bildirilmiyor, bunun yerine aktarma bitince tek bir özet (Telegram) gidiyor; ayrıca kısa sürede çok bildirim üretilirse Telegram ve tarayıcı bildirimleri tek özete katlanıyor' },
    ],
  },
  {
    version: '0.6.0',
    date: '2026-08-31',
    summary: 'Bildirimler telefona çıktı: Telegram botu, kanal başına ayar ve bottan görev sorgulama.',
    features: [
      {
        major: true,
        title: 'Telegram bildirimleri',
        description:
          'Fira kurum VPN’inin arkasında olduğu için telefona ne uygulama ne de VPN istemcisi kurulabiliyordu; bildirimler ancak bilgisayarda Fira açıkken görünüyordu. Artık @flpFiraBot üzerinden Telegram’a düşüyorlar. Bağlamak için: Ayarlar → Bildirimler → Telegram → "Bağlantı kodu al", sonra bota /start KOD. Fira kapalıyken olan değişiklikler de gelir — bot sunucuda çalıştığı için hiçbir olay kaçmaz.',
      },
      {
        major: true,
        title: 'Bildirim ayarları kanal kanal',
        description:
          'Beş olayın (atama, yorum, durum, alt görev, dosya) her biri için üç kanal ayrı ayrı işaretlenebiliyor: uygulama içi, tarayıcı bildirimi, Telegram. "Yorumlar yalnızca Telegram’a, atamalar her yere" gibi bir kurgu artık mümkün.',
      },
      {
        major: true,
        title: 'Bottan görev sorgulama ve durum değiştirme',
        description:
          'Telegram’da /bana ile sana atanmış açık görevleri, /bugun ile bugünün ve geciken işlerini, /gorev 118F5C ile bir görevin kartını görebiliyorsun. Bildirimin ve kartın altındaki düğmelerle durumu değiştirebiliyorsun; değişiklik Fira’da normal bir güncelleme gibi işleniyor ve yetkin yoksa reddediliyor.',
      },
    ],
    fixes: [
      {
        title: 'Uygulama dışından (script, içe aktarma) yapılan değişikliklerde aktivite günlüğü yanlış kişiyi gösteriyordu; bu yüzden kendi yapmadığın değişiklikler için bildirim de gelmiyordu',
      },
    ],
  },
  {
    version: '0.5.1',
    date: '2026-08-31',
    summary: 'Sütun içi sıralama artık tahmin edilebilir: durumu değişen görev hedef sütunun en üstünde belirir.',
    features: [
      {
        major: true,
        title: 'Sıralama kuralları',
        description:
          'Bir görevin durumunu Durum alanından (ya da kart menüsünden, alt görev satırından) değiştirdiğinizde görev, gittiği sütunun en üstünde beliriyor — aşağıda kaybolmuyor. Sürükleyip bıraktığınızda ise bıraktığınız yerde kalıyor: elle verdiğiniz sıra kalıcı. Elle sıraladığınız bir sütuna durum değişikliğiyle yeni bir görev geldiğinde o da en üste yerleşiyor. "Kapatılanları gizle" açıkken boş görünen bir sütuna görev bıraktığınızda, kapatılanları tekrar gösterdiğinizde de en son bıraktığınız görev en üstte duruyor.',
      },
    ],
    fixes: [
      { title: 'Sürükle bırak artık tek istekte kaydediliyor (eskiden kart başına bir istek gidiyordu); filtreyle gizlenen kartlar görünen kartların arasına karışmıyor' },
    ],
  },
  {
    version: '0.5.0',
    date: '2026-08-31',
    summary: 'Kişisel olan her şey profil menüsüne taşındı: ayarlar, bildirimler ve tema tek pencerede.',
    features: [
      {
        major: true,
        title: 'Profil menüsü',
        description:
          'Üst çubuk boşaldı: sağ üstteki avatara tıklayınca açılan menüde Ayarlar, Bildirimler, Temalar, Sürüm notları, (yöneticiyseniz) Yönetim ve Çıkış yap var. Ayarlar penceresi soldaki sekmelerle üçe ayrılıyor — profil bilgileri ve şifre, bildirim tercihleri, görünüm. Panoda yalnızca işe yarayan iki şey kaldı: "Yeni Ticket" ve avatarınız.',
      },
      {
        major: true,
        title: 'Bildirimler artık sizin kurgunuz',
        description:
          'Hangi durumda haber almak istediğinizi kendiniz seçiyorsunuz: göreve atanma, yeni yorum, durum değişikliği, alt görev eklenmesi ve dosya eklenmesi ayrı ayrı açılıp kapatılıyor. İki kanal var: uygulama içi (Fira açıkken sağ altta beliren kart, tıklayınca göreve gider) ve tarayıcı bildirimi (izin verdiyseniz, Fira arka plandayken işletim sistemi bildirimi). Kendi yaptığınız değişiklikler size bildirilmez; yalnızca atandığınız ya da açtığınız görevler için bildirim gelir. E-posta bildirimi sunucuda SMTP kurulunca eklenecek.',
      },
      {
        major: true,
        title: 'Tema seçimi: Açık · Koyu · Otomatik',
        description:
          'Görünüm sekmesinde üç küçük önizleme kartı: açık, koyu ve otomatik. Varsayılan artık Otomatik — Fira, bilgisayarınızın/tarayıcınızın temasını izliyor ve siz gece moduna geçtiğinizde sayfayı yenilemeye gerek kalmadan kendisi de değişiyor. Elle bir tema seçerseniz o seçim korunur.',
      },
      { title: 'Tüm cihazlarda oturumu kapatma: Ayarlar → Oturumlar (telefon, tablet ve diğer tarayıcılar dahil)' },
    ],
    fixes: [
      { title: 'Üst çubuktaki tema düğmesi, isim etiketi, "Yenilikler" ve "Çıkış" düğmeleri kaldırıldı; hepsi profil menüsünde' },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-08-28',
    summary: 'Tek görev modeli: alt görevler artık tam birer görev; durumların kategorisi var (Backlog · Aktif · Bloke · Tamamlandı · Kapatıldı) ve checkbox yerine durum göstergesi geldi.',
    features: [
      {
        major: true,
        title: 'Yorumlar artık açıklama gibi yazılıyor',
        description:
          'Yorum kutusu açıklamayla aynı editör oldu: çok satırlı yazabiliyor, Markdown biçimlendirmesini yazarken görüyor, "/" komutlarını kullanabiliyor ve Ctrl+V ile görsel yapıştırabiliyorsun — görsel yorumun içine yerleşiyor. Görsel olmayan dosyalar (PDF, Word, Excel…) yine "Dosyalar" bölümüne ekleniyor, tıpkı açıklamada olduğu gibi. Ctrl+Enter gönderir; gönderilen yorumlar biçimli olarak görüntüleniyor.',
      },
      { title: 'Arama artık başlıkların yanı sıra açıklamalarda ve yorumlarda da arıyor' },
      { title: 'Yan menüdeki takımlar sürüklenerek sıralanabiliyor; sıra kişiye özel, diğer üyeleri etkilemiyor' },
      {
        major: true,
        title: 'Sütundan hızlı görev ekleme',
        description:
          'Her sütunun başında "Görev ekle" var: küçük bir kart açılıyor, görev adını yazıyorsun, istersen son tarih ve ilk atamayı da veriyorsun. Görev, açtığın sütunun durumuyla ve listenin en üstünde oluşuyor; kart açık kaldığı için arka arkaya birkaç görev girmek kolay. Enter kaydeder, Esc kapatır.',
      },
      {
        major: true,
        title: 'Listeye özel pano arkaplanı',
        description:
          'Takım sahibi ve yöneticileri her listeye ayrı bir arkaplan verebiliyor (Liste ayarları → Pano arkaplanı). Mühendislik ve tasarım temalı 20 sade desen öneriliyor; beğenmezsen "Yeni 20 öneri" ile başka bir set geliyor, ya da kendi resmini yüklüyorsun. Yazılar okunur kalsın diye arkaplanın üstüne temaya uygun bir örtü konuyor.',
      },
      {
        major: true,
        title: 'Alt görev = görev',
        description:
          'Alt görevler artık ayrı bir kayıt değil, üst görevi olan görevlerdir: durumu, atananları, etiketleri, dosyaları, yorumları ve son tarihi vardır; kendileri de alt görev taşıyabilir (3 seviye). Alt görev satırına tıklayınca kendi penceresi açılır, üstte "Üst görev" bağlantısı görünür; ✕ ile üst görevden ayrılıp bağımsız görev yapılabilir. Var olan tüm alt görevler aynı ID ile taşındı.',
      },
      {
        major: true,
        title: 'Durum kategorileri ve durum göstergesi',
        description:
          'Her durumun adı ve renginin yanında bir kategorisi var: Backlog (kesik daire), Aktif (renkli halka), Bloke (⏸), Tamamlandı (✓, görünür kalır), Kapatıldı (dolu ✓; İptal alt tipi ✕, tamamlanmış sayılmaz). Kategori Durum Yönetimi ekranında seçilir; her listede en az bir Kapatıldı durumu bulunur. Alt görev satırlarında checkbox yerine gösterge; tıklayınca kategori gruplu durum menüsü.',
      },
      {
        major: true,
        title: 'Yedekleme ve taşıma (Export / Import)',
        description:
          'Takım ayarları → Yedek ve Taşıma: tam yedek (ZIP: tüm veri + dosyalar, Fira JSON şeması v1), CSV/Excel paketi ve Jira / ClickUp / MS Planner / Notion profilleri (karşılığı olmayan alanlar listelenir). Yedekten içe aktarma: önizleme, Geri yükle / Yalnızca eksikleri ekle / Kopyala modları, tek işlemde uygulanır, dosyalar geri yüklenir. Başka araçtan CSV: sütun eşleme sihirbazı ve kuru çalıştırma. Sunucuda her gece otomatik veritabanı + dosya yedeği.',
      },
      {
        major: true,
        title: 'Yönetim sayfası (/admin)',
        description:
          'Sistem yöneticileri için tek yerden bakış: sağlık kartları (servisler, veritabanı, storage, son yedek, sertifika, disk), kurulum bilgileri ve destek raporu, kullanım metrikleri (günlük oluşturulan/kapatılan, aktif kullanıcılar, liste bazında açık iş, CSV), yedek & storage (en büyük dosyalar, yetim dosya temizliği), kullanıcı ve takım yönetimi (yönetici yetkisi, devre dışı bırakma, oturum kapatma), araçlar (herkese duyuru, bakım modu, herkese yenile gönder, arşiv temizliği, uyarı eşikleri), günlükler (giriş, yönetim işlemleri, sunucu raporları) ve deploy geçmişi. Sunucu raporu 5 dakikada bir toplanır; eşik aşımlarında uyarı.',
      },
      { title: 'Tercihler sunucuda: Kanban/Liste seçimi, filtreler ve son açılan liste kullanıcı × liste bazında saklanır; sayfa yenilense ya da başka tarayıcıdan girilse de aynı gelir' },
      { title: 'Kapatıldı kategorisindeki görevler varsayılan görünümde gizlenir; Filtre menüsünden "Kapatılanları göster" ve "Alt görevleri de göster" anahtarları' },
      { title: 'Kartta ve alt görev listesinde bloke alt görev rozeti (⏸ n)' },
      { title: 'Bağlı görevler ayrı bölümde (ilişkili görev ≠ alt görev); durum silerken görevler seçilen duruma taşınır' },
      { title: 'Yeni marka kimliği: 3B kurdele "F" işareti ve yeni "fira" logotipi; yan menü, giriş ekranı, sekme ikonu ve telefona kurulan uygulama ikonu yenilendi' },
      {
        major: true,
        title: 'Görev aktivite günlüğü',
        description:
          'Bir görevde ne olduğu artık tam olarak kayıtlı: durum geçişleri (hangi durumdan hangisine), öncelik, başlık, açıklama, bitiş tarihi, atamalar, etiketler, dosyalar, son tarihler, alt görev ekleme/çıkarma, arşivleme ve yorumlar. Yorumların altındaki “Aktivite” bölümünden kronolojik olarak (önce yeni ya da önce eski) incelenebiliyor. Görev tamamlandığında bu geçiş, oluşturulma bilgisinin yanında “Tamamlandı” olarak ayrıca gösteriliyor. Kayıtlar veritabanı tarafında tutulduğu için uygulama dışından yapılan değişiklikler de görünüyor.',
      },
      {
        major: true,
        title: 'Excel ile içe aktarma: Microsoft Planner planları tek dosyada',
        description:
          'Planner\'ın .xlsx dışa aktarımını olduğu gibi verin — CSV\'ye çevirmeye gerek yok. Dosyadaki tüm sayfalar birlikte okunur: kutular sütun olur (Planner\'daki sırasıyla), denetim listesi maddeleri alt göreve dönüşür, etiketler etiket, notlar açıklama olur, kişiler e-posta ya da ad ile takım üyelerine eşlenir. Fira\'da karşılığı olmayan alanlar (plan, hedef, oluşturan, tamamlanma, yinelenme, gecikme, Planner durumu, görev kimliği) görev açıklamasındaki “Planner alanları” bloğunda saklanır — hiçbir veri düşmez. Aktarmadan önce ne olacağını gösteren kuru çalıştırma raporu var; sütunları kutular yerine Planner durumundan da üretebilirsiniz.',
      },
    ],
    fixes: [
      { title: 'Alt görevi açıp Esc ile geri dönünce görev penceresi kaldığın yerde açılıyor; başa sarmıyor' },
      { title: 'Alt göreve üst görevin ekranından atama yapıldığında liste hemen güncelleniyor (aynısı durum, öncelik, etiket ve yorum sayısı için de geçerli)' },
      { title: 'Yorumlar, dosyalar ve aktivite listeleri kendi içlerinde kaydırılıyor; uzun listeler artık görev penceresini uzatmıyor' },
      { title: 'İçe aktarılan görevin "Oluşturan" bilgisi artık dış sistemdeki kişiyi gösteriyor; görevi kimin aktardığı aktivite günlüğünde duruyor' },
      { title: 'Orta öncelik artık varsayılan; önceliksiz kalmış tüm görevler orta önceliğe alındı ve orta bayrağı panoyu meşgul etmiyor (düşük/yüksek/kritik göze çarpsın diye)' },
      { title: 'Boş bir durumu silerken "görevler nereye taşınsın?" diye sorulmuyor; dolu durumda ise kaç görev taşınacağı yazıyor' },
      { title: 'Atanan, yorum ya da eki olan görevler silinemiyordu (aktivite günlüğü hatası) — düzeltildi' },
      { title: 'Sütun başındaki "Görev ekle" artık altındaki kartlarla aynı görünümde' },
      { title: 'Boş sütunların başlığı diğerlerinden birkaç piksel yukarıda duruyordu; sayaç artık sıfırken de (sessizce) yazıldığı için tüm sütunlar aynı hizada' },
      { title: 'Planner aktarımında kutu ile durum çelişirse durum kazanıyor: "Tamamlandı" işaretli görevler kutusu ne olursa olsun tamamlandı sütununa gidiyor (kutu bilgisi açıklamada kalıyor)' },
      { title: 'Planner’daki tamamlanma tarihi ve tamamlayan kişi aktivite günlüğüne gerçek bir durum geçişi olarak yazılıyor; görev penceresindeki "Tamamlandı" bilgisi de bundan besleniyor' },
      {
        major: true,
        title: 'İçe aktarmadan gelen kişiler',
        description:
          'Başka bir araçtan veri aktarılırken orada geçen ama Fira hesabı olmayan kişiler artık kayboluşmuyor: her biri için "içe aktarmadan geldi" işaretli bir kayıt açılıyor ve atamaları, tamamladığı işler, aktivite kayıtları o kişiye bağlanıyor. Bu kayıtlar giriş yapamaz, yetkileri yoktur; avatarları kesik çizgili çerçeveyle işaretlenir. Kişi sonradan aynı e-posta ile Fira\'ya kayıt olduğunda tüm geçmişi otomatik olarak yeni hesabına geçer — sisteme sonradan katılan biri ilk girişte kendi işlerini hazır bulur. Yönetim panelinde bu kayıtlar listeleniyor, e-posta/ad/ID ile aranıp "yalnızca içe aktarmadan gelenler" diye filtrelenebiliyor; böylece ayrılmış ya da hiç hesabı olmayan kişiler görünür kalıyor.',
      },
      { title: 'Takım sahipliği devri: Takım ayarları → Genel → "Sahipliği devret" (eski sahip yönetici olur)' },
      { title: 'Daha sade Kanban: sütun kutuları kaldırıldı (kenarlık, arka plan, çizgiler); "Buraya bırak" yalnızca sürüklerken görünür' },
      { title: 'Boş sütunlarda sade bir "Görev yok" göstergesi; kart sürüklenirken yerini bırakma hedefine bırakıyor' },
      { title: 'Durum Yönetimi penceresi genişletildi; durum adları ve kategori seçici kırpılmıyor' },
      { title: 'Kanban sütunları başlığı basılı tutup çekerek sıralanır (klavye: başlığa odaklanıp Space + ok tuşları)' },
      { title: 'Alt görev listesinde "Tamamlananları gizle" tercihi kişi ve görev bazında hatırlanır' },
      { title: 'Alt görev silinip üst göreve dönülünce "Evet, sil" onayı takılı kalmıyor' },
      { title: 'Başka sekme/PWA penceresi açıkken sayfa açılışındaki 10 sn gecikme (oturum kilidi) giderildi' },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-08-27',
    summary: 'Takımlar yeniden ele alındı: GitHub benzeri roller, e-posta ile davet, ClickUp tarzı Takım → Klasör → Liste hiyerarşisi, liste ikonları ve takım renk paleti.',
    features: [
      {
        major: true,
        title: 'Roller ve yetkiler',
        description:
          'Takım üyeleri artık Sahip, Yönetici, Üye veya İzleyici rolündedir. Yöneticiler listeleri, klasörleri, üyeleri ve davetleri yönetir, herkesin ticket ve alt görevini silebilir; üyeler yalnızca kendi oluşturduklarını siler; izleyiciler yalnızca görüntüler ve yorum yazar. Kurallar veritabanı düzeyinde (RLS) uygulanır.',
      },
      {
        major: true,
        title: 'Takım yönetimi ekranı',
        description:
          'Takımın yanındaki dişli: Üyeler (rol değiştir, çıkar, kayıtlı kullanıcıyı e-postayla ekle), Davetler (e-posta + rol ile davet, link kopyala, iptal), Renkler (takım paleti) ve Genel (ad, takım kodu, silme) sekmeleri.',
      },
      {
        major: true,
        title: 'E-posta ile davet',
        description:
          'Davet bir e-posta adresine ve role bağlanır. Kişi Fira\'ya o adresle girdiğinde daveti panonun üstünde görür ve tek tıkla kabul eder; e-posta göndermeye gerek yoktur. Davet linki de rolü taşır ve katılmadan önce hangi takıma hangi rolle katılınacağını gösterir.',
      },
      {
        major: true,
        title: 'Klasörler ve listeler',
        description:
          '"Proje" artık "Liste". Listeler doğrudan takımın altında ya da klasörlerin içinde durabilir (Takım → Klasör → Liste). Her listenin bir ikonu (hazır ikon seti) ya da küçük bir logosu (örneğin müşteri logosu) ve takım paletinden seçilen bir rengi vardır.',
      },
      { title: 'Yeni fira logosu: renkli F işareti, favicon ve küçük harf yazı markası' },
      { title: 'Yüklenebilir uygulama (PWA): tarayıcıdan ya da yan menüdeki "Uygulama olarak yükle" ile masaüstü/telefona kurulur; yeni sürüm çıkınca "Yenile" çubuğu görünür' },
      { title: 'Takım renk paleti: serbest renk kodu yerine önce adlandırılmış renkler oluşturulur, liste ve klasörler bu paletten seçer' },
      { title: 'Atama ve filtre listeleri artık tüm kullanıcıları değil, yalnızca takım üyelerini gösterir' },
      { title: 'Takıma katılım yalnızca güvenli sunucu fonksiyonlarıyla yapılır (kod, link, e-posta daveti); kimse kendine rol atayamaz' },
      { title: 'Ticket, alt görev ve kart başlıklarının yanında silik kısa ID; tıklayınca tam ID panoya kopyalanır' },
      { title: 'Var olan bir ticket alt görev olarak bağlanabilir (alt görev satırındaki zincir simgesi): başlık ve durum canlı yansır, tıklayınca o ticket açılır; döngü ve takım dışı bağlantılar engellenir' },
      {
        major: true,
        title: 'Hızlı kişi atama',
        description:
          'Kanban kartında atananlar sağ altta; kartın üzerine gelince solunda kişi ekleme butonu çıkar. Liste görünümünde ve ticket içinde de aynı: avatara ya da butona tıklayınca kişi seçici açılır (ad/e-posta arama, üstte Atanmış olanlar ✕ ile kaldırılır, altında Öneriler).',
      },
      {
        major: true,
        title: 'Ortak filtreleme (Kanban + Liste)',
        description:
          'Filtre ve arama artık başlık çubuğunda, her iki görünümde aynı yerde (MS Planner tarzı). "Filtre (n)" menüsü: Atama (kişi arama, Atanmayan), Etiketler, Öncelik, Durum ve Son tarih (Geçmiş, Bugün, Yarın, Bu hafta, Gelecek hafta, Daha sonra, Tarih yok); "Tümünü temizle" ile sıfırlama. Seçimler görünümler arasında korunur.',
      },
      {
        major: true,
        title: 'Dosyalar alanı yenilendi',
        description:
          'ClickUp tarzı dosya alanı: ızgara/liste görünümü, kartlarda önizleme, yükleyen ve tarih; üzerine gelince tam ekran ve ⋯ menüsü (indir, yeni sekmede aç, bağlantıyı kopyala, yeniden adlandır, sil). Tam ekran görüntüleyicide yakınlaştırma/sığdırma, ←/→ ile gezinme, indirme ve silme. Başlıktan tümünü indirme ve bölümü daraltma.',
      },
    ],
    fixes: [
      { title: 'Takımlar ve üyeler artık yalnızca kendi takımlarındaki kişiler tarafından görülebilir' },
      { title: 'Pano kartları ve açık ticket artık başka bir sekmede/kullanıcıda yapılan değişikliklerde (alt görev, yorum, dosya, atama) canlı güncellenir' },
      { title: 'Kurulu uygulama (PWA) penceresinin başlık çubuğu artık temayı izliyor (açıkta beyaz, koyuda yüzey rengi); dar pencerede liste adı kırpılmıyor' },
      { title: 'URL ile ya da başka bir liste seçiliyken açılan ticket\'ta Durum ve Etiket listeleri panodaki listeden değil ticket\'ın kendi listesinden geliyor' },
      { title: 'Kanban sütunları az kart olsa da panonun altına kadar uzanıyor (daha geniş bırakma alanı); uzun sütunlar kendi içinde kayıyor' },
      { title: 'Açıklama editöründe Esc ve Ctrl+Enter yazmayı bitirip alandan çıkar (kaydeder); Esc artık pencereyi kapatmaz' },
      { title: 'Girişte "Failed to fetch": API adresi artık sayfanın açıldığı origin üzerinden çözülüyor; alan adı ya da IP ile açılsa da çalışır' },
    ],
  },
  {
    version: '0.2.3',
    date: '2026-08-27',
    features: [
      {
        major: true,
        title: 'Panodan yapıştır → dosya eki',
        description:
          'Ticket açıkken Ctrl+V (veya sağ tık → Yapıştır) ile panodaki dosya/görsel doğrudan Dosyalar\'a eklenir. Odak açıklama editöründeyse görsel hem açıklamaya hem Dosyalar\'a gider. Dosyalar\'dan silinen görsel açıklamadan da kaldırılır; açıklamadan silmek eki etkilemez.',
      },
    ],
    fixes: [],
  },
  {
    version: '0.2.2',
    date: '2026-08-27',
    features: [
      { title: 'Öncelik artık isteğe bağlı: yeni ticket ve alt görevler önceliksiz başlar; seçili önceliğe tekrar tıklayarak veya ✕ ile kaldırılabilir' },
    ],
    fixes: [],
  },
  {
    version: '0.2.1',
    date: '2026-08-27',
    features: [
      {
        major: true,
        title: 'Kanban kartlarında içerik göstergeleri',
        description:
          'Kartta alt görev sayacı ve ilerleme çubuğu (☑ 2/5, tamamlanınca yeşil), açıklama, ekli görsel/dosya ve yorum sayısı otomatik görünür; veri yoksa yer kaplamaz. Ticket başına "panoda göster" ayarı gerekmez.',
      },
    ],
    fixes: [],
  },
  {
    version: '0.2.0',
    date: '2026-08-27',
    summary: 'Self-hosted altyapıya geçiş, ClickUp tarzı açıklama editörü ve alt görev deneyiminin baştan ele alınması.',
    features: [
      {
        major: true,
        title: 'Markdown odaklı açıklama editörü',
        description:
          'Yazarken dönüşen Markdown (# başlık, - liste, [] görev, > alıntı, ``` kod, --- ayırıcı, **kalın**, [metin](url)), "/" komut menüsü, seçimde beliren biçimlendirme balonu, tablo desteği, bağlantı popover\'ı (Ctrl+K), görsel yükleme butonu ve "/markdown" ile hazır .md metni biçimli yapıştırma.',
      },
      {
        major: true,
        title: 'Alt görevler yeniden tasarlandı',
        description:
          'Sürükle-bırak sıralama, yerinde geri sayımlı silme (5 sn "Geri al"), her zaman açık ekleme satırı (Enter ile hızlı giriş), satır içi yeniden adlandırma, açıklama/gecikme göstergeleri, tamamlananları gizleme ve alt görevi bağımsız ticket\'a dönüştürme.',
      },
      {
        major: true,
        title: 'Tema tokenları',
        description:
          'Tüm nötr renkler semantik tema değişkenlerine bağlandı; açık/koyu tema tutarlı, yeni temalar tek bir blokla eklenebilir. Durum ve etiket renkleri koyu temada otomatik açıltılır.',
      },
      { title: 'Alt görev detayı ticket penceresinin içinde açılır; tarayıcı Geri tuşu önce alt görevi, sonra ticket\'ı kapatır (paylaşılabilir #st= linki)' },
      { title: 'Yorum ve dosya bölümleri karanlık temaya uyarlandı' },
      { title: 'Silme işlemleri tarayıcı uyarısı yerine yerinde onay kullanıyor' },
      { title: 'Alt görev başlıkları uzun olduğunda satır kırıyor' },
    ],
    fixes: [
      { title: 'Bitiş tarihi alanına yıl yazılamıyordu (11.11.2022 gibi değerler ara adımda sıfırlanıyordu)' },
      { title: 'Alt görev görünümünde Esc, ana ticket penceresini de kapatıyordu' },
      { title: 'Liste görünümü "archived_at" kolonu eksik olduğu için hata veriyordu' },
      { title: 'Takım adları yan menüde kırpılıyordu; chevron sağa hizalandı' },
      { title: '"Şifremi değiştir" bağlantısının yeri ve tab sırası düzeltildi' },
      { title: 'Karanlık temada kaydırma çubukları ve imleç görünmüyordu' },
      { title: 'Çıkış sonrası giriş sayfası tema ile tutarsızdı' },
      { title: 'Açıklama alanındaki yer tutucu her boş satırda görünüyordu' },
      { title: 'Editör araç çubuğunun yapışkan (sticky) davranışı kaldırıldı' },
      { title: 'Karanlık temada liste görünümünde okunaklılık (durum rozetleri, filtreler, tarihler)' },
      { title: 'Durum/etiket renk paleti alt görev ve ticket arasında farklıydı' },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-03-20',
    summary: 'İlk sürüm: Kanban ve liste görünümleri, takımlar, projeler, özel durumlar, etiketler, çoklu atama, alt görevler, yorumlar, dosya ekleri, karanlık mod.',
    features: [
      { major: true, title: 'Kanban ve liste görünümü', description: 'Sürükle-bırak ile durum değiştirme, proje başına özelleştirilebilir durumlar, filtrelenebilir liste.' },
      { title: 'Takım ve proje yönetimi (davet linki, katılım kodu)' },
      { title: 'Ticket detayı: açıklama, alt görevler, yorumlar, dosya ekleri, etiketler, çoklu atama, ekstra son tarihler' },
      { title: 'Karanlık mod' },
      { title: 'Mobil uyumlu arayüz' },
    ],
    fixes: [],
  },
]

// APP_VERSION src/version.ts'te (package.json'dan); bu dosya ana pakete girmesin diye (#74d303e2).
