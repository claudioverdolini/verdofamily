# VerdoFamily disaster recovery

This document describes how to rebuild VerdoFamily if Vercel, Supabase or a local machine is lost.

## What is versioned in GitHub

- React/Vite application source and UI
- Supabase SQL migrations
- Current backend recovery snapshot in `supabase/recovery/`
- Supabase Edge Functions in `supabase/functions/`
- Google Apps Script source in `integrations/`
- Cron recovery script in `supabase/ops/`
- Automatic source archive workflow in `.github/workflows/source-snapshot.yml`

No passwords, service-role keys, webhook secrets, health files or family data must ever be committed.

## 1. Recover the application source

Clone the repository and select the desired commit/tag. Git history is the primary source of truth for application structure and deployed source.

The `VerdoFamily source snapshot` GitHub Action creates a complete source archive after every push to `main` and once per week. GitHub artifacts are retained for 90 days.

If the Drive mirror is configured, the same workflow also copies the ZIP to the VerdoFamily `Backup/Programma` folder through the Apps Script webhook.

To enable the Drive mirror, configure these GitHub Actions repository secrets:

- `VERDOFAMILY_DRIVE_WEBHOOK_URL`
- `VERDOFAMILY_DRIVE_WEBHOOK_SECRET`

The Apps Script must also contain this Script Property:

- `VERDOFAMILY_PROGRAM_BACKUP_FOLDER_ID`

## 2. Recover Supabase structure

Create or select a Supabase project and configure the frontend environment using that project's URL and publishable key.

Apply the SQL files in `supabase/migrations/` in chronological order.

For disaster recovery from the current production state, also review/apply:

`supabase/recovery/20260915_current_backend_structure.sql`

The recovery snapshot is idempotent and contains the backup-history and Drive-backup structures that were originally created directly in production before all backend work was consistently versioned.

The health Storage bucket is recreated by its migration. Keep it private.

## 3. Deploy Edge Functions

Deploy the functions stored in:

- `supabase/functions/health-attachment/`
- `supabase/functions/google-drive-backup-runner/`

Both functions currently perform their own authentication/secret validation. If deployment tooling asks for JWT verification, preserve the runtime setting documented by the deployed production function unless the function authentication model is intentionally redesigned.

Never put `SUPABASE_SERVICE_ROLE_KEY` in frontend code or in this repository.

## 4. Restore Google Drive backup integration

Deploy the Apps Script source from:

`integrations/google-drive-health-backup.gs`

Configure Script Properties with fresh/recovered values for:

- `VERDOFAMILY_WEBHOOK_SECRET`
- `VERDOFAMILY_BACKUP_FOLDER_ID`
- `VERDOFAMILY_HEALTH_VISITS_FOLDER_ID`
- `VERDOFAMILY_HEALTH_RECORDS_FOLDER_ID`
- `VERDOFAMILY_HEALTH_THERAPIES_FOLDER_ID`
- `VERDOFAMILY_PROGRAM_BACKUP_FOLDER_ID`

The values belong in Google Apps Script / database/GitHub Secrets configuration only, not in committed source.

Configure the family Drive webhook through VerdoFamily/Supabase so the Apps Script URL and webhook secret match.

## 5. Restore the scheduled Drive backup

Create a new random cron secret and store it in `public.system_settings` under:

`drive_backup_cron_secret`

Then run `supabase/ops/configure_daily_drive_cron.sql` after replacing `<SUPABASE_PROJECT_REF>` with the target project reference.

Production schedule: daily at `02:30 UTC`.

## 6. Restore data

Family data is backed up independently from application source.

Sources, in order of preference:

1. current `family_documents` record if the database survives;
2. `family_backups` history;
3. JSON exports stored in the VerdoFamily Google Drive Backup folder.

A restore should always create/preserve a pre-restore snapshot first.

## 7. Restore health attachments

Operational health attachments live in the private Supabase Storage bucket `health-attachments`.

Secondary copies are stored in Google Drive under the health backup folders. Restore files into the private bucket and rebuild attachment metadata/path references only after verifying ownership/family association.

## 8. Restore Vercel

Connect the GitHub repository to a Vercel project, configure the same public Supabase frontend environment values, and deploy `main`.

Do not put server-side secrets in Vite `VITE_*` variables: those are exposed to the browser bundle.

## Recovery verification checklist

After a rebuild, verify all of the following before considering recovery complete:

