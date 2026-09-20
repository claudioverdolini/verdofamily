-- Multi-assignee recurring chores.
-- Additive migration: existing single assignee is backfilled into the join table.

select private.create_pre_migration_backups('pre_migration:multi_assignee_recurring_chores');

create table if not exists public.finance_recurring_chore_assignees (
  family_id uuid not null references public.families(id) on delete cascade,
  recurring_chore_id uuid not null references public.finance_recurring_chores(id) on delete cascade,
  person_id uuid not null references public.family_people(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (recurring_chore_id, person_id)
);

alter table public.finance_recurring_chore_assignees enable row level security;

create index if not exists finance_recurring_assignees_family_idx
  on public.finance_recurring_chore_assignees(family_id);
create index if not exists finance_recurring_assignees_person_idx
  on public.finance_recurring_chore_assignees(person_id);

drop policy if exists finance_recurring_chore_assignees_select
  on public.finance_recurring_chore_assignees;
create policy finance_recurring_chore_assignees_select
  on public.finance_recurring_chore_assignees
  for select
  to authenticated
  using (
    (select private.finance_can_read_person(
      finance_recurring_chore_assignees.family_id,
      finance_recurring_chore_assignees.person_id,
      auth.uid()
    ))
  );

revoke all on table public.finance_recurring_chore_assignees from public, anon;
grant select on table public.finance_recurring_chore_assignees to authenticated;

insert into public.finance_recurring_chore_assignees(family_id, recurring_chore_id, person_id)
select family_id, id, person_id
from public.finance_recurring_chores
on conflict (recurring_chore_id, person_id) do nothing;

create or replace function private.finance_backup_snapshot(p_family_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'version', 2,
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
        'userIds', coalesce((
          select jsonb_agg(fp2.legacy_user_id order by fp2.legacy_user_id)
          from public.finance_recurring_chore_assignees fra
          join public.family_people fp2 on fp2.id = fra.person_id
          where fra.recurring_chore_id = frc.id
        ), jsonb_build_array(fp.legacy_user_id)),
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
set search_path=''
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
  delete from public.finance_recurring_chore_assignees where family_id = p_family_id;
  delete from public.finance_recurring_chores where family_id = p_family_id;
  delete from public.finance_wallets where family_id = p_family_id;

  insert into public.finance_wallets(family_id, person_id, balance, currency)
  select p_family_id, fp.id,
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
    on fp.family_id=p_family_id
   and fp.legacy_user_id=(
     case
       when coalesce(c.value->>'userId','') ~ '^[0-9]+$' then (c.value->>'userId')::bigint
       when jsonb_typeof(c.value->'userIds')='array'
         and coalesce(c.value->'userIds'->>0,'') ~ '^[0-9]+$' then (c.value->'userIds'->>0)::bigint
       else null
     end
   )
  where coalesce(c.value->>'id','') ~ '^[0-9]+$';

  insert into public.finance_recurring_chore_assignees(family_id, recurring_chore_id, person_id)
  select distinct p_family_id, rc.id, fp.id
  from jsonb_array_elements(v_recurring) c(value)
  join public.finance_recurring_chores rc
    on rc.family_id=p_family_id and rc.legacy_id=(c.value->>'id')::bigint
  cross join lateral jsonb_array_elements_text(
    case
      when jsonb_typeof(c.value->'userIds')='array' and jsonb_array_length(c.value->'userIds') > 0
        then c.value->'userIds'
      else jsonb_build_array(c.value->>'userId')
    end
  ) assignee(value)
  join public.family_people fp
    on fp.family_id=p_family_id and fp.legacy_user_id=assignee.value::bigint
  where coalesce(c.value->>'id','') ~ '^[0-9]+$'
    and assignee.value ~ '^[0-9]+$'
  on conflict (recurring_chore_id, person_id) do nothing;

  insert into public.finance_transactions(
    family_id, legacy_id, person_id, type, amount, transaction_date, note, reversed
  )
  select p_family_id,(t.value->>'id')::bigint,fp.id,
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
    p_family_id,(c.value->>'id')::bigint,fp.id,
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
