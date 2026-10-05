/** Turkish is the source of truth for this namespace; en/de are typed against
 *  AuthDict, so an untranslated key is a compile error. */
export const auth = {
  // Brand panel (AuthLayout)
  'auth.brand.headlineTop': 'Ekibinizle',
  'auth.brand.headlineBottom': 'senkronize kalın.',
  'auth.brand.subtitle': 'Görevleri takip edin, listeleri yönetin ve ekibinizle birlikte ilerleme kaydedin.',
  'auth.brand.feature1': 'Pano ve liste görünümleriyle esnek iş takibi',
  'auth.brand.feature2': 'Gerçek zamanlı iş birliği, atamalar ve bildirimler',
  'auth.brand.feature3': 'Öncelik, durum ve son tarih takibi',
  'auth.brand.feature4': 'Yorum, dosya ve alt görev desteği',
  'auth.brand.tagline': 'İş takibini kolaylaştır. Hızlı ilerle.',

  // Fields
  'auth.email': 'E-posta',
  'auth.emailPlaceholder': 'ad@sirket.com',
  'auth.password': 'Şifre',
  'auth.oldPassword': 'Eski şifre',
  'auth.newPassword': 'Yeni şifre',
  'auth.minChars': 'En az 6 karakter',
  'auth.showPassword': 'Şifreyi göster',
  'auth.hidePassword': 'Şifreyi gizle',
  'auth.togglePassword': 'Şifreyi göster/gizle',
  'auth.fullName': 'Ad Soyad',
  'auth.fullNamePlaceholder': 'Adınız Soyadınız',

  // Sign in
  'auth.welcomeBack': 'Tekrar hoş geldin',
  'auth.signInSubtitle': 'Hesabına giriş yap',
  'auth.signIn': 'Giriş yap',
  'auth.signingIn': 'Giriş yapılıyor…',
  'auth.noAccount': 'Hesabın yok mu?',
  'auth.register': 'Kayıt ol',
  'auth.googleSignIn': 'Google ile giriş yap',
  'auth.orEmail': 'veya e-posta ile',
  'auth.changeMyPassword': 'Şifremi değiştir',

  // Change password
  'auth.changePassword.title': 'Şifreni değiştir',
  'auth.changePassword.subtitle': 'Mevcut şifrenle doğrula, yenisini belirle',
  'auth.changePassword.done': 'Şifren güncellendi. Yeni şifrenle giriş yapabilirsin.',
  'auth.updatePassword': 'Şifreyi güncelle',
  'auth.updating': 'Güncelleniyor…',
  'auth.backToSignIn': 'Girişe dön',

  // Register
  'auth.join.title': "Fira'ya katıl",
  'auth.join.subtitle': 'Hesabını oluştur, takımına katıl',
  'auth.haveAccount': 'Zaten hesabın var mı?',
  'auth.createAccount': 'Hesap oluştur',
  'auth.registering': 'Kayıt olunuyor…',
  'auth.inviteHint': 'Takım davetiyle geldiysen aynı e-posta adresini kullan; davet otomatik eşleşir.',
  'auth.registerDone.title': 'Kayıt tamam',
  'auth.registerDone.subtitle': 'Bir adım kaldı',
  // The address is emphasised between these two halves, so each locale can put
  // it where its own sentence wants it.
  'auth.registerDone.sentBefore': '',
  'auth.registerDone.sentAfter': ' adresine doğrulama bağlantısı gönderildi.',
  'auth.registerDone.hint': 'E-postanı doğruladıktan sonra giriş yapabilirsin. Spam klasörünü de kontrol et.',

  // Errors shown in place of the server's own wording
  'auth.error.invalidCredentials': 'E-posta veya şifre hatalı.',
  'auth.error.emailNotConfirmed': 'E-postanız henüz doğrulanmamış.',
  'auth.error.tooManyRequests': 'Çok fazla deneme yapıldı. Lütfen bekleyin.',
  'auth.error.userNotFound': 'Bu e-posta ile kayıtlı hesap bulunamadı.',
  'auth.error.signInFailed': 'Giriş başarısız',
  'auth.error.passwordMin': 'Yeni şifre en az 6 karakter olmalıdır.',
  'auth.error.oldPasswordWrong': 'Eski şifre hatalı.',
  'auth.error.alreadyRegistered': 'Bu e-posta adresi zaten kayıtlı. Giriş yapmayı deneyin.',
  'auth.error.passwordTooShort': 'Şifre en az 6 karakter olmalıdır.',
  'auth.error.invalidEmail': 'Geçersiz e-posta adresi.',
  'auth.error.signupDisabled': 'Kayıt şu anda kapalı. Lütfen yöneticiye başvurun.',
  'auth.error.emailRateLimit': 'E-posta gönderme limiti aşıldı. Lütfen birkaç dakika bekleyin.',
  'auth.error.signUpFailed': 'Kayıt başarısız',

  // Invitation link
  'auth.invite.checking': 'Davet kontrol ediliyor…',
  'auth.invite.failed': 'Davet kabul edilemedi',
  'auth.invite.joined': 'Takıma katıldın',
  'auth.invite.joinedBefore': '',
  'auth.invite.joinedAfter': ' takımına eklendin.',
  'auth.invite.toBoard': 'Panoya git',
  'auth.invite.invalid': 'Davet geçersiz',
  'auth.invite.invalidBody': 'Bu davet linki kullanılmış, iptal edilmiş ya da süresi dolmuş.',
  'auth.invite.home': 'Ana sayfaya dön',
  'auth.invite.roleBefore': 'Bu takıma ',
  'auth.invite.roleAfter': ' olarak davet edildin.',
  'auth.invite.join': 'Katıl',
  'auth.invite.joining': 'Katılınıyor…',
} as const

export type AuthDict = typeof auth
