create or replace function public.restore_family_backup(p_backup_id bigint)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_family_id uuid;
  v_data jsonb;
  v_revision bigint;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select b.family_id, b.data
  into v_family_id, v_data
  from public.family_backups b
  where b.id = p_backup_id;

  if v_family_id is null then raise exception 'backup_not_found'; end if;
  if not private.is_family_admin(v_family_id, auth.uid()) then
    raise exception 'family_admin_required';
  end if;

  insert into public.family_backups (family_id, revision, data, reason, created_by)
  select fd.family_id, fd.revision, fd.data, 'pre_restore', auth.uid()
  from public.family_documents fd
  where fd.family_id = v_family_id;

  update public.family_documents
  set data = v_data,
      revision = revision + 1,
      updated_by = auth.uid(),
      updated_at = now()
  where family_id = v_family_id
  returning revision into v_revision;

  if v_revision is null then raise exception 'family_document_not_found'; end if;
  return v_revision;
end;
$$;

revoke execute on function public.restore_family_backup(bigint) from public, anon;
grant execute on function public.restore_family_backup(bigint) to authenticated;