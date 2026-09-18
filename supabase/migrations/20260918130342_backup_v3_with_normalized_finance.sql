alter table public.family_backups
  add column if not exists finance_data jsonb;

create or replace function private.family_data_without_finance(p_data jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          coalesce(p_data, '{}'::jsonb),
          '{users}',
          coalesce((
            select jsonb_agg(jsonb_set(u.value, '{balance}', '0'::jsonb, true) order by u.ord)
            from jsonb_array_elements(coalesce(p_data->'users','[]'::jsonb)) with ordinality u(value, ord)
          ), '[]'::jsonb),
          true
        ),
        '{chores}', '[]'::jsonb, true
      ),
      '{recurringChores}', '[]'::jsonb, true
    ),
    '{transactions}', '[]'::jsonb, true
  )
$$;

create or replace function private.family_data_without_sensitive(p_data jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.family_data_without_finance(private.family_data_without_health(p_data))
$$;

create or replace function private.finance_backup_snapshot(p_family_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 1,
    'wallets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', fp.legacy_user_id,
        'balance', fw.balance,
        'currency', fw.currency
      ) order by fp.legacy_user_id)
      from public.finance_wallets fw
      join public.family_people fp on fp.id = fw.person_id
      where fw.family_id = p_family_id
    ), '[]'::jsonb),
    'recurringChores', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', frc.legacy_id,
        'title', frc.title,
        'userId', fp.legacy_user_id,
        'amount', frc.amount,
        'weekdays', to_jsonb(frc.weekdays),
        'active', frc.active,
        'startDate', frc.start_date,
        'endDate', frc.end_date
      )) order by frc.legacy_id)
      from public.finance_recurring_chores frc
      join public.family_people fp on fp.id = frc.person_id
      where frc.family_id = p_family_id
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', ft.legacy_id,
        'userId', fp.legacy_user_id,
        'type', ft.type,
        'amount', ft.amount,
        'date', ft.transaction_date,
        'note', ft.note,
        'reversed', ft.reversed
      )) order by ft.legacy_id)
      from public.finance_transactions ft
      join public.family_people fp on fp.id = ft.person_id
      where ft.family_id = p_family_id
    ), '[]'::jsonb),
    'chores', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', fc.legacy_id,
        'title', fc.title,
        'deadline', fc.deadline,
        'userId', fp.legacy_user_id,
        'amount', fc.amount,
        'done', fc.status = 'approved',
        'completionStatus', fc.status,
        'completedAt', fc.completed_at,
        'completedByUserId', completed_by.legacy_user_id,
        'approvedAt', fc.approved_at,
        'approvedByUserId', approved_by.legacy_user_id,
        'creditedTransactionId', ft.legacy_id,
        'recurringChoreId', frc.legacy_id
      )) order by fc.legacy_id)
      from public.finance_chores fc
      join public.family_people fp on fp.id = fc.person_id
      left join public.family_people completed_by on completed_by.id = fc.completed_by_person_id
      left join public.family_people approved_by on approved_by.id = fc.approved_by_person_id
      left join public.finance_transactions ft on ft.id = fc.credited_transaction_id
      left join public.finance_recurring_chores frc on frc.id = fc.recurring_chore_id
      where fc.family_id = p_family_id
    ), '[]'::jsonb)
  )
$$;

