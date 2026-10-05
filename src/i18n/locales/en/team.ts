import type { TeamDict } from '../tr/team'

export const team: Record<keyof TeamDict, string> = {
  // ── Shared inside this namespace ─────────────────────────────────────────
  'team.action.create': 'Create',
  'team.action.creating': 'Creating...',
  'team.saveFailed': 'Could not be saved',
  'team.colorLabel': 'Colour (team palette)',

  // ── Create / join a team ─────────────────────────────────────────────────
  'team.create.title': 'Create a new team',
  'team.create.nameLabel': 'Team name',
  'team.create.namePlaceholder': 'e.g. Product team',

  'team.join.title': 'Join a team',
  'team.join.codeLabel': '10-character team code',
  'team.join.submit': 'Join',
  'team.join.joining': 'Joining...',

  // ── Folder ───────────────────────────────────────────────────────────────
  'team.folder.editTitle': 'Edit folder',
  'team.folder.newTitle': 'New folder',
  'team.folder.nameLabel': 'Folder name',
  'team.folder.namePlaceholder': 'e.g. Customers, 2026 Q3',

  // ── Pending invitation banner ────────────────────────────────────────────
  'team.invite.banner': '{inviter} invited you to {team} as {role}.',
  'team.invite.someAdmin': 'An admin',
  'team.invite.accept': 'Accept',
  'team.invite.decline': 'Decline',

  // ── Team settings window ─────────────────────────────────────────────────
  'team.settings.title': '{name} — team settings',
  'team.settings.tab.members': 'Members',
  'team.settings.tab.invites': 'Invitations',
  'team.settings.tab.colors': 'Colours',
  'team.settings.tab.backup': 'Backup and migration',
  'team.settings.tab.general': 'General',
  'team.settings.tab.rules': 'Agent rules',
  'team.rules.intro': "Agents working in this team read these pages before they start a job: first the team's rules, then the rules of the task's list, last the owner's own preferences. A rule is an ordinary Fira page: everyone in the team can read and edit it, and its versions are kept.",
  'team.rules.team': 'Team rules',
  'team.rules.teamHint': 'Apply in every list of this team.',
  'team.rules.list': 'List rules',
  'team.rules.listHint': "Read only for tasks of the chosen list, after the team's rules.",
  'team.rules.pickList': 'List',
  'team.rules.noLists': 'This team has no lists.',
  'team.rules.empty': 'No rule pages yet.',
  'team.rules.required': 'Required',
  'team.rules.requiredHint': "A required rule cannot be overridden by the agent owner's personal preferences.",
  'team.rules.remove': 'Remove from rules',
  'team.rules.removeAria': '{name}: remove from rules',
  'team.rules.open': 'Open the page',
  'team.rules.add': 'Add a page',
  'team.rules.search': 'Search for the page to make a rule…',
  'team.rules.addThis': 'Add',
  'team.rules.noMatch': 'No matching page.',
  'team.rules.new': 'New rule page',
  'team.rules.newPageTitle': 'Agent rules',
  'team.rules.adminOnly': 'A team admin decides which pages are rules; everyone in the team can edit what a page says.',
  'team.rules.trashed': 'The page is in the trash; agents do not read it.',
  'team.rules.updated': 'last changed {time}',
  'team.rules.deploy': 'Going live',
  'team.rules.deployHint': "May an agent put this list's work live? Together with the agent owner's own setting, the stricter one applies.",
  'team.rules.passive': 'Passive jobs',
  'team.rules.passiveHint': "Small jobs an agent does while it is idle, without taking a task. While off, this team's content is not sent to a model for these jobs; once on, the job is done by the agent of a team member whose runner allows passive jobs.",
  'team.rules.imageText': 'Read the text in pictures',
  'team.rules.imageTextHint': 'Pictures attached to tasks are read: the text in them and a short description are kept beside the file and found by search. The result is marked as made by AI; it can be wrong.',
  'team.rules.translate': 'Translate descriptions and comments',
  'team.rules.translateHint': 'Task descriptions and comments are translated for members who do not read their language (each person says which languages they read under Settings › Language). The reader sees the translation and returns to the original with one click. A translation is marked "translated by AI"; it can be wrong. Code, links and mentions are not translated.',
  'team.settings.manage': 'Team management',
  'team.settings.yourRole': 'Your role:',

  // Members
  'team.members.addRegistered': 'Add a registered user',
  'team.members.emailPlaceholder': 'person@company.com',
  'team.members.addHint':
    'If the person already has a Fira account they are added straight away; if not, create an invitation on the "Invitations" tab.',
  'team.members.added': '{name} was added to the team.',
  'team.members.addFailed': 'Could not be added',
  'team.members.count': 'Members · {n}',
  'team.members.you': '(you)',
  'team.members.agent': 'AI agent',
  'team.members.agentOf': 'Agent of {name}',
  'team.members.leave': 'Leave',
  'team.members.remove': 'Remove',
  'team.members.leaveTitle': 'Leave the team',
  'team.members.removeTitle': 'Remove from the team',

  // Invitations
  'team.invites.onlyAdmins': 'Only team admins can manage invitations.',
  'team.invites.create': 'Create invitation',
  'team.invites.emailPlaceholder': 'person@company.com (optional)',
  'team.invites.hint':
    'With an e-mail address, the person sees the invitation inside Fira when they sign in with it and accepts in one click. An invitation without an e-mail address works by link only.',
  'team.invites.pending': 'Pending invitations · {n}',
  'team.invites.none': 'No pending invitations.',
  'team.invites.linkInvite': 'Link invitation',
  'team.invites.copyLink': 'Copy link',
  'team.invites.revoke': 'Revoke invitation',
  'team.invites.teamCode': 'Team code',
  'team.invites.codeHint': 'Anyone with the code joins as {role} via "Join by code".',

  // Colours
  'team.colors.intro':
    'Lists and folders take their colour from this palette. Free colour codes are not accepted; create a named colour here first.',
  'team.colors.new': 'New colour',
  'team.colors.namePlaceholder': 'Colour name (e.g. Brand blue)',
  'team.colors.paletteCount': 'Palette · {n}',
  'team.colors.empty': 'No colours yet.',
  'team.colors.editName': 'Edit the name',
  'team.colors.deleteTitle': 'Delete the colour (lists using it lose their colour)',

  // General
  'team.general.nameLabel': 'Team name',
  'team.general.delete': 'Delete team',
  'team.general.deleting': 'Deleting…',
  'team.general.deleteWarning':
    'All folders, lists, tickets and file records are deleted permanently. To confirm, type "{phrase}".',
  'team.general.deleteConfirmWord': 'i am sure',

  'team.transfer.title': 'Transfer ownership',
  'team.transfer.hint':
    'Ownership of the team passes to the member you choose; you become an admin. So a team is not left locked when its owner leaves the company.',
  'team.transfer.pickMember': '— Choose a member —',
  'team.transfer.adminSuffix': '(admin)',
  'team.transfer.action': 'Transfer',
  'team.transfer.pending': 'Transferring…',
  'team.transfer.confirm': 'Yes, make {name} the owner',

  // ── Backup and migration ─────────────────────────────────────────────────
  'team.backup.onlyAdmins': 'Backup and migration are for team admins only.',

  'team.backup.mode.restore': 'Restore',
  'team.backup.mode.restoreHint':
    'Matching IDs: existing records are updated to the state in the backup, missing ones are added. For recovery after a disaster.',
  'team.backup.mode.skip': 'Add missing records only',
  'team.backup.mode.skipHint': 'Matching IDs: existing records are left alone, only missing ones are added.',
  'team.backup.mode.copy': 'Copy (new IDs)',
  'team.backup.mode.copyHint':
    'Everything is added as a copy with new IDs — for moving into another or a new team, or for a trial run.',

  'team.backup.zipTitle': 'Full backup (ZIP)',
  'team.backup.zipDesc':
    'All of the team’s data: lists, statuses, tags, tasks and subtasks, assignments, comments, deadlines, links, members; files optionally. Fira JSON schema v1 — restorable.',
  'team.backup.lastBackup': 'Last backup from this browser: {date}',
  'team.backup.includeFiles': 'Include files (attachments, logos, description images)',
  'team.backup.preparing': 'Preparing…',
  'team.backup.download': 'Download backup',
  'team.backup.downloaded':
    'Backup downloaded ({size}): {lists} lists, {tickets} tasks, {subtasks} subtasks, {comments} comments, {files} files.',
  'team.backup.warningsSuffix': 'Warnings: {n}',

  'team.backup.toolTitle': 'Move to another tool',
  'team.backup.toolDesc':
    'A tool-agnostic CSV/Excel package, or a profile for a specific target. Fields with no counterpart are appended to the description or notes and listed after the download.',
  'team.backup.csvPackage': 'CSV + Excel package',
  'team.backup.downloadProfile': 'Download profile',
  'team.backup.csvDownloaded': 'CSV package downloaded (tickets, comments, attachments, statuses + Excel).',
  'team.backup.toolDownloaded': '{tool} export downloaded: {name}. Fields with no counterpart there: {losses}',

  'team.backup.importTitle': 'Import from a backup',
  'team.backup.importDesc':
    'A Fira ZIP backup or a backup.json. Preview first, then choose a mode; everything is applied in one operation (on error nothing changes), then the files are uploaded.',
  'team.backup.pickFile': 'Choose backup file',
  'team.backup.bundleCounts':
    '{lists} lists · {tickets} tasks · {subtasks} subtasks · {comments} comments · {files} file records · {zipFiles} files in the ZIP · {members} members',
  'team.backup.teamLine':
    'On this system the team {state} · {existing} tasks already exist (ID clash) · users: {known} matched{unmapped}',
  'team.backup.teamState.admin': 'exists (you are an admin)',
  'team.backup.teamState.notAdmin': 'exists — you are not an admin',
  'team.backup.teamState.absent': 'does not exist',
  'team.backup.unmappedSuffix': ', {n} not found ({list})',
  'team.backup.bundleWarnings': 'Backup warnings: {n}',
  'team.backup.copyToThis': 'Into this team ({name})',
  'team.backup.copyToNew': 'Create a new team',
  'team.backup.needAdmin': 'In this mode the target is the team in the backup, and you must be an admin there.',
  'team.backup.importing': 'Importing…',
  'team.backup.import': 'Import',
  'team.backup.importDone': 'Import finished.',
  'team.backup.reportTitle': 'Report — mode: {mode}',
  'team.backup.reportUnmapped': 'Unmatched users (attached to the importing account): {list}',
  'team.backup.fileErrors': 'File errors: {list}',
  'team.backup.downloadReport': 'Download report',

  'team.backup.sheetTitle': 'Import from another tool (Excel / CSV)',
  'team.backup.sheetDesc':
    'A Microsoft Planner .xlsx export is read as it is — buckets become columns, checklist items subtasks, labels tags and notes the description; fields with no counterpart in Fira are kept in the "Planner alanları" block of the description. For Jira, ClickUp, Notion and the like, map the columns by hand.',
  'team.backup.targetList': '— Target list —',
  'team.backup.pickSheetFile': 'Choose Excel / CSV',
  'team.backup.reading': 'Reading…',
  'team.backup.plannerDetectedMsg':
    'Microsoft Planner export detected: {tasks} tasks, {buckets} buckets, {users} people.',
  'team.backup.sheetsRead': 'Read {n} sheets.',
  'team.backup.sheetCount': '{n} sheets',
  'team.backup.rowCount': '{n} rows',
  'team.backup.plannerDetected': 'Microsoft Planner export detected',
  'team.backup.planLabel': 'Plan:',
  'team.backup.planStats': '{tasks} tasks · {buckets} buckets ({list}) · {users} people',
  'team.backup.columnsLabel': 'Columns:',
  'team.backup.bucketsOption': 'Buckets ({n})',
  'team.backup.progressOption': 'Progress (Not started · In progress · Completed)',
  'team.backup.checklistAsSubtasks': 'Turn checklist items into subtasks',
  'team.backup.completedToDone': 'Move anything marked "Completed" to the done column',
  'team.backup.completedToDoneHint': '(even from another bucket; the bucket stays in the description)',
  'team.backup.mapManually': 'Map the columns by hand instead',
  'team.backup.backToPlanner': 'Back to the Planner mapping',
  'team.backup.sheetLabel': 'Sheet',
  'team.backup.sheetSummary': '{rows} rows · {cols} columns',

  'team.backup.dryRun': 'Dry run',
  'team.backup.dryTickets': '{n} tasks',
  'team.backup.drySubtasks': '+ {n} subtasks',
  'team.backup.dryPickList': '— choose a target list',
  'team.backup.plannerStats': '{notes} tasks with notes (description) · {labels} tags · {users} people matched',
  'team.backup.movedToDone':
    '{n} tasks will be taken out of their bucket and put in the done column (Planner status "Completed")',
  'team.backup.completionsLogged':
    'The completion date and who finished it will be written to the activity log for {n} tasks',
  'team.backup.newStatuses': 'Columns to be created: {list}',
  'team.backup.newTags': 'Tags to be created: {list}',
  'team.backup.unknownUsers':
    'For the {n} people without a Fira account a record marked "came from an import" will be created, and their assignments kept:',
  'team.backup.unknownUsersNote':
    'When these people sign up with the same e-mail address, their history moves to their account.',
  'team.backup.titleRequired': 'The "{field}" field must be mapped.',
  'team.backup.csvCreated': '{n} records created',
  'team.backup.csvPeople': ', {n} people added from the import',
  'team.backup.csvErrors': 'Errors: {list}',

  'team.backup.serverTitle': 'Server backup',
  'team.backup.serverDesc':
    'A safety net independent of the app: every night at 02:30 the server backs up the database (pg_dump) and the file store (tar) and keeps them for 7 days (~/backups). Details and restore steps: docs/backup-and-migration.md.',

  // Column mapping (spreadsheet import)
  'team.backup.field.title': 'Title',
  'team.backup.field.description': 'Description',
  'team.backup.field.status': 'Status',
  'team.backup.field.priority': 'Priority',
  'team.backup.field.assignees': 'Assignees (e-mail)',
  'team.backup.field.tags': 'Tags',
  'team.backup.field.dueDate': 'Due date',
  'team.backup.field.parent': 'Parent task (ID/title)',
  'team.backup.field.externalId': 'External ID',
  'team.backup.field.comments': 'Comments',
  'team.backup.field.createdAt': 'Created',
  'team.backup.field.ignore': '— ignore —',

  // Export progress / warnings
  'team.backup.progress.team': 'Team details',
  'team.backup.progress.lists': 'Lists',
  'team.backup.progress.tickets': 'Tasks',
  'team.backup.progress.assignments': 'Assignments, tags, deadlines',
  'team.backup.progress.comments': 'Comments',
  'team.backup.progress.fileRecords': 'File records',
  'team.backup.progress.files': 'Files {i}/{n}',
  'team.backup.progress.zip': 'Building the ZIP',
  'team.backup.progress.compressing': 'Compressing',
  'team.backup.progress.ready': 'Ready',
  'team.backup.error.teamRead': 'Could not read the team: {message}',
  'team.backup.warn.profiles':
    '{n} user profiles could not be read (deleted or not visible); on import they are attached to the importing account.',
  'team.backup.warn.fileDownload': 'File could not be downloaded: {url} ({message})',

  // README inside the ZIP
  'team.backup.readme.title': 'Fira backup — team: {team}',
  'team.backup.readme.meta': 'Date: {date}  ·  App: v{app}  ·  Schema: v{schema}',
  'team.backup.readme.contents':
    'Contents: backup.json (all data), manifest.json (file list), attachments/, logos/, images/ (if files were included).',
  'team.backup.readme.restore':
    'Restore: Fira → Team settings → Backup and migration → Import → choose this ZIP.',
  'team.backup.readme.modes':
    'Modes: Restore (updates matching IDs), Skip (adds missing records only), Copy (into another team with new IDs).',
  'team.backup.readme.tools':
    'To move to another tool, the CSV/Excel exports are taken from the same screen (Jira, ClickUp, MS Planner, Notion profiles).',

  // What each export target cannot represent
  'team.tools.jira.deadlines': 'Extra deadlines → as a comment',
  'team.tools.jira.links': 'Linked tasks → appended to the description as "İlişkili: …"',
  'team.tools.jira.colors': 'Team colours/folders → not supported',
  'team.tools.jira.attachments': 'Attachments → list of URLs (the files are in the ZIP backup)',
  'team.tools.clickup.deadlines': 'Extra deadlines → appended to the description',
  'team.tools.clickup.links': 'Linked tasks → appended to the description',
  'team.tools.clickup.priority': 'Priority mapped to 4 levels (1–4)',
  'team.tools.clickup.attachments': 'Attachments → list of URLs',
  'team.tools.planner.subtasks': 'Subtasks → checklist items (status/assignee lost; limit of 20 items)',
  'team.tools.planner.description': 'Description as plain text (Markdown formatting lost)',
  'team.tools.planner.labels': 'Limited number of labels (25)',
  'team.tools.planner.comments': 'Comments → into the Notes field',
  'team.tools.notion.deadlines': 'Extra deadlines → appended to the description',
  'team.tools.notion.attachments': 'Attachments → list of URLs',
  'team.tools.notion.statuses': 'Status categories → as the name of the Status option',

  // ── Import (reading files, writing rows) ─────────────────────────────────
  'team.import.error.noBackupJson': 'No backup.json inside the ZIP',
  'team.import.error.schema': 'Unsupported backup schema: v{version}',
  'team.import.error.corrupt': 'The backup file is corrupt (team/tickets missing)',
  'team.import.error.noSession': 'No session',
  'team.import.progress.file': 'File {i}/{n}',
  'team.import.error.notInZip': 'Not in the ZIP: {path}',
  'team.import.progress.filesDone': 'Files done',
  'team.import.error.statusCreate': 'Could not create the status: {name} ({message})',
  'team.import.error.tagCreate': 'Could not create the tag: {name}',
  'team.import.error.personCreate': '{who}: could not create the person record ({message})',
  'team.import.error.emptyResponse': 'empty response',
  'team.import.progress.ticket': 'Task {i}/{n}',
  'team.import.progress.done': 'Done',
  'team.import.progress.stopped': 'Stopped',
  'team.import.job.title': 'Importing from a spreadsheet',
  'team.import.job.done': 'Import finished',
  'team.import.job.stopped': 'Import stopped',
  'team.import.job.failed': 'Import failed',
  'team.import.job.summary': '{created} tasks created · {people} people',
  'team.import.job.errors': '{n} rows failed',
  'team.import.job.openReport': 'Open details',
  'team.import.job.running': 'An import is running; a new one can start once it finishes.',
  'team.import.job.started': 'The import runs in the background — you can close this window, progress is bottom right.',

  'team.import.error.authorSet': '{title}: could not set the creator ({message})',
  'team.import.error.completionLog': '{title}: could not write the completion record ({message})',
  'team.import.error.summaryNotify': 'the summary notification could not be sent ({message})',

  // Spreadsheet reader
  'team.sheet.error.noReadableSheet': 'The file has no readable sheet',
  'team.sheet.column': 'Column {n}',

  // Planner adapter warnings
  'team.planner.warn.checklist':
    '"{title}": the checklist could not be parsed ({expected} items expected, {found} found) — written to the description as it is',
  'team.planner.warn.unknownEmails':
    '{n} e-mail addresses are not in the team and will not be assigned; their names were written into the task description',
  'team.planner.warn.unknownNames':
    '{n} people with no match in the user list were written into the description',

  // ── List ─────────────────────────────────────────────────────────────────
  'team.list.editTitle': 'Edit list',
  'team.list.statusesLabel': 'Statuses',
  'team.list.statusesHint': 'The columns of the board. Drag to reorder; every change is saved right away.',
  'team.list.recurLabel': 'Recurring tasks',
  'team.list.recurHint': 'The rule is set in the window of the task itself; this lists the series of this list.',
  'team.list.recurNone': 'No recurring tasks in this list.',
  'team.list.recurNext': 'next {when}',
  'team.list.recurPaused': 'paused',
  'team.list.recurPause': 'Pause',
  'team.list.recurResume': 'Resume',
  'team.list.newTitle': 'New list',
  'team.list.nameLabel': 'List name',
  'team.list.namePlaceholder': 'e.g. Backlog, Sprint 12, Website',
  'team.list.folderLabel': 'Folder',
  'team.list.noFolder': '— No folder (directly under the team) —',
  'team.list.iconLabel': 'Icon / logo',
  'team.list.backgroundLabel': 'Board background',
  'team.list.changeBackground': 'Change background',
  'team.list.pickBackground': 'Choose background',

  // ── Board background picker ──────────────────────────────────────────────
  'team.background.title': 'List background',
  'team.background.desc':
    'Plain patterns on an engineering and design theme. Not keen? Get 20 fresh suggestions or upload your own picture.',
  'team.background.applying': 'Applying…',
  'team.background.newSuggestions': '20 new suggestions',
  'team.background.uploadOwn': 'Upload your own picture',
  'team.background.remove': 'Remove background',

  // ── Team colour palette pickers ──────────────────────────────────────────
  'team.palette.add': 'Add a colour to the palette',
  'team.palette.createFailed': 'The colour could not be created',
  'team.palette.noColor': 'No colour',
  'team.palette.newShort': 'New',
  'team.palette.legacyColor': 'Current colour (not in the palette)',
  'team.palette.emptyCanCreate': 'The team palette is empty — create the first colour with "{action}".',
  'team.palette.empty': 'The team palette has no colours yet.',
  'team.palette.emptyAdminCanAdd': 'The team palette has no colours yet; a team admin can add some.',

  // ── Icon picker ──────────────────────────────────────────────────────────
  'team.icon.uploadLogo': 'Upload logo',
  'team.icon.changeLogo': 'Change logo',
  'team.icon.removeLogo': 'Remove logo',
  'team.icon.uploadFailed': 'The logo could not be uploaded',
  'team.icon.hint': 'PNG/JPG/SVG, 512 KB at most. No icon is used while a logo is set.',

  // Preset icon names
  'team.listIcon.list': 'List',
  'team.listIcon.clipboard': 'Clipboard',
  'team.listIcon.folder': 'Folder',
  'team.listIcon.code': 'Code',
  'team.listIcon.bug': 'Bug',
  'team.listIcon.rocket': 'Rocket',
  'team.listIcon.star': 'Star',
  'team.listIcon.flag': 'Flag',
  'team.listIcon.bolt': 'Bolt',
  'team.listIcon.briefcase': 'Briefcase',
  'team.listIcon.chart': 'Chart',
  'team.listIcon.chat': 'Chat',
  'team.listIcon.cog': 'Settings',
  'team.listIcon.globe': 'Globe',
  'team.listIcon.heart': 'Heart',
  'team.listIcon.home': 'Home',
  'team.listIcon.layers': 'Layers',
  'team.listIcon.bulb': 'Idea',
  'team.listIcon.lock': 'Lock',
  'team.listIcon.mail': 'Mail',
  'team.listIcon.shield': 'Shield',
  'team.listIcon.tag': 'Tag',
  'team.listIcon.users': 'People',
  'team.listIcon.wrench': 'Spanner',
  'team.listIcon.calendar': 'Calendar',
  'team.listIcon.book': 'Book',
  'team.listIcon.cart': 'Basket',
  'team.listIcon.cloud': 'Cloud',
  'team.listIcon.database': 'Data',
  'team.listIcon.gift': 'Gift',
  'team.listIcon.megaphone': 'Announcement',
  'team.listIcon.palette': 'Palette',
  'team.listIcon.puzzle': 'Puzzle',
  'team.listIcon.truck': 'Lorry',
  'team.listIcon.beaker': 'Experiment',
  'team.palette.fallbackName': 'Colour',
  'team.error.roleChangeFailed': 'Could not change the role (no permission)',
  'team.error.removeMemberFailed': 'Could not remove the member (no permission)',
  'team.error.renameFailed': 'Could not rename the team',
  'team.error.joinFailed': 'Could not join the team',
  'team.invitePeople.title': 'Invite Fira users',
  'team.invitePeople.search': 'Search by name or e-mail',
  'team.invitePeople.empty': 'Nobody else to invite.',
  'team.invitePeople.noMatch': 'No matching user.',
  'team.invitePeople.invited': 'Invited',
  'team.invitePeople.send': 'Send invitations',
  'team.invitePeople.sendN': 'Invite {n} people',
  'team.invitePeople.sent': '{n} invitations sent.',
  'team.invitePeople.skipped': '{n} skipped',
  'team.invitePeople.hint': 'The invitation lands in their Fira inbox; until they accept they show as "invited" here. The role comes from the selection above.',
}
