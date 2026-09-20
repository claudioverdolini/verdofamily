# VerdoFamily – Production Data Safety

VerdoFamily production data is treated as durable user data.

## Rules for future changes

1. **UI-only changes** may be deployed normally after build/runtime verification.
2. **Database/schema or data-model changes** must be additive whenever possible.
3. Before any structural migration, the migration must call:
   `select private.create_pre_migration_backups('pre_migration:<reason>');`
4. Do not drop or rename live columns/tables in the same release that introduces replacements.
   Add the replacement first, migrate/read both, then remove only in a later controlled release.
5. Destructive user actions must ask for confirmation and archive recoverable data in the private recycle bin first.
6. Multi-device writes use the family document revision as a global optimistic lock.
   Normalized modules (finance, school, health) use the resulting revision as a fencing token.
7. A revision conflict must preserve the local attempted snapshot in `private.family_conflict_drafts` before loading the remote version.
8. Never expose `service_role` credentials to the client.

## Recovery layers

- **Recycle Bin**: item-level recovery for supported deletions.
- **Conflict Drafts**: preserves local data when two devices edit concurrently.
- **Family Backups**: full-family snapshots, including normalized Health, Finance and School data.
- **Google Drive**: independent scheduled export.
- **Vercel rollback**: frontend/code rollback does not overwrite Supabase data.

## Rollback procedure

### Frontend regression
1. Roll back/redeploy the last known-good Vercel deployment.
2. Do not restore database data merely because the UI is broken.
3. Verify the current Supabase revision and latest backup before any data action.

### Data/schema regression
1. Stop further structural changes.
2. Deploy a compatible frontend version.
3. Inspect the latest pre-migration/family backups.
4. Restore only if actual data corruption is confirmed.
5. Prefer forward-fix migrations over destructive down migrations.

### Conflict recovery
1. Review the saved conflict draft in Settings > Dati & recupero.
2. Before recovery, VerdoFamily creates a fresh full backup automatically.
3. Recover the draft only after explicit user confirmation.

## Staging

Use a separate Supabase development branch for schema/integration work once its recurring cost is explicitly approved.
Production data is never copied automatically into the staging branch.