create or replace function private.restore_finance_backup(
  p_family_id uuid,
  p_finance_data jsonb,
  p_family_data jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallets jsonb;
  v_recurring jsonb;
  v_transactions jsonb;
  v_chores jsonb;
begin
  v_wallets := coalesce(p_finance_data->'wallets', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'userId', (u.value->>'id')::bigint,
      'balance', greatest(coalesce(nullif(u.value->>'balance','')::numeric,0),0),
      'currency', 'EUR'
    ) order by u.ord), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_family_data->'users','[]'::jsonb)) with ordinality u(value, ord)
    where coalesce(u.value->>'id','') ~ '^[0-9]+$'
  ), '[]'::jsonb);
  v_recurring := coalesce(p_finance_data->'recurringChores', p_family_data->'recurringChores', '[]'::jsonb);
  v_transactions := coalesce(p_finance_data->'transactions', p_family_data->'transactions', '[]'::jsonb);
  v_chores := coalesce(p_finance_data->'chores', p_family_data->'chores', '[]'::jsonb);

  delete from public.finance_chores where family_id = p_family_id;
  delete from public.finance_transactions where family_id = p_family_id;
  delete from public.finance_recurring_chores where family_id = p_family_id;
  delete from public.finance_wallets where family_id = p_family_id;

  insert into public.finance_wallets(family_id, person_id, balance, currency)
  select
    p_family_id,
    fp.id,
    greatest(coalesce(nullif(w.value->>'balance','')::numeric,0),0),
    case when coalesce(w.value->>'currency','EUR') ~ '^[A-Z]{3}$' then w.value->>'currency' else 'EUR' end
  from jsonb_array_elements(v_wallets) w(value)
  join public.family_people fp
    on fp.family_id=p_family_id and fp.legacy_user_id=(w.value->>'userId')::bigint
  where coalesce(w.value->>'userId','') ~ '^[0-9]+$';

  insert into public.finance_recurring_chores(
    family_id, legacy_id, person_id, title, amount, weekdays, active, start_date, end_date
  )
  select
    p_family_id,
    (c.value->>'id')::bigint,
    fp.id,
    coalesce(nullif(c.value->>'title',''),'Compito ricorrente'),
    greatest(coalesce(nullif(c.value->>'amount','')::numeric,0),0),
    coalesce((
      select array_agg(weekday_value::smallint order by weekday_value)
      from (
        select distinct d.value::integer as weekday_value
        from jsonb_array_elements_text(
          case when jsonb_typeof(c.value->'weekdays')='array'
            then c.value->'weekdays' else '[1,2,3,4,5,6,7]'::jsonb end
        ) d
        where d.value ~ '^[1-7]$'
      ) q
    ), array[1,2,3,4,5,6,7]::smallint[]),
    coalesce((c.value->>'active')::boolean,true),
    coalesce(nullif(c.value->>'startDate','')::date,current_date),
    nullif(c.value->>'endDate','')::date
  from jsonb_array_elements(v_recurring) c(value)
  join public.family_people fp
    on fp.family_id=p_family_id and fp.legacy_user_id=(c.value->>'userId')::bigint
  where coalesce(c.value->>'id','') ~ '^[0-9]+$'
    and coalesce(c.value->>'userId','') ~ '^[0-9]+$';

  insert into public.finance_transactions(
    family_id, legacy_id, person_id, type, amount, transaction_date, note, reversed
  )
  select
    p_family_id,
    (t.value->>'id')::bigint,
    fp.id,
    case when t.value->>'type' in ('credit','payment','reversal') then t.value->>'type' else 'credit' end,
    greatest(coalesce(nullif(t.value->>'amount','')::numeric,0),0),
    coalesce(nullif(t.value->>'date','')::date,current_date),
    coalesce(t.value->>'note',''),
    coalesce((t.value->>'reversed')::boolean,false)
  from jsonb_array_elements(v_transactions) t(value)
  join public.family_people fp
    on fp.family_id=p_family_id and fp.legacy_user_id=(t.value->>'userId')::bigint
  where coalesce(t.value->>'id','') ~ '^[0-9]+$'
    and coalesce(t.value->>'userId','') ~ '^[0-9]+$';

  insert into public.finance_chores(
    family_id, legacy_id, person_id, title, deadline, amount, status,
    completed_at, completed_by_person_id, approved_at, approved_by_person_id,
    credited_transaction_id, recurring_chore_id
  )
  select
    p_family_id,
    (c.value->>'id')::bigint,
    fp.id,
    coalesce(nullif(c.value->>'title',''),'Compito'),
    coalesce(nullif(c.value->>'deadline','')::date,current_date),
    greatest(coalesce(nullif(c.value->>'amount','')::numeric,0),0),
    case
      when coalesce((c.value->>'done')::boolean,false) then 'approved'
      when c.value->>'completionStatus'='pending' then 'pending'
      else 'open'
    end,
    nullif(c.value->>'completedAt','')::timestamptz,
    (select p.id from public.family_people p
     where p.family_id=p_family_id and p.legacy_user_id=nullif(c.value->>'completedByUserId','')::bigint),
    nullif(c.value->>'approvedAt','')::timestamptz,
    (select p.id from public.family_people p
     where p.family_id=p_family_id and p.legacy_user_id=nullif(c.value->>'approvedByUserId','')::bigint),
    (select tx.id from public.finance_transactions tx
     where tx.family_id=p_family_id and tx.legacy_id=nullif(c.value->>'creditedTransactionId','')::bigint),
    (select rc.id from public.finance_recurring_chores rc
     where rc.family_id=p_family_id and rc.legacy_id=nullif(c.value->>'recurringChoreId','')::bigint)
  from jsonb_array_elements(v_chores) c(value)
  join public.family_people fp
    on fp.family_id=p_family_id and fp.legacy_user_id=(c.value->>'userId')::bigint
  where coalesce(c.value->>'id','') ~ '^[0-9]+$'
    and coalesce(c.value->>'userId','') ~ '^[0-9]+$';
