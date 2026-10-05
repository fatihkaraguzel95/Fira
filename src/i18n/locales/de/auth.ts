import type { AuthDict } from '../tr/auth'

export const auth: Record<keyof AuthDict, string> = {
  // Brand panel (AuthLayout)
  'auth.brand.headlineTop': 'Bleib im Takt',
  'auth.brand.headlineBottom': 'mit deinem Team.',
  'auth.brand.subtitle': 'Verfolge Aufgaben, verwalte Listen und komm gemeinsam mit deinem Team voran.',
  'auth.brand.feature1': 'Flexible Nachverfolgung mit Board- und Listenansicht',
  'auth.brand.feature2': 'Zusammenarbeit in Echtzeit, Zuweisungen und Benachrichtigungen',
  'auth.brand.feature3': 'Priorität, Status und Fälligkeit im Blick',
  'auth.brand.feature4': 'Kommentare, Dateien und Teilaufgaben',
  'auth.brand.tagline': 'Mach die Arbeit übersichtlich. Komm schnell voran.',

  // Fields
  'auth.email': 'E-Mail',
  'auth.emailPlaceholder': 'name@firma.de',
  'auth.password': 'Passwort',
  'auth.oldPassword': 'Altes Passwort',
  'auth.newPassword': 'Neues Passwort',
  'auth.minChars': 'Mindestens 6 Zeichen',
  'auth.showPassword': 'Passwort anzeigen',
  'auth.hidePassword': 'Passwort verbergen',
  'auth.togglePassword': 'Passwort anzeigen/verbergen',
  'auth.fullName': 'Name',
  'auth.fullNamePlaceholder': 'Dein vollständiger Name',

  // Sign in
  'auth.welcomeBack': 'Willkommen zurück',
  'auth.signInSubtitle': 'Melde dich bei deinem Konto an',
  'auth.signIn': 'Anmelden',
  'auth.signingIn': 'Anmeldung läuft…',
  'auth.noAccount': 'Noch kein Konto?',
  'auth.register': 'Registrieren',
  'auth.googleSignIn': 'Mit Google anmelden',
  'auth.orEmail': 'oder per E-Mail',
  'auth.changeMyPassword': 'Passwort ändern',

  // Change password
  'auth.changePassword.title': 'Passwort ändern',
  'auth.changePassword.subtitle': 'Bestätige mit deinem aktuellen Passwort und leg ein neues fest',
  'auth.changePassword.done': 'Dein Passwort wurde geändert. Du kannst dich jetzt mit dem neuen anmelden.',
  'auth.updatePassword': 'Passwort aktualisieren',
  'auth.updating': 'Wird aktualisiert…',
  'auth.backToSignIn': 'Zurück zur Anmeldung',

  // Register
  'auth.join.title': 'Fira beitreten',
  'auth.join.subtitle': 'Erstell dein Konto und tritt deinem Team bei',
  'auth.haveAccount': 'Du hast schon ein Konto?',
  'auth.createAccount': 'Konto erstellen',
  'auth.registering': 'Konto wird erstellt…',
  'auth.inviteHint': 'Wenn du über eine Team-Einladung kommst, nimm dieselbe E-Mail-Adresse — die Einladung wird automatisch zugeordnet.',
  'auth.registerDone.title': 'Registrierung fertig',
  'auth.registerDone.subtitle': 'Nur noch ein Schritt',
  'auth.registerDone.sentBefore': 'Wir haben einen Bestätigungslink an ',
  'auth.registerDone.sentAfter': ' geschickt.',
  'auth.registerDone.hint': 'Sobald du deine E-Mail bestätigt hast, kannst du dich anmelden. Schau auch im Spam-Ordner nach.',

  // Errors shown in place of the server's own wording
  'auth.error.invalidCredentials': 'E-Mail oder Passwort ist falsch.',
  'auth.error.emailNotConfirmed': 'Deine E-Mail-Adresse ist noch nicht bestätigt.',
  'auth.error.tooManyRequests': 'Zu viele Versuche. Bitte warte einen Moment.',
  'auth.error.userNotFound': 'Zu dieser E-Mail-Adresse gibt es kein Konto.',
  'auth.error.signInFailed': 'Anmeldung fehlgeschlagen',
  'auth.error.passwordMin': 'Das neue Passwort muss mindestens 6 Zeichen haben.',
  'auth.error.oldPasswordWrong': 'Das alte Passwort ist falsch.',
  'auth.error.alreadyRegistered': 'Diese E-Mail-Adresse ist bereits registriert. Versuch dich anzumelden.',
  'auth.error.passwordTooShort': 'Das Passwort muss mindestens 6 Zeichen haben.',
  'auth.error.invalidEmail': 'Ungültige E-Mail-Adresse.',
  'auth.error.signupDisabled': 'Die Registrierung ist derzeit geschlossen. Wende dich bitte an einen Administrator.',
  'auth.error.emailRateLimit': 'Das Limit für den E-Mail-Versand ist erreicht. Bitte warte ein paar Minuten.',
  'auth.error.signUpFailed': 'Registrierung fehlgeschlagen',

  // Invitation link
  'auth.invite.checking': 'Einladung wird geprüft…',
  'auth.invite.failed': 'Die Einladung konnte nicht angenommen werden',
  'auth.invite.joined': 'Du bist dem Team beigetreten',
  'auth.invite.joinedBefore': 'Du bist jetzt Mitglied von ',
  'auth.invite.joinedAfter': '.',
  'auth.invite.toBoard': 'Zum Board',
  'auth.invite.invalid': 'Einladung ungültig',
  'auth.invite.invalidBody': 'Dieser Einladungslink wurde bereits benutzt, zurückgezogen oder ist abgelaufen.',
  'auth.invite.home': 'Zurück zur Startseite',
  'auth.invite.roleBefore': 'Du wurdest als ',
  'auth.invite.roleAfter': ' in dieses Team eingeladen.',
  'auth.invite.join': 'Beitreten',
  'auth.invite.joining': 'Wird beigetreten…',
}