- authentication works;
- family membership and invites work;
- realtime family document sync works;
- creating/editing data increments revision correctly;
- backup history is created before document updates;
- manual and scheduled Drive JSON backups work;
- private health attachment upload/open/delete works;
- health attachment copy to Drive works;
- source ZIP mirror appears in `Backup/Programma` when GitHub Secrets are configured;
- follow-up visit reminders and Calendar linkage work;
- Vercel production URL returns the expected release.

## Rule for future development

Every production integration must be represented in GitHub in the same change that deploys it:

- database changes -> SQL migration;
- Edge Function changes -> source under `supabase/functions/`;
- Google Apps Script changes -> source under `integrations/`;
- scheduled infrastructure -> reproducible file under `supabase/ops/`;
- frontend changes -> normal application source.

A change is not considered fully backed up until its source/recovery configuration is committed. The source snapshot workflow then archives the updated repository automatically.


## Backup v2 — Salute normalizzata

Dal 18 settembre 2026 i backup famiglia usano il formato v2:

- `family_backups.data` contiene il documento famiglia senza visite, terapie, medicinali o referti.
- `family_backups.health_data` contiene lo snapshot sanitario separato e ripristinabile.
- `backup_format_version = 2` identifica il nuovo formato.
- I backup storici precedenti alla migrazione sono stati convertiti estraendo la Salute dal vecchio JSON.
- `restore_family_backup` ripristina in un'unica transazione sia il documento famiglia sia le tabelle Salute normalizzate.
- Prima di ogni restore viene creato automaticamente un backup `pre_restore`.
- I file binari sanitari nel bucket privato non vengono più eliminati fisicamente quando l'utente rimuove l'allegato: viene rimossa l'autorizzazione/metadato applicativo, mentre il file resta privato per consentire un eventuale ripristino storico.
- Il backup Google Drive usa `schemaVersion: 2` e include sia `data` sia `healthData`.

La separazione è applicata anche dal `family-document-gateway`: un client obsoleto non può reintrodurre dati Salute nel documento famiglia.


## Backup v3 — Paghette e movimenti normalizzati

Dal 18 settembre 2026 i backup famiglia usano il formato v3:

- `family_backups.data` contiene il documento famiglia senza Salute e senza dati economici.
- `family_backups.health_data` contiene la cartella sanitaria normalizzata.
- `family_backups.finance_data` contiene wallet/saldi, movimenti, compiti remunerati e ricorrenze.
- `backup_format_version = 3` identifica il formato corrente.
- I backup storici sono stati convertiti estraendo saldi, `chores`, `recurringChores` e `transactions` dal vecchio JSON.
- `restore_family_backup` ricostruisce documento famiglia, Salute e Paghette in un'unica operazione protetta.
- Prima di ogni restore viene creato un backup `pre_restore` v3.
- Il `family-document-gateway` azzera i saldi e rimuove compiti/movimenti dal documento JSON, quindi un client vecchio non può reintrodurre la vecchia struttura.
- Il backup Google Drive usa `schemaVersion: 3` e include `data`, `healthData` e `financeData`.
- Il cron dei compiti ricorrenti scrive direttamente su `finance_chores`, non più nel documento famiglia.
- I profili child possono leggere soltanto il proprio wallet, i propri movimenti e i propri compiti. Le scritture economiche dirette sulle tabelle sono negate; l'unica modifica child consentita passa dal gateway e riguarda lo stato open/pending dei propri compiti.


## Backup v4 — Scuola normalizzata

Dal 18 settembre 2026 i backup famiglia usano il formato v4:

- `family_backups.data` non contiene più Salute, Paghette o dati Scuola.
- `family_backups.health_data` conserva la cartella sanitaria.
- `family_backups.finance_data` conserva wallet, movimenti e compiti remunerati.
- `family_backups.school_data` conserva materie, orario scolastico e impegni.
- `backup_format_version = 4` identifica il formato corrente.
- I backup storici vengono convertiti estraendo `schoolSubjects`, `schoolTimetable` e `schoolItems` dal vecchio JSON.
- `restore_family_backup` ricostruisce tutti e quattro i domini in un'unica operazione protetta.
- Google Drive usa `schemaVersion: 4` e include `data`, `healthData`, `financeData` e `schoolData`.
- I child leggono tutte le materie della famiglia, ma soltanto il proprio orario e i propri impegni scolastici.
- I child non hanno privilegi di scrittura diretta sulle tabelle Scuola; le modifiche ai propri impegni passano dal gateway controllato.
