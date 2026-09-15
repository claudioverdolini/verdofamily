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

Clone the repository and select the desired commit/tag. Git history is the primary source of truth for application structure.

The `VerdoFamily source snapshot` GitHub Action also creates a complete source archive after every push to `main` and once per week. Artifacts are retained for 90 days.

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

The values belong in Google Apps Script / database configuration only, not in GitHub.

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
- follow-up visit reminders and Calendar linkage work;
- Vercel production URL returns the expected release.

## Rule for future development

Every production integration must be represented in GitHub in the same change that deploys it:

- database changes -> SQL migration;
- Edge Function changes -> source under `supabase/functions/`;
- Google Apps Script changes -> source under `integrations/`;
- scheduled infrastructure -> reproducible file under `supabase/ops/`;
- frontend changes -> normal application source.

A change is not considered fully backed up until its source/recovery configuration is committed.