end;
$$;

update public.family_backups b
set
  finance_data = jsonb_build_object(
    'version', 1,
    'wallets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', (u.value->>'id')::bigint,
        'balance', greatest(coalesce(nullif(u.value->>'balance','')::numeric,0),0),
        'currency', 'EUR'
      ) order by u.ord)
      from jsonb_array_elements(coalesce(b.data->'users','[]'::jsonb)) with ordinality u(value, ord)
      where coalesce(u.value->>'id','') ~ '^[0-9]+$'
    ), '[]'::jsonb),
    'chores', coalesce(b.data->'chores','[]'::jsonb),
    'recurringChores', coalesce(b.data->'recurringChores','[]'::jsonb),
    'transactions', coalesce(b.data->'transactions','[]'::jsonb)
  ),
  data = private.family_data_without_finance(b.data),
  backup_format_version = 3
where b.finance_data is null;

alter table public.family_backups
  alter column finance_data set default '{"version":1,"wallets":[],"chores":[],"recurringChores":[],"transactions":[]}'::jsonb,
  alter column finance_data set not null,
  alter column backup_format_version set default 3;

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
    family_id, revision, data, health_data, finance_data, backup_format_version, reason, created_by
  )
  values (
    old.family_id,
    old.revision,
    private.family_data_without_sensitive(old.data),
    private.health_backup_snapshot(old.family_id),
    private.finance_backup_snapshot(old.family_id),
    3,
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
    family_id, revision, data, health_data, finance_data, backup_format_version, reason, created_by
  )
  select
    family_id,
    revision,
    private.family_data_without_sensitive(data),
    private.health_backup_snapshot(family_id),
    private.finance_backup_snapshot(family_id),
    3,
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
  v_revision bigint;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select b.family_id, b.data, b.health_data, b.finance_data
  into v_family_id, v_data, v_health_data, v_finance_data
  from public.family_backups b
  where b.id = p_backup_id;

  if v_family_id is null then raise exception 'backup_not_found'; end if;
  if not private.is_family_admin(v_family_id, auth.uid()) then raise exception 'family_admin_required'; end if;

  insert into public.family_backups(
    family_id, revision, data, health_data, finance_data, backup_format_version, reason, created_by
  )
  select
    fd.family_id,
    fd.revision,
    private.family_data_without_sensitive(fd.data),
    private.health_backup_snapshot(fd.family_id),
    private.finance_backup_snapshot(fd.family_id),
    3,
    'pre_restore',
    auth.uid()
  from public.family_documents fd
  where fd.family_id = v_family_id;

  perform private.restore_health_backup(v_family_id, v_health_data, v_data);
  perform private.restore_finance_backup(v_family_id, v_finance_data, v_data);

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

create or replace function public.system_finance_snapshot(p_family_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.finance_backup_snapshot(p_family_id)
$$;

revoke all on function private.family_data_without_finance(jsonb) from public, anon, authenticated;
revoke all on function private.family_data_without_sensitive(jsonb) from public, anon, authenticated;
revoke all on function private.finance_backup_snapshot(uuid) from public, anon, authenticated;
revoke all on function private.restore_finance_backup(uuid,jsonb,jsonb) from public, anon, authenticated;

revoke execute on function public.system_finance_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.system_finance_snapshot(uuid) to service_role;
