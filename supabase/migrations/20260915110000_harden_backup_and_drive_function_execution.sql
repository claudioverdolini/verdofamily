-- Restrict backup/Drive helper functions to intended callers.
-- Trigger helper is not callable from client roles.

revoke execute on function public.backup_family_document_before_update() from public, anon, authenticated;

revoke execute on function public.configure_drive_backup(uuid, text, text, boolean) from public, anon;
revoke execute on function public.create_family_backup(uuid, text) from public, anon;
revoke execute on function public.disable_drive_backup(uuid) from public, anon;
revoke execute on function public.get_drive_backup_status(uuid) from public, anon;
revoke execute on function public.restore_family_backup(bigint) from public, anon;

grant execute on function public.configure_drive_backup(uuid, text, text, boolean) to authenticated;
grant execute on function public.create_family_backup(uuid, text) to authenticated;
grant execute on function public.disable_drive_backup(uuid) to authenticated;
grant execute on function public.get_drive_backup_status(uuid) to authenticated;
grant execute on function public.restore_family_backup(bigint) to authenticated;
