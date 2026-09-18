alter table public.family_backups
  add column if not exists school_data jsonb;

create or replace function private.family_data_without_school(p_data jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_set(
    jsonb_set(
      jsonb_set(
        coalesce(p_data, '{}'::jsonb),
        '{schoolSubjects}', '[]'::jsonb, true
      ),
      '{schoolTimetable}', '[]'::jsonb, true
    ),
    '{schoolItems}', '[]'::jsonb, true
  )
$$;

create or replace function private.family_data_without_sensitive(p_data jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.family_data_without_school(
    private.family_data_without_finance(
      private.family_data_without_health(p_data)
    )
  )
$$;

create or replace function private.school_backup_snapshot(p_family_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 1,
    'schoolSubjects', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', ss.legacy_id,
        'name', ss.name,
        'shortName', ss.short_name
      )) order by ss.legacy_id)
      from public.school_subjects ss
      where ss.family_id = p_family_id
    ), '[]'::jsonb),
    'schoolTimetable', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', ste.legacy_id,
        'userId', fp.legacy_user_id,
        'weekday', ste.weekday,
        'order', ste.lesson_order,
        'subjectId', ss.legacy_id,
        'startTime', case when ste.start_time is null then null else to_char(ste.start_time, 'HH24:MI') end,
        'endTime', case when ste.end_time is null then null else to_char(ste.end_time, 'HH24:MI') end,
        'room', ste.room,
        'notes', ste.notes
      )) order by ste.legacy_id)
      from public.school_timetable_entries ste
      join public.family_people fp on fp.id = ste.person_id
      join public.school_subjects ss on ss.id = ste.subject_id
      where ste.family_id = p_family_id
    ), '[]'::jsonb),
    'schoolItems', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', si.legacy_id,
        'userId', fp.legacy_user_id,
        'type', si.type,
        'title', si.title,
        'date', si.item_date,
        'subjectId', ss.legacy_id,
        'notes', si.notes,
        'amount', si.amount,
        'done', si.done,
        'createdAt', si.created_on
      )) order by si.legacy_id)
      from public.school_items si
      join public.family_people fp on fp.id = si.person_id
      left join public.school_subjects ss on ss.id = si.subject_id
      where si.family_id = p_family_id
    ), '[]'::jsonb)
  )
$$;

