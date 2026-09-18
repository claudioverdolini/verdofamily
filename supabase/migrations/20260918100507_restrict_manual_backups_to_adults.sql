create or replace function public.create_family_backup(
  p_family_id uuid,
  p_reason text default 'manual'
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_role text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_role := private.family_role(p_family_id, auth.uid());
  if v_role not in ('admin','adult') then raise exception 'adult_or_admin_required'; end if;

  insert into public.family_backups(family_id, revision, data, reason, created_by)
  select family_id, revision, data, coalesce(nullif(trim(p_reason), ''), 'manual'), auth.uid()
  from public.family_documents
  where family_id = p_family_id
  returning id into v_id;

  if v_id is null then raise exception 'family_document_not_found'; end if;
  return v_id;
end;
$$;

revoke execute on function public.create_family_backup(uuid,text) from public, anon;
grant execute on function public.create_family_backup(uuid,text) to authenticated;
