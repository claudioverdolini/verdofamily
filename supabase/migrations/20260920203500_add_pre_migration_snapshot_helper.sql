-- Pre-migration safety snapshot helper.
-- Future structural migrations should begin with:
-- select private.create_pre_migration_backups('pre_migration:<short_reason>');

create or replace function private.create_pre_migration_backups(p_reason text default 'pre_migration')
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count integer:=0;
  v_reason text:=left(coalesce(nullif(trim(p_reason),''),'pre_migration'),120);
begin
  insert into public.family_backups(
    family_id,revision,data,health_data,finance_data,school_data,
    backup_format_version,reason,created_by
  )
  select
    fd.family_id,
    fd.revision,
    private.family_data_without_sensitive(fd.data),
    private.health_backup_snapshot(fd.family_id),
    private.finance_backup_snapshot(fd.family_id),
    private.school_backup_snapshot(fd.family_id),
    4,
    v_reason,
    null
  from public.family_documents fd;

  get diagnostics v_count=row_count;

  delete from public.family_backups b
  using (
    select id from (
      select id,row_number() over(partition by family_id order by created_at desc,id desc) rn
      from public.family_backups
    ) ranked
    where rn>500
  ) old
  where b.id=old.id;

  return v_count;
end;
$$;

revoke all on function private.create_pre_migration_backups(text) from public,anon,authenticated,service_role;
grant execute on function private.create_pre_migration_backups(text) to postgres;

-- Baseline snapshot for the production-safety rollout.
select private.create_pre_migration_backups('production_safety_baseline_v13');