create or replace function private.restore_school_backup(
  p_family_id uuid,
  p_school_data jsonb,
  p_family_data jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subjects jsonb;
  v_timetable jsonb;
  v_items jsonb;
begin
  v_subjects := coalesce(p_school_data->'schoolSubjects', p_family_data->'schoolSubjects', '[]'::jsonb);
  v_timetable := coalesce(p_school_data->'schoolTimetable', p_family_data->'schoolTimetable', '[]'::jsonb);
  v_items := coalesce(p_school_data->'schoolItems', p_family_data->'schoolItems', '[]'::jsonb);

  delete from public.school_items where family_id = p_family_id;
  delete from public.school_timetable_entries where family_id = p_family_id;
  delete from public.school_subjects where family_id = p_family_id;

  insert into public.school_subjects(family_id, legacy_id, name, short_name)
  select
    p_family_id,
    (s.value->>'id')::bigint,
    coalesce(nullif(s.value->>'name',''),'Materia'),
    nullif(s.value->>'shortName','')
  from jsonb_array_elements(v_subjects) s(value)
  where coalesce(s.value->>'id','') ~ '^[0-9]+$';

  insert into public.school_timetable_entries(
    family_id, legacy_id, person_id, weekday, lesson_order, subject_id,
    start_time, end_time, room, notes
  )
  select
    p_family_id,
    (e.value->>'id')::bigint,
    fp.id,
    least(7, greatest(1, coalesce(nullif(e.value->>'weekday','')::integer,1))),
    greatest(1, coalesce(nullif(e.value->>'order','')::integer,1)),
    ss.id,
    nullif(e.value->>'startTime','')::time,
    nullif(e.value->>'endTime','')::time,
    nullif(e.value->>'room',''),
    nullif(e.value->>'notes','')
  from jsonb_array_elements(v_timetable) e(value)
  join public.family_people fp
    on fp.family_id=p_family_id and fp.legacy_user_id=(e.value->>'userId')::bigint
  join public.school_subjects ss
    on ss.family_id=p_family_id and ss.legacy_id=(e.value->>'subjectId')::bigint
  where coalesce(e.value->>'id','') ~ '^[0-9]+$'
    and coalesce(e.value->>'userId','') ~ '^[0-9]+$'
    and coalesce(e.value->>'subjectId','') ~ '^[0-9]+$';

  insert into public.school_items(
    family_id, legacy_id, person_id, type, title, item_date, subject_id,
    notes, amount, done, created_on
  )
  select
    p_family_id,
    (i.value->>'id')::bigint,
    fp.id,
    case when i.value->>'type' in ('homework','test','oral','material','circular','permission','trip','payment')
      then i.value->>'type' else 'homework' end,
    coalesce(nullif(i.value->>'title',''),'Impegno scolastico'),
    coalesce(nullif(i.value->>'date','')::date,current_date),
    ss.id,
    nullif(i.value->>'notes',''),
    case when nullif(i.value->>'amount','') is null then null
         else greatest((i.value->>'amount')::numeric,0) end,
    coalesce((i.value->>'done')::boolean,false),
    coalesce(nullif(i.value->>'createdAt','')::date,current_date)
  from jsonb_array_elements(v_items) i(value)
  join public.family_people fp
    on fp.family_id=p_family_id and fp.legacy_user_id=(i.value->>'userId')::bigint
  left join public.school_subjects ss
    on ss.family_id=p_family_id
   and coalesce(i.value->>'subjectId','') ~ '^[0-9]+$'
   and ss.legacy_id=(i.value->>'subjectId')::bigint
  where coalesce(i.value->>'id','') ~ '^[0-9]+$'
    and coalesce(i.value->>'userId','') ~ '^[0-9]+$';
end;
$$;

update public.family_backups b
set
  school_data = jsonb_build_object(
    'version', 1,
    'schoolSubjects', coalesce(b.data->'schoolSubjects','[]'::jsonb),
    'schoolTimetable', coalesce(b.data->'schoolTimetable','[]'::jsonb),
    'schoolItems', coalesce(b.data->'schoolItems','[]'::jsonb)
  ),
  data = private.family_data_without_school(b.data),
  backup_format_version = 4
where b.school_data is null;

alter table public.family_backups
  alter column school_data set default '{"version":1,"schoolSubjects":[],"schoolTimetable":[],"schoolItems":[]}'::jsonb,
  alter column school_data set not null,
  alter column backup_format_version set default 4;

create or replace function public.backup_family_document_before_update()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if current_setting('app.skip_family_backup_trigger', true) = 'on' then
    return new;
  end if;

  insert into public.family_backups(
    family_id, revision, data, health_data, finance_data, school_data,
    backup_format_version, reason, created_by
  )
  values (
    old.family_id,
    old.revision,
    private.family_data_without_sensitive(old.data),
    private.health_backup_snapshot(old.family_id),
    private.finance_backup_snapshot(old.family_id),
    private.school_backup_snapshot(old.family_id),
    4,
    'auto_before_update',
    old.updated_by
  );

  delete from public.family_backups b
  where b.family_id = old.family_id
    and b.id in (
      select id from public.family_backups
      where family_id = old.family_id
      order by created_at desc
      offset 500
    );

  return new;
end;
$$;

create or replace function public.create_family_backup(p_family_id uuid, p_reason text default 'manual')
returns bigint
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_id bigint;
  v_role text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_role := private.family_role(p_family_id, auth.uid());
  if v_role not in ('admin','adult') then raise exception 'adult_or_admin_required'; end if;

  insert into public.family_backups(
    family_id, revision, data, health_data, finance_data, school_data,
    backup_format_version, reason, created_by
  )
  select
    family_id,
    revision,
    private.family_data_without_sensitive(data),
    private.health_backup_snapshot(family_id),
    private.finance_backup_snapshot(family_id),
    private.school_backup_snapshot(family_id),
    4,
    coalesce(nullif(trim(p_reason), ''), 'manual'),
    auth.uid()
  from public.family_documents
  where family_id = p_family_id
  returning id into v_id;

  if v_id is null then raise exception 'family_document_not_found'; end if;
  return v_id;
end;
$$;

create or replace function public.restore_family_backup(p_backup_id bigint)
returns bigint
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_family_id uuid;
  v_data jsonb;
  v_health_data jsonb;
  v_finance_data jsonb;
  v_school_data jsonb;
  v_revision bigint;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select b.family_id, b.data, b.health_data, b.finance_data, b.school_data
  into v_family_id, v_data, v_health_data, v_finance_data, v_school_data
  from public.family_backups b
  where b.id = p_backup_id;

  if v_family_id is null then raise exception 'backup_not_found'; end if;
  if not private.is_family_admin(v_family_id, auth.uid()) then raise exception 'family_admin_required'; end if;

  insert into public.family_backups(
    family_id, revision, data, health_data, finance_data, school_data,
    backup_format_version, reason, created_by
  )
  select
    fd.family_id,
    fd.revision,
    private.family_data_without_sensitive(fd.data),
    private.health_backup_snapshot(fd.family_id),
    private.finance_backup_snapshot(fd.family_id),
    private.school_backup_snapshot(fd.family_id),
    4,
    'pre_restore',
    auth.uid()
  from public.family_documents fd
  where fd.family_id = v_family_id;

  perform private.restore_health_backup(v_family_id, v_health_data, v_data);
  perform private.restore_finance_backup(v_family_id, v_finance_data, v_data);
  perform private.restore_school_backup(v_family_id, v_school_data, v_data);

  perform set_config('app.skip_family_backup_trigger', 'on', true);
  update public.family_documents
  set data = private.family_data_without_sensitive(v_data),
      revision = revision + 1,
      updated_by = auth.uid(),
      updated_at = now()
  where family_id = v_family_id
  returning revision into v_revision;
  perform set_config('app.skip_family_backup_trigger', 'off', true);

  if v_revision is null then raise exception 'family_document_not_found'; end if;
  return v_revision;
end;
$$;

create or replace function public.system_school_snapshot(p_family_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.school_backup_snapshot(p_family_id)
$$;

revoke all on function private.family_data_without_school(jsonb) from public, anon, authenticated;
revoke all on function private.family_data_without_sensitive(jsonb) from public, anon, authenticated;
revoke all on function private.school_backup_snapshot(uuid) from public, anon, authenticated;
revoke all on function private.restore_school_backup(uuid,jsonb,jsonb) from public, anon, authenticated;

revoke execute on function public.system_school_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.system_school_snapshot(uuid) to service_role;
