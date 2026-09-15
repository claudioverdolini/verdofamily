-- Limit backup configuration/history policies to authenticated users.

drop policy if exists "family owners can insert drive backup config" on public.drive_backup_configs;
create policy "family owners can insert drive backup config"
on public.drive_backup_configs for insert
to authenticated
with check (
  exists (
    select 1 from public.families f
    where f.id = drive_backup_configs.family_id
      and f.owner_id = auth.uid()
  )
);

drop policy if exists "family owners can read drive backup config" on public.drive_backup_configs;
create policy "family owners can read drive backup config"
on public.drive_backup_configs for select
to authenticated
using (
  exists (
    select 1 from public.families f
    where f.id = drive_backup_configs.family_id
      and f.owner_id = auth.uid()
  )
);

drop policy if exists "family owners can update drive backup config" on public.drive_backup_configs;
create policy "family owners can update drive backup config"
on public.drive_backup_configs for update
to authenticated
using (
  exists (
    select 1 from public.families f
    where f.id = drive_backup_configs.family_id
      and f.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.families f
    where f.id = drive_backup_configs.family_id
      and f.owner_id = auth.uid()
  )
);

drop policy if exists "family members can read backups" on public.family_backups;
create policy "family members can read backups"
on public.family_backups for select
to authenticated
using (
  exists (
    select 1 from public.family_members fm
    where fm.family_id = family_backups.family_id
      and fm.user_id = auth.uid()
  )
);
