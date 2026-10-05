/** Turkish is the source of truth for this namespace; en/de are typed against
 *  TicketExtraDict, so an untranslated key is a compile error. */
export const ticketExtra = {
  // Small words used by several of the ticket widgets below.
  'ticketExtra.create': 'Oluştur',
  'ticketExtra.confirmDelete': 'Evet, sil',
  'ticketExtra.copyLink': 'Bağlantıyı kopyala',
  'ticketExtra.openInNewTab': 'Yeni sekmede aç',
  'ticketExtra.closeEsc': 'Kapat (Esc)',
  'ticketExtra.prev': 'Önceki',
  'ticketExtra.next': 'Sonraki',
  'ticketExtra.unknownPerson': 'Bilinmiyor',

  // AI hand-off button. {name} is the agent's own name, never translated.
  'ticketExtra.ai.working': '{name} çalışıyor…',
  'ticketExtra.ai.queued': '{name} kuyrukta…',
  'ticketExtra.ai.handoffTitle': 'Bu görevi {name} otomatik yapsın',
  'ticketExtra.ai.sending': 'Gönderiliyor…',
  'ticketExtra.ai.hand': "{name}'a yaptır",
  'ticketExtra.ai.again': "{name}'a tekrar yaptır",
  'ticketExtra.ai.retry': "{name}'a tekrar dene",
  'ticketExtra.ai.done': '{name} tamamladı',
  'ticketExtra.ai.failed': '{name} yapamadı',
  'ticketExtra.ai.failedWithReason': '{name} yapamadı — nedenini gör',
  'ticketExtra.ai.stopped': '{name} durduruldu',
  'ticketExtra.ai.stalled': '{name} yanıt vermiyor',
  'ticketExtra.ai.approval.pending': 'Canlıya çıkış onayı bekliyor',
  'ticketExtra.ai.approval.asks': '{name} şunu canlıya çıkarmak istiyor:',
  'ticketExtra.ai.approval.approve': 'Onayla',
  'ticketExtra.ai.approval.reject': 'Reddet',
  'ticketExtra.ai.approval.notePlaceholder': 'Neden? (isteğe bağlı)',
  'ticketExtra.ai.approval.who': 'Onayı işi isteyen kişi, ajanın sahibi ya da takım yöneticisi verir.',
  'ticketExtra.ai.approval.approved': 'Canlıya çıkış onaylandı',
  'ticketExtra.ai.approval.rejected': 'Canlıya çıkış reddedildi',
  'ticketExtra.ai.stalledHint': '{name} bu işin ortasında bağlantıyı kaybetti. İş kaybolmadı; ajan yeniden bağlanınca kaldığı yerden sürer. Beklemek istemezsen İptal ile durdurabilirsin.',

  // People picker
  'ticketExtra.assignee.assignees': 'Atananlar',
  'ticketExtra.assignee.assigned': 'Atanmış',
  'ticketExtra.assignee.suggestions': 'Öneriler',
  'ticketExtra.assignee.searchPlaceholder': 'Ad veya e-posta adresi yazın',
  'ticketExtra.assignee.assignPerson': 'Kişi ata',
  'ticketExtra.assignee.unassigned': 'Atanmamış — atamak için tıkla',
  'ticketExtra.assignee.unassign': 'Atamayı kaldır',
  'ticketExtra.assignee.unassignName': '{name} atamasını kaldır',
  'ticketExtra.assignee.unassignStops': 'Atamayı kaldır: {name} işi bırakır',
  'ticketExtra.assignee.startsWork': 'Atayınca işe başlar',
  'ticketExtra.assignee.loadingMembers': 'Takım üyeleri yükleniyor…',
  'ticketExtra.assignee.noMatch': 'Eşleşen kişi yok',
  'ticketExtra.assignee.noneAssigned': 'Atanan kişi yok',

  // Attachments
  'ticketExtra.attachment.title': 'Dosyalar',
  'ticketExtra.attachment.add': 'Dosya ekle',
  'ticketExtra.attachment.empty': 'Dosya yok',
  'ticketExtra.attachment.uploadingName': 'Yükleniyor: {name}',
  'ticketExtra.attachment.tooLarge': '{name} yüklenemedi: {size} MB, dosya başına sınır {max} MB.',
  'ticketExtra.attachment.uploading': 'Yükleniyor…',
  'ticketExtra.attachment.downloadAll': 'Tümünü indir',
  'ticketExtra.attachment.gridView': 'Izgara görünümü',
  'ticketExtra.attachment.listView': 'Liste görünümü',
  'ticketExtra.attachment.viewFullscreen': 'Tam ekran görüntüle',
  'ticketExtra.attachment.view': 'Görüntüle',
  'ticketExtra.attachment.dropHint': 'Dosyaları buraya sürükleyin veya',
  'ticketExtra.attachment.dropChoose': 'seçin',
  'ticketExtra.attachment.setCover': 'Kapak yap',
  'ticketExtra.attachment.toDescription': 'Açıklamaya ekle',
  'ticketExtra.attachment.toComment': 'Yorum kutusuna ekle',
  'ticketExtra.attachment.dragHint': 'Açıklamaya ya da yoruma sürükleyip bırakabilirsin',
  'ticketExtra.attachment.renameHint': 'çift tıkla yeniden adlandır',
  'ticketExtra.attachment.removeCover': 'Kapağı kaldır',
  /** Shown on the tile of a file with no recognisable extension. */
  'ticketExtra.attachment.fileTypeFallback': 'DOSYA',

  // Full-screen attachment viewer
  'ticketExtra.preview.fit': 'Sığdır',
  'ticketExtra.preview.zoomIn': 'Yakınlaştır (+)',
  'ticketExtra.preview.zoomOut': 'Uzaklaştır (-)',
  'ticketExtra.preview.actualSize': '%100',
  'ticketExtra.preview.pdfPage': 'Sayfa {n} / {total}',
  'ticketExtra.preview.pdfMore': 'İlk {n} sayfa gösteriliyor (toplam {total}); tamamı için indirin.',
  'ticketExtra.preview.noPreview': 'Bu dosya türü için önizleme yok',
  'ticketExtra.imageText.title': 'Görseldeki metin',
  'ticketExtra.imageText.toggle': 'Metin',
  'ticketExtra.imageText.byAi': 'Yapay zekâ çıkardı; yanılabilir.',
  'ticketExtra.imageText.shows': 'Ne gösteriyor',
  'ticketExtra.imageText.text': 'Yazan metin',
  'ticketExtra.imageText.none': 'Görselde yazı yok.',
  'ticketExtra.translation.byAi': 'Yapay zekâ çevirdi (aslı {lang}); yanılabilir.',
  'ticketExtra.translation.byAiNoLang': 'Yapay zekâ çevirdi; yanılabilir.',
  'ticketExtra.translation.original': 'Orijinali görüyorsun ({lang}).',
  'ticketExtra.translation.originalNoLang': 'Orijinali görüyorsun.',
  'ticketExtra.translation.showOriginal': 'Orijinali göster',
  'ticketExtra.translation.showTranslation': 'Çeviriyi göster',

  // Linking one ticket to another (056)
  'ticketExtra.link.dialogLabel': 'Ticket bağla',
  'ticketExtra.link.searchPlaceholder': 'Ticket adı ya da #ID ile ara',
  'ticketExtra.link.noMatch': 'Eşleşen ticket yok',
  'ticketExtra.link.failed': 'Bağlanamadı',
  'ticketExtra.link.capped': 'İlk {n} sonuç gösteriliyor; aramayı daraltın',

  // Priority
  'ticketExtra.priority.label': 'Öncelik',
  'ticketExtra.priority.none': 'Öncelik yok',
  'ticketExtra.priority.clear': 'Önceliği kaldır',
  'ticketExtra.priority.clickAgainToClear': '{label} — kaldırmak için tekrar tıkla',

  // Status picker. Status *names* are team content and stay untranslated; the
  // five categories are a fixed enum, so they are translated.
  'ticketExtra.status.pick': 'Durum seç',
  'ticketExtra.status.change': 'Durumu değiştir',
  'ticketExtra.status.next': 'Bir sonraki adım',
  'ticketExtra.status.lastStep': 'Son adımda',
  'ticketExtra.status.markDone': 'Tamamlandı olarak işaretle',
  'ticketExtra.status.choose': '— Seçiniz —',
  'ticketExtra.status.emptyInList': 'Bu listede durum yok',
  'ticketExtra.status.aria': 'Durum: {name}',
  'ticketExtra.status.none': 'Durum yok',

  // Tags
  'ticketExtra.tag.add': '+ Tag',
  'ticketExtra.tag.manage': 'Tag Yönetimi',
  'ticketExtra.tag.empty': 'Henüz tag yok',
  'ticketExtra.tag.namePlaceholder': 'Tag adı...',
  'ticketExtra.tag.createNew': '+ Yeni tag oluştur',

  // Avatar of a person who only exists because their work was imported (040)
  'ticketExtra.avatar.importedTitle': '{name} · Fira hesabı yok (içe aktarmadan geldi)',
  'ticketExtra.avatar.importedTitleFrom': '{name} · Fira hesabı yok (içe aktarmadan geldi: {source})',
  'ticketExtra.avatar.noAccount': 'hesabı yok',
} as const

export type TicketExtraDict = typeof ticketExtra
