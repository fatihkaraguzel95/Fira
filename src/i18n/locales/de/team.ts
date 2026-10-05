import type { TeamDict } from '../tr/team'

export const team: Record<keyof TeamDict, string> = {
  // ── Shared inside this namespace ─────────────────────────────────────────
  'team.action.create': 'Erstellen',
  'team.action.creating': 'Wird erstellt...',
  'team.saveFailed': 'Konnte nicht gespeichert werden',
  'team.colorLabel': 'Farbe (Team-Palette)',

  // ── Create / join a team ─────────────────────────────────────────────────
  'team.create.title': 'Neues Team erstellen',
  'team.create.nameLabel': 'Teamname',
  'team.create.namePlaceholder': 'z. B. Produktteam',

  'team.join.title': 'Team beitreten',
  'team.join.codeLabel': '10-stelliger Teamcode',
  'team.join.submit': 'Beitreten',
  'team.join.joining': 'Beitritt läuft...',

  // ── Folder ───────────────────────────────────────────────────────────────
  'team.folder.editTitle': 'Ordner bearbeiten',
  'team.folder.newTitle': 'Neuer Ordner',
  'team.folder.nameLabel': 'Ordnername',
  'team.folder.namePlaceholder': 'z. B. Kunden, 2026 Q3',

  // ── Pending invitation banner ────────────────────────────────────────────
  'team.invite.banner': '{inviter} hat dich als {role} zu {team} eingeladen.',
  'team.invite.someAdmin': 'Ein Administrator',
  'team.invite.accept': 'Annehmen',
  'team.invite.decline': 'Ablehnen',

  // ── Team settings window ─────────────────────────────────────────────────
  'team.settings.title': '{name} — Teameinstellungen',
  'team.settings.tab.members': 'Mitglieder',
  'team.settings.tab.invites': 'Einladungen',
  'team.settings.tab.colors': 'Farben',
  'team.settings.tab.backup': 'Sicherung und Umzug',
  'team.settings.tab.general': 'Allgemein',
  'team.settings.tab.rules': 'Agentenregeln',
  'team.rules.intro': 'Agenten, die in diesem Team arbeiten, lesen diese Seiten, bevor sie eine Aufgabe beginnen: zuerst die Regeln des Teams, dann die der Liste der Aufgabe, zuletzt die eigenen Vorgaben des Besitzers. Eine Regel ist eine gewöhnliche Fira-Seite: alle im Team können sie lesen und bearbeiten, ältere Versionen bleiben erhalten.',
  'team.rules.team': 'Teamregeln',
  'team.rules.teamHint': 'Gelten in allen Listen dieses Teams.',
  'team.rules.list': 'Listenregeln',
  'team.rules.listHint': 'Werden nur bei Aufgaben der gewählten Liste gelesen, nach den Teamregeln.',
  'team.rules.pickList': 'Liste',
  'team.rules.noLists': 'Dieses Team hat keine Listen.',
  'team.rules.empty': 'Noch keine Regelseiten.',
  'team.rules.required': 'Verbindlich',
  'team.rules.requiredHint': 'Eine verbindliche Regel kann nicht durch persönliche Vorgaben des Agentenbesitzers übersteuert werden.',
  'team.rules.remove': 'Aus den Regeln entfernen',
  'team.rules.removeAria': '{name}: aus den Regeln entfernen',
  'team.rules.open': 'Seite öffnen',
  'team.rules.add': 'Seite hinzufügen',
  'team.rules.search': 'Seite suchen, die zur Regel werden soll…',
  'team.rules.addThis': 'Hinzufügen',
  'team.rules.noMatch': 'Keine passende Seite.',
  'team.rules.new': 'Neue Regelseite',
  'team.rules.newPageTitle': 'Agentenregeln',
  'team.rules.adminOnly': 'Ein Teamadmin legt fest, welche Seiten Regeln sind; den Inhalt einer Seite können alle im Team bearbeiten.',
  'team.rules.trashed': 'Die Seite liegt im Papierkorb; Agenten lesen sie nicht.',
  'team.rules.updated': 'zuletzt geändert {time}',
  'team.rules.deploy': 'Livegang',
  'team.rules.deployHint': 'Darf ein Agent die Arbeit dieser Liste live stellen? Zusammen mit der eigenen Einstellung des Agentenbesitzers gilt die strengere.',
  'team.rules.passive': 'Passive Aufgaben',
  'team.rules.passiveHint': 'Kleine Arbeiten, die ein Agent im Leerlauf erledigt, ohne eine Aufgabe zu übernehmen. Solange aus, wird der Inhalt dieses Teams dafür nicht an ein Modell gesendet; eingeschaltet erledigt sie der Agent eines Teammitglieds, dessen Runner passive Aufgaben erlaubt.',
  'team.rules.imageText': 'Text in Bildern auslesen',
  'team.rules.imageTextHint': 'Bilder an Aufgaben werden gelesen: der enthaltene Text und eine kurze Beschreibung werden bei der Datei gespeichert und von der Suche gefunden. Das Ergebnis ist als KI-erzeugt markiert; es kann falsch sein.',
  'team.rules.translate': 'Beschreibungen und Kommentare übersetzen',
  'team.rules.translateHint': 'Aufgabenbeschreibungen und Kommentare werden für Mitglieder übersetzt, die ihre Sprache nicht lesen (jede Person gibt unter Einstellungen › Sprache an, welche Sprachen sie liest). Wer liest, sieht die Übersetzung und kehrt mit einem Klick zum Original zurück. Eine Übersetzung ist als „von KI übersetzt“ gekennzeichnet; sie kann Fehler enthalten. Code, Links und Erwähnungen werden nicht übersetzt.',
  'team.settings.manage': 'Teamverwaltung',
  'team.settings.yourRole': 'Deine Rolle:',

  // Members
  'team.members.addRegistered': 'Registrierte Person hinzufügen',
  'team.members.emailPlaceholder': 'person@firma.de',
  'team.members.addHint':
    'Hat die Person schon ein Fira-Konto, wird sie sofort hinzugefügt; sonst erstelle im Tab „Einladungen“ eine Einladung.',
  'team.members.added': '{name} wurde zum Team hinzugefügt.',
  'team.members.addFailed': 'Konnte nicht hinzugefügt werden',
  'team.members.count': 'Mitglieder · {n}',
  'team.members.you': '(du)',
  'team.members.agent': 'KI-Agent',
  'team.members.agentOf': 'Agent von {name}',
  'team.members.leave': 'Verlassen',
  'team.members.remove': 'Entfernen',
  'team.members.leaveTitle': 'Team verlassen',
  'team.members.removeTitle': 'Aus dem Team entfernen',

  // Invitations
  'team.invites.onlyAdmins': 'Einladungen können nur Team-Administratoren verwalten.',
  'team.invites.create': 'Einladung erstellen',
  'team.invites.emailPlaceholder': 'person@firma.de (optional)',
  'team.invites.hint':
    'Mit E-Mail-Adresse sieht die Person die Einladung direkt in Fira, sobald sie sich damit anmeldet, und nimmt sie mit einem Klick an. Ohne E-Mail-Adresse funktioniert die Einladung nur über den Link.',
  'team.invites.pending': 'Offene Einladungen · {n}',
  'team.invites.none': 'Keine offenen Einladungen.',
  'team.invites.linkInvite': 'Link-Einladung',
  'team.invites.copyLink': 'Link kopieren',
  'team.invites.revoke': 'Einladung zurückziehen',
  'team.invites.teamCode': 'Teamcode',
  'team.invites.codeHint': 'Wer den Code kennt, tritt über „Mit Code beitreten“ als {role} bei.',

  // Colours
  'team.colors.intro':
    'Listen und Ordner nehmen ihre Farbe aus dieser Palette. Freie Farbcodes gibt es nicht; lege hier zuerst eine benannte Farbe an.',
  'team.colors.new': 'Neue Farbe',
  'team.colors.namePlaceholder': 'Farbname (z. B. Markenblau)',
  'team.colors.paletteCount': 'Palette · {n}',
  'team.colors.empty': 'Noch keine Farben.',
  'team.colors.editName': 'Namen bearbeiten',
  'team.colors.deleteTitle': 'Farbe löschen (Listen, die sie nutzen, bleiben ohne Farbe)',

  // General
  'team.general.nameLabel': 'Teamname',
  'team.general.delete': 'Team löschen',
  'team.general.deleting': 'Wird gelöscht…',
  'team.general.deleteWarning':
    'Alle Ordner, Listen, Tickets und Dateieinträge werden endgültig gelöscht. Tippe zur Bestätigung „{phrase}“.',
  'team.general.deleteConfirmWord': 'ich bin sicher',

  'team.transfer.title': 'Besitz übertragen',
  'team.transfer.hint':
    'Der Teambesitz geht an das gewählte Mitglied über; du wirst Administrator. Damit ein Team nicht gesperrt bleibt, wenn die besitzende Person die Firma verlässt.',
  'team.transfer.pickMember': '— Mitglied wählen —',
  'team.transfer.adminSuffix': '(Administrator)',
  'team.transfer.action': 'Übertragen',
  'team.transfer.pending': 'Wird übertragen…',
  'team.transfer.confirm': 'Ja, {name} soll Besitzer sein',

  // ── Backup and migration ─────────────────────────────────────────────────
  'team.backup.onlyAdmins': 'Sicherung und Umzug sind nur für Team-Administratoren.',

  'team.backup.mode.restore': 'Wiederherstellen',
  'team.backup.mode.restoreHint':
    'Gleiche IDs: vorhandene Einträge werden auf den Stand der Sicherung gebracht, fehlende ergänzt. Für die Rettung nach einem Ausfall.',
  'team.backup.mode.skip': 'Nur Fehlendes ergänzen',
  'team.backup.mode.skipHint': 'Gleiche IDs: vorhandene Einträge bleiben unberührt, nur fehlende werden ergänzt.',
  'team.backup.mode.copy': 'Kopieren (neue IDs)',
  'team.backup.mode.copyHint':
    'Alles wird mit neuen IDs als Kopie angelegt — für den Umzug in ein anderes oder neues Team oder zum Ausprobieren.',

  'team.backup.zipTitle': 'Vollständige Sicherung (ZIP)',
  'team.backup.zipDesc':
    'Alle Daten des Teams: Listen, Status, Tags, Aufgaben und Teilaufgaben, Zuweisungen, Kommentare, Fristen, Verknüpfungen, Mitglieder; Dateien optional. Fira-JSON-Schema v1 — wiederherstellbar.',
  'team.backup.lastBackup': 'Letzte Sicherung aus diesem Browser: {date}',
  'team.backup.includeFiles': 'Dateien einschließen (Anhänge, Logos, Bilder aus Beschreibungen)',
  'team.backup.preparing': 'Wird vorbereitet…',
  'team.backup.download': 'Sicherung herunterladen',
  'team.backup.downloaded':
    'Sicherung heruntergeladen ({size}): {lists} Listen, {tickets} Aufgaben, {subtasks} Teilaufgaben, {comments} Kommentare, {files} Dateien.',
  'team.backup.warningsSuffix': 'Warnungen: {n}',

  'team.backup.toolTitle': 'Umzug in ein anderes Werkzeug',
  'team.backup.toolDesc':
    'Werkzeugunabhängiges CSV-/Excel-Paket oder ein Profil für ein bestimmtes Ziel. Felder ohne Entsprechung landen in der Beschreibung bzw. in den Notizen und werden nach dem Download aufgelistet.',
  'team.backup.csvPackage': 'CSV- + Excel-Paket',
  'team.backup.downloadProfile': 'Profil herunterladen',
  'team.backup.csvDownloaded': 'CSV-Paket heruntergeladen (tickets, comments, attachments, statuses + Excel).',
  'team.backup.toolDownloaded': '{tool}-Export heruntergeladen: {name}. Felder ohne Entsprechung dort: {losses}',

  'team.backup.importTitle': 'Aus einer Sicherung importieren',
  'team.backup.importDesc':
    'Eine Fira-ZIP-Sicherung oder eine backup.json. Erst die Vorschau, dann der Modus; alles wird in einem Schritt angewendet (bei einem Fehler ändert sich nichts), danach werden die Dateien hochgeladen.',
  'team.backup.pickFile': 'Sicherungsdatei wählen',
  'team.backup.bundleCounts':
    '{lists} Listen · {tickets} Aufgaben · {subtasks} Teilaufgaben · {comments} Kommentare · {files} Dateieinträge · {zipFiles} Dateien im ZIP · {members} Mitglieder',
  'team.backup.teamLine':
    'Das Team {state} in diesem System · {existing} Aufgaben gibt es bereits (ID-Konflikt) · Benutzer: {known} zugeordnet{unmapped}',
  'team.backup.teamState.admin': 'existiert (du bist Administrator)',
  'team.backup.teamState.notAdmin': 'existiert — du bist kein Administrator',
  'team.backup.teamState.absent': 'existiert nicht',
  'team.backup.unmappedSuffix': ', {n} nicht gefunden ({list})',
  'team.backup.bundleWarnings': 'Warnungen der Sicherung: {n}',
  'team.backup.copyToThis': 'In dieses Team ({name})',
  'team.backup.copyToNew': 'Neues Team erstellen',
  'team.backup.needAdmin':
    'In diesem Modus ist das Ziel das Team aus der Sicherung, und dort musst du Administrator sein.',
  'team.backup.importing': 'Wird importiert…',
  'team.backup.import': 'Importieren',
  'team.backup.importDone': 'Import abgeschlossen.',
  'team.backup.reportTitle': 'Bericht — Modus: {mode}',
  'team.backup.reportUnmapped': 'Nicht zugeordnete Benutzer (dem importierenden Konto zugewiesen): {list}',
  'team.backup.fileErrors': 'Dateifehler: {list}',
  'team.backup.downloadReport': 'Bericht herunterladen',

  'team.backup.sheetTitle': 'Aus einem anderen Werkzeug importieren (Excel / CSV)',
  'team.backup.sheetDesc':
    'Der .xlsx-Export von Microsoft Planner wird direkt gelesen — Buckets werden Spalten, Checklistenpunkte Teilaufgaben, Bezeichnungen Tags und Notizen die Beschreibung; Felder ohne Entsprechung in Fira bleiben im Block „Planner alanları“ der Beschreibung. Für Jira, ClickUp, Notion und Ähnliches ordne die Spalten von Hand zu.',
  'team.backup.targetList': '— Ziel-Liste —',
  'team.backup.pickSheetFile': 'Excel / CSV wählen',
  'team.backup.reading': 'Wird gelesen…',
  'team.backup.plannerDetectedMsg':
    'Microsoft-Planner-Export erkannt: {tasks} Aufgaben, {buckets} Buckets, {users} Personen.',
  'team.backup.sheetsRead': '{n} Blätter gelesen.',
  'team.backup.sheetCount': '{n} Blätter',
  'team.backup.rowCount': '{n} Zeilen',
  'team.backup.plannerDetected': 'Microsoft-Planner-Export erkannt',
  'team.backup.planLabel': 'Plan:',
  'team.backup.planStats': '{tasks} Aufgaben · {buckets} Buckets ({list}) · {users} Personen',
  'team.backup.columnsLabel': 'Spalten:',
  'team.backup.bucketsOption': 'Buckets ({n})',
  'team.backup.progressOption': 'Status (Nicht begonnen · Wird ausgeführt · Erledigt)',
  'team.backup.checklistAsSubtasks': 'Checklistenpunkte zu Teilaufgaben machen',
  'team.backup.completedToDone': 'Alles mit Status „Erledigt“ in die Erledigt-Spalte verschieben',
  'team.backup.completedToDoneHint': '(auch aus einem anderen Bucket; der Bucket bleibt in der Beschreibung)',
  'team.backup.mapManually': 'Stattdessen die Spalten von Hand zuordnen',
  'team.backup.backToPlanner': 'Zurück zur Planner-Zuordnung',
  'team.backup.sheetLabel': 'Blatt',
  'team.backup.sheetSummary': '{rows} Zeilen · {cols} Spalten',

  'team.backup.dryRun': 'Probelauf',
  'team.backup.dryTickets': '{n} Aufgaben',
  'team.backup.drySubtasks': '+ {n} Teilaufgaben',
  'team.backup.dryPickList': '— Ziel-Liste wählen',
  'team.backup.plannerStats': '{notes} Aufgaben mit Notiz (Beschreibung) · {labels} Tags · {users} Personen zugeordnet',
  'team.backup.movedToDone':
    '{n} Aufgaben kommen aus ihrem Bucket in die Erledigt-Spalte (Planner-Status „Erledigt“)',
  'team.backup.completionsLogged':
    'Bei {n} Aufgaben werden Abschlussdatum und abschließende Person ins Aktivitätsprotokoll geschrieben',
  'team.backup.newStatuses': 'Anzulegende Spalten: {list}',
  'team.backup.newTags': 'Anzulegende Tags: {list}',
  'team.backup.unknownUsers':
    'Für die {n} Personen ohne Fira-Konto wird ein als „aus einem Import“ markierter Eintrag angelegt, ihre Zuweisungen bleiben erhalten:',
  'team.backup.unknownUsersNote':
    'Melden sich diese Personen mit derselben E-Mail-Adresse an, wandert ihre Historie in ihr Konto.',
  'team.backup.titleRequired': 'Das Feld „{field}“ muss zugeordnet sein.',
  'team.backup.csvCreated': '{n} Einträge erstellt',
  'team.backup.csvPeople': ', {n} Personen aus dem Import ergänzt',
  'team.backup.csvErrors': 'Fehler: {list}',

  'team.backup.serverTitle': 'Serversicherung',
  'team.backup.serverDesc':
    'Ein von der App unabhängiges Sicherheitsnetz: Der Server sichert jede Nacht um 02:30 die Datenbank (pg_dump) und den Dateispeicher (tar) und hält beides 7 Tage vor (~/backups). Details und Wiederherstellungsschritte: docs/backup-and-migration.md.',

  // Column mapping (spreadsheet import)
  'team.backup.field.title': 'Titel',
  'team.backup.field.description': 'Beschreibung',
  'team.backup.field.status': 'Status',
  'team.backup.field.priority': 'Priorität',
  'team.backup.field.assignees': 'Zuständige (E-Mail)',
  'team.backup.field.tags': 'Tags',
  'team.backup.field.dueDate': 'Fälligkeitsdatum',
  'team.backup.field.parent': 'Übergeordnete Aufgabe (ID/Titel)',
  'team.backup.field.externalId': 'Externe ID',
  'team.backup.field.comments': 'Kommentare',
  'team.backup.field.createdAt': 'Erstellt',
  'team.backup.field.ignore': '— ignorieren —',

  // Export progress / warnings
  'team.backup.progress.team': 'Teamdaten',
  'team.backup.progress.lists': 'Listen',
  'team.backup.progress.tickets': 'Aufgaben',
  'team.backup.progress.assignments': 'Zuweisungen, Tags, Fristen',
  'team.backup.progress.comments': 'Kommentare',
  'team.backup.progress.fileRecords': 'Dateieinträge',
  'team.backup.progress.files': 'Dateien {i}/{n}',
  'team.backup.progress.zip': 'ZIP wird erstellt',
  'team.backup.progress.compressing': 'Wird komprimiert',
  'team.backup.progress.ready': 'Fertig',
  'team.backup.error.teamRead': 'Team konnte nicht gelesen werden: {message}',
  'team.backup.warn.profiles':
    '{n} Benutzerprofile konnten nicht gelesen werden (gelöscht oder nicht sichtbar); beim Import werden sie dem importierenden Konto zugewiesen.',
  'team.backup.warn.fileDownload': 'Datei konnte nicht geladen werden: {url} ({message})',

  // README inside the ZIP
  'team.backup.readme.title': 'Fira-Sicherung — Team: {team}',
  'team.backup.readme.meta': 'Datum: {date}  ·  App: v{app}  ·  Schema: v{schema}',
  'team.backup.readme.contents':
    'Inhalt: backup.json (alle Daten), manifest.json (Dateiliste), attachments/, logos/, images/ (sofern Dateien eingeschlossen wurden).',
  'team.backup.readme.restore':
    'Wiederherstellen: Fira → Teameinstellungen → Sicherung und Umzug → Importieren → dieses ZIP wählen.',
  'team.backup.readme.modes':
    'Modi: Wiederherstellen (aktualisiert gleiche IDs), Überspringen (ergänzt nur Fehlendes), Kopieren (mit neuen IDs in ein anderes Team).',
  'team.backup.readme.tools':
    'Für den Umzug in ein anderes Werkzeug gibt es die CSV-/Excel-Exporte auf demselben Bildschirm (Profile für Jira, ClickUp, MS Planner, Notion).',

  // What each export target cannot represent
  'team.tools.jira.deadlines': 'Zusätzliche Fristen → als Kommentar',
  'team.tools.jira.links': 'Verknüpfte Aufgaben → ans Ende der Beschreibung als „İlişkili: …“',
  'team.tools.jira.colors': 'Teamfarben/Ordner → nicht unterstützt',
  'team.tools.jira.attachments': 'Anhänge → Liste von URLs (die Dateien liegen in der ZIP-Sicherung)',
  'team.tools.clickup.deadlines': 'Zusätzliche Fristen → ans Ende der Beschreibung',
  'team.tools.clickup.links': 'Verknüpfte Aufgaben → ans Ende der Beschreibung',
  'team.tools.clickup.priority': 'Priorität auf 4 Stufen (1–4) abgebildet',
  'team.tools.clickup.attachments': 'Anhänge → Liste von URLs',
  'team.tools.planner.subtasks': 'Teilaufgaben → Checklistenpunkte (Status/Zuweisung gehen verloren; max. 20 Punkte)',
  'team.tools.planner.description': 'Beschreibung als reiner Text (Markdown-Formatierung geht verloren)',
  'team.tools.planner.labels': 'Begrenzte Anzahl Bezeichnungen (25)',
  'team.tools.planner.comments': 'Kommentare → ins Feld Notizen',
  'team.tools.notion.deadlines': 'Zusätzliche Fristen → ans Ende der Beschreibung',
  'team.tools.notion.attachments': 'Anhänge → Liste von URLs',
  'team.tools.notion.statuses': 'Statuskategorien → als Name der Status-Option',

  // ── Import (reading files, writing rows) ─────────────────────────────────
  'team.import.error.noBackupJson': 'Keine backup.json im ZIP',
  'team.import.error.schema': 'Nicht unterstütztes Sicherungsschema: v{version}',
  'team.import.error.corrupt': 'Die Sicherungsdatei ist beschädigt (team/tickets fehlen)',
  'team.import.error.noSession': 'Keine Sitzung',
  'team.import.progress.file': 'Datei {i}/{n}',
  'team.import.error.notInZip': 'Nicht im ZIP: {path}',
  'team.import.progress.filesDone': 'Dateien fertig',
  'team.import.error.statusCreate': 'Status konnte nicht angelegt werden: {name} ({message})',
  'team.import.error.tagCreate': 'Tag konnte nicht angelegt werden: {name}',
  'team.import.error.personCreate': '{who}: Personeneintrag konnte nicht angelegt werden ({message})',
  'team.import.error.emptyResponse': 'leere Antwort',
  'team.import.progress.ticket': 'Aufgabe {i}/{n}',
  'team.import.progress.done': 'Fertig',
  'team.import.progress.stopped': 'Gestoppt',
  'team.import.job.title': 'Import aus Tabelle läuft',
  'team.import.job.done': 'Import abgeschlossen',
  'team.import.job.stopped': 'Import gestoppt',
  'team.import.job.failed': 'Import fehlgeschlagen',
  'team.import.job.summary': '{created} Aufgaben erstellt · {people} Personen',
  'team.import.job.errors': '{n} Zeilen fehlgeschlagen',
  'team.import.job.openReport': 'Details öffnen',
  'team.import.job.running': 'Ein Import läuft; ein neuer ist erst nach dessen Ende möglich.',
  'team.import.job.started': 'Der Import läuft im Hintergrund — das Fenster kann geschlossen werden, der Fortschritt steht unten rechts.',

  'team.import.error.authorSet': '{title}: erstellende Person konnte nicht gesetzt werden ({message})',
  'team.import.error.completionLog': '{title}: Abschlusseintrag konnte nicht geschrieben werden ({message})',
  'team.import.error.summaryNotify': 'Zusammenfassung konnte nicht gesendet werden ({message})',

  // Spreadsheet reader
  'team.sheet.error.noReadableSheet': 'Die Datei enthält kein lesbares Blatt',
  'team.sheet.column': 'Spalte {n}',

  // Planner adapter warnings
  'team.planner.warn.checklist':
    '„{title}“: Die Checkliste konnte nicht zerlegt werden ({expected} Punkte erwartet, {found} gefunden) — unverändert in die Beschreibung geschrieben',
  'team.planner.warn.unknownEmails':
    '{n} E-Mail-Adressen sind nicht im Team und werden nicht zugewiesen; ihre Namen stehen in der Beschreibung der Aufgabe',
  'team.planner.warn.unknownNames':
    '{n} Personen ohne Eintrag in der Benutzerliste wurden in die Beschreibung geschrieben',

  // ── List ─────────────────────────────────────────────────────────────────
  'team.list.editTitle': 'Liste bearbeiten',
  'team.list.statusesLabel': 'Status',
  'team.list.statusesHint': 'Die Spalten des Boards. Zum Sortieren ziehen; jede Änderung wird sofort gespeichert.',
  'team.list.recurLabel': 'Wiederkehrende Aufgaben',
  'team.list.recurHint': 'Die Regel wird im Fenster der Aufgabe gesetzt; hier stehen die Serien dieser Liste.',
  'team.list.recurNone': 'Keine wiederkehrenden Aufgaben in dieser Liste.',
  'team.list.recurNext': 'als Nächstes {when}',
  'team.list.recurPaused': 'pausiert',
  'team.list.recurPause': 'Pausieren',
  'team.list.recurResume': 'Fortsetzen',
  'team.list.newTitle': 'Neue Liste',
  'team.list.nameLabel': 'Listenname',
  'team.list.namePlaceholder': 'z. B. Backlog, Sprint 12, Website',
  'team.list.folderLabel': 'Ordner',
  'team.list.noFolder': '— Ohne Ordner (direkt im Team) —',
  'team.list.iconLabel': 'Symbol / Logo',
  'team.list.backgroundLabel': 'Board-Hintergrund',
  'team.list.changeBackground': 'Hintergrund ändern',
  'team.list.pickBackground': 'Hintergrund wählen',

  // ── Board background picker ──────────────────────────────────────────────
  'team.background.title': 'Listenhintergrund',
  'team.background.desc':
    'Schlichte Muster rund um Technik und Design. Nicht dabei? Hol dir 20 neue Vorschläge oder lade dein eigenes Bild hoch.',
  'team.background.applying': 'Wird angewendet…',
  'team.background.newSuggestions': '20 neue Vorschläge',
  'team.background.uploadOwn': 'Eigenes Bild hochladen',
  'team.background.remove': 'Hintergrund entfernen',

  // ── Team colour palette pickers ──────────────────────────────────────────
  'team.palette.add': 'Farbe zur Palette hinzufügen',
  'team.palette.createFailed': 'Die Farbe konnte nicht angelegt werden',
  'team.palette.noColor': 'Keine Farbe',
  'team.palette.newShort': 'Neu',
  'team.palette.legacyColor': 'Aktuelle Farbe (nicht in der Palette)',
  'team.palette.emptyCanCreate': 'Die Team-Palette ist leer — lege mit „{action}“ die erste Farbe an.',
  'team.palette.empty': 'Die Team-Palette hat noch keine Farben.',
  'team.palette.emptyAdminCanAdd':
    'Die Team-Palette hat noch keine Farben; ein Team-Administrator kann welche anlegen.',

  // ── Icon picker ──────────────────────────────────────────────────────────
  'team.icon.uploadLogo': 'Logo hochladen',
  'team.icon.changeLogo': 'Logo ändern',
  'team.icon.removeLogo': 'Logo entfernen',
  'team.icon.uploadFailed': 'Das Logo konnte nicht hochgeladen werden',
  'team.icon.hint': 'PNG/JPG/SVG, höchstens 512 KB. Mit Logo wird kein Symbol verwendet.',

  // Preset icon names
  'team.listIcon.list': 'Liste',
  'team.listIcon.clipboard': 'Klemmbrett',
  'team.listIcon.folder': 'Ordner',
  'team.listIcon.code': 'Code',
  'team.listIcon.bug': 'Fehler',
  'team.listIcon.rocket': 'Rakete',
  'team.listIcon.star': 'Stern',
  'team.listIcon.flag': 'Flagge',
  'team.listIcon.bolt': 'Blitz',
  'team.listIcon.briefcase': 'Aktentasche',
  'team.listIcon.chart': 'Diagramm',
  'team.listIcon.chat': 'Chat',
  'team.listIcon.cog': 'Einstellung',
  'team.listIcon.globe': 'Welt',
  'team.listIcon.heart': 'Herz',
  'team.listIcon.home': 'Haus',
  'team.listIcon.layers': 'Ebenen',
  'team.listIcon.bulb': 'Idee',
  'team.listIcon.lock': 'Schloss',
  'team.listIcon.mail': 'Post',
  'team.listIcon.shield': 'Schild',
  'team.listIcon.tag': 'Tag',
  'team.listIcon.users': 'Personen',
  'team.listIcon.wrench': 'Schraubenschlüssel',
  'team.listIcon.calendar': 'Kalender',
  'team.listIcon.book': 'Buch',
  'team.listIcon.cart': 'Warenkorb',
  'team.listIcon.cloud': 'Wolke',
  'team.listIcon.database': 'Daten',
  'team.listIcon.gift': 'Geschenk',
  'team.listIcon.megaphone': 'Ankündigung',
  'team.listIcon.palette': 'Palette',
  'team.listIcon.puzzle': 'Puzzle',
  'team.listIcon.truck': 'Lastwagen',
  'team.listIcon.beaker': 'Experiment',
  'team.palette.fallbackName': 'Farbe',
  'team.error.roleChangeFailed': 'Rolle konnte nicht geändert werden (keine Berechtigung)',
  'team.error.removeMemberFailed': 'Mitglied konnte nicht entfernt werden (keine Berechtigung)',
  'team.error.renameFailed': 'Team konnte nicht umbenannt werden',
  'team.error.joinFailed': 'Beitritt zum Team nicht möglich',
  'team.invitePeople.title': 'Fira-Nutzer einladen',
  'team.invitePeople.search': 'Nach Name oder E-Mail suchen',
  'team.invitePeople.empty': 'Niemand sonst zum Einladen.',
  'team.invitePeople.noMatch': 'Kein passender Nutzer.',
  'team.invitePeople.invited': 'Eingeladen',
  'team.invitePeople.send': 'Einladungen senden',
  'team.invitePeople.sendN': '{n} Personen einladen',
  'team.invitePeople.sent': '{n} Einladungen gesendet.',
  'team.invitePeople.skipped': '{n} übersprungen',
  'team.invitePeople.hint': 'Die Einladung landet im Fira-Posteingang; bis zur Annahme erscheint die Person hier als „eingeladen“. Die Rolle kommt aus der Auswahl oben.',
}
